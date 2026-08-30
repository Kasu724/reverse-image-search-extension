import { convertImageRequest, detectCropRequest } from "../converter/imageConverter";
import { ConversionError, serializeError } from "../converter/errors";
import {
  CONVERT_IMAGE_MESSAGE_TYPE,
  COPY_IMAGE_TO_CLIPBOARD_MESSAGE_TYPE,
  DETECT_CROP_MESSAGE_TYPE
} from "../shared/constants";
import { createOcrAdapter, rgbToHex } from "../shared/imageAnalysis";
import type { DominantColor, LocalImageAnalysis } from "../shared/types";

const MAX_CLIPBOARD_BYTES = 150 * 1024 * 1024;
const MAX_CLIPBOARD_DATA_URL_LENGTH = Math.ceil(MAX_CLIPBOARD_BYTES * 4 / 3) + 4096;
const MAX_CLIPBOARD_PIXELS = 100_000_000;

interface AnalyzeRequest {
  type: "OFFSCREEN_ANALYZE_IMAGE";
  srcUrl: string;
}

interface ConvertRequest {
  type: typeof CONVERT_IMAGE_MESSAGE_TYPE;
  payload: unknown;
}

interface DetectCropRequest {
  type: typeof DETECT_CROP_MESSAGE_TYPE;
  payload: unknown;
}

interface CopyImageToClipboardRequest {
  type: typeof COPY_IMAGE_TO_CLIPBOARD_MESSAGE_TYPE;
  dataUrl: string;
  mimeType?: string;
}

type OffscreenRequest =
  | AnalyzeRequest
  | ConvertRequest
  | DetectCropRequest
  | CopyImageToClipboardRequest;

chrome.runtime.onMessage.addListener((request: unknown, _sender, sendResponse) => {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return false;
  }

  const message = request as Partial<OffscreenRequest>;
  if (message.type === CONVERT_IMAGE_MESSAGE_TYPE) {
    void convertImageRequest(message.payload as Record<string, unknown>)
      .then((result) =>
        sendResponse({
          ok: true,
          ...result
        })
      )
      .catch((error: Error) =>
        sendResponse({
          ok: false,
          error: serializeError(error)
        })
      );

    return true;
  }

  if (message.type === DETECT_CROP_MESSAGE_TYPE) {
    void detectCropRequest(message.payload as Record<string, unknown>)
      .then((result) =>
        sendResponse({
          ok: true,
          ...result
        })
      )
      .catch((error: Error) =>
        sendResponse({
          ok: false,
          error: serializeError(error)
        })
      );

    return true;
  }

  if (message.type === COPY_IMAGE_TO_CLIPBOARD_MESSAGE_TYPE) {
    void copyImageToClipboard(message.dataUrl as string, message.mimeType)
      .then(() =>
        sendResponse({
          ok: true
        })
      )
      .catch((error: Error) =>
        sendResponse({
          ok: false,
          error: serializeError(error)
        })
      );

    return true;
  }

  if (message.type !== "OFFSCREEN_ANALYZE_IMAGE") {
    return false;
  }

  void analyzeImage((message as Partial<AnalyzeRequest>).srcUrl as string)
    .then((analysis) =>
      sendResponse({
        ok: true,
        analysis
      })
    )
    .catch((error: Error) =>
      sendResponse({
        ok: false,
        error: error.message
      })
    );

  return true;
});

async function copyImageToClipboard(dataUrl: string, mimeType = "image/png"): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new ConversionError(
      "clipboard_unavailable",
      "This Chromium build does not expose image clipboard writes to extensions."
    );
  }

  const supports = (ClipboardItem as typeof ClipboardItem & {
    supports?: (type: string) => boolean;
  }).supports;
  if (typeof supports === "function" && !supports.call(ClipboardItem, "image/png")) {
    throw new ConversionError(
      "clipboard_type_unsupported",
      "This Chromium build does not support copying PNG images to the clipboard."
    );
  }

  const blob = dataUrlToBlob(dataUrl, mimeType);
  const clipboardBlob = await ensurePngClipboardBlob(blob);

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "image/png": clipboardBlob
      })
    ]);
  } catch (error) {
    throw new ConversionError(
      "clipboard_write_failed",
      error instanceof Error ? error.message : "The image could not be copied to the clipboard.",
      {
        originalError: error instanceof Error ? error.name : String(error)
      }
    );
  }
}

function dataUrlToBlob(dataUrl: string, fallbackMimeType: string): Blob {
  if (typeof dataUrl !== "string" || !/^data:/i.test(dataUrl)) {
    throw new ConversionError(
      "clipboard_data_url_invalid",
      "The converted image data could not be read for copying."
    );
  }
  if (dataUrl.length > MAX_CLIPBOARD_DATA_URL_LENGTH) {
    throw new ConversionError(
      "clipboard_data_too_large",
      "The image is too large to copy safely to the clipboard."
    );
  }
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) {
    throw new ConversionError(
      "clipboard_data_url_invalid",
      "The converted image data could not be read for copying."
    );
  }

  const metadata = dataUrl.slice(5, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  const metadataParts = metadata
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  const isBase64 = metadataParts.some((part) => part.toLowerCase() === "base64");
  const mediaType =
    metadataParts.find((part) => part.includes("/")) || fallbackMimeType || "image/png";
  const bytes = isBase64 ? base64ToBytes(payload) : urlEncodedPayloadToBytes(payload);

  if (bytes.byteLength > MAX_CLIPBOARD_BYTES) {
    throw new ConversionError(
      "clipboard_data_too_large",
      "The image is too large to copy safely to the clipboard."
    );
  }

  return new Blob([bytesToArrayBuffer(bytes)], { type: normalizeMimeType(mediaType) });
}

function base64ToBytes(payload: string): Uint8Array {
  try {
    const binary = atob(payload.replace(/\s/g, ""));
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  } catch (error) {
    throw new ConversionError(
      "clipboard_data_url_decode_failed",
      "The converted image data could not be decoded for copying.",
      {
        originalError: error instanceof Error ? error.message : String(error)
      }
    );
  }
}

function urlEncodedPayloadToBytes(payload: string): Uint8Array {
  const encoded = new TextEncoder();
  const bytes: number[] = [];

  for (let index = 0; index < payload.length; index += 1) {
    if (payload[index] === "%" && /^[0-9a-f]{2}$/i.test(payload.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(payload.slice(index + 1, index + 3), 16));
      index += 2;
      continue;
    }

    const codePoint = payload.codePointAt(index) ?? 0;
    bytes.push(...encoded.encode(String.fromCodePoint(codePoint)));
    if (codePoint > 0xffff) {
      index += 1;
    }
  }

  return new Uint8Array(bytes);
}

async function ensurePngClipboardBlob(blob: Blob): Promise<Blob> {
  if (blob.size > MAX_CLIPBOARD_BYTES) {
    throw new ConversionError(
      "clipboard_data_too_large",
      "The image is too large to copy safely to the clipboard."
    );
  }

  if (normalizeMimeType(blob.type) === "image/png") {
    return blob;
  }

  let bitmap: ImageBitmap | null = null;

  try {
    bitmap = await createImageBitmap(blob);
    if (bitmap.width <= 0 || bitmap.height <= 0 || bitmap.width * bitmap.height > MAX_CLIPBOARD_PIXELS) {
      throw new ConversionError(
        "clipboard_image_too_large",
        "The image dimensions are too large to copy safely to the clipboard."
      );
    }
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Could not create a canvas context for clipboard image encoding.");
    }

    context.drawImage(bitmap, 0, 0);
    return canvas.convertToBlob({ type: "image/png" });
  } catch (error) {
    throw new ConversionError(
      "clipboard_encode_failed",
      "The image could not be encoded for the clipboard.",
      {
        originalError: error instanceof Error ? error.message : String(error)
      }
    );
  } finally {
    bitmap?.close();
  }
}

function normalizeMimeType(mimeType: string): string {
  return typeof mimeType === "string"
    ? mimeType.split(";", 1)[0]?.trim().toLowerCase() || "image/png"
    : "image/png";
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function analyzeImage(srcUrl: string): Promise<LocalImageAnalysis> {
  if (typeof srcUrl !== "string" || !srcUrl.trim()) {
    throw new Error("The image URL is invalid for local analysis.");
  }
  const image = await loadImage(srcUrl);
  const dominantColors = await extractDominantColors(image);
  const ocrAdapter = await createOcrAdapter();
  const ocr = await ocrAdapter.recognize(srcUrl);

  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
    dominantColors,
    ocr,
    analyzedAt: new Date().toISOString()
  };
}

function loadImage(srcUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be loaded for local analysis."));
    image.src = srcUrl;
  });
}

async function extractDominantColors(image: HTMLImageElement): Promise<DominantColor[]> {
  const maxSize = 160;
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Canvas is not available for local image analysis.");
  }

  context.drawImage(image, 0, 0, width, height);

  let data: Uint8ClampedArray;
  try {
    data = context.getImageData(0, 0, width, height).data;
  } catch {
    throw new Error("Canvas analysis was blocked, likely by image CORS restrictions.");
  }

  const buckets = new Map<string, { rgb: [number, number, number]; count: number }>();
  let total = 0;

  for (let index = 0; index < data.length; index += 16) {
    const alpha = data[index + 3];
    if (alpha < 128) {
      continue;
    }

    const red = quantize(data[index]);
    const green = quantize(data[index + 1]);
    const blue = quantize(data[index + 2]);
    const key = `${red},${green},${blue}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      buckets.set(key, {
        rgb: [red, green, blue],
        count: 1
      });
    }
    total += 1;
  }

  if (total === 0) {
    return [];
  }

  return [...buckets.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 6)
    .map((bucket) => ({
      hex: rgbToHex(bucket.rgb[0], bucket.rgb[1], bucket.rgb[2]),
      rgb: bucket.rgb,
      percentage: Math.round((bucket.count / total) * 100)
    }));
}

function quantize(value: number): number {
  return Math.round(value / 32) * 32;
}
