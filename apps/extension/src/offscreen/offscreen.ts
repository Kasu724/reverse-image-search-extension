import { convertImageRequest, detectCropRequest } from "../converter/imageConverter";
import { serializeError } from "../converter/errors";
import { CONVERT_IMAGE_MESSAGE_TYPE, DETECT_CROP_MESSAGE_TYPE } from "../shared/constants";
import { createOcrAdapter, rgbToHex } from "../shared/imageAnalysis";
import type { DominantColor, LocalImageAnalysis } from "../shared/types";

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

type OffscreenRequest = AnalyzeRequest | ConvertRequest | DetectCropRequest;

chrome.runtime.onMessage.addListener((request: OffscreenRequest, _sender, sendResponse) => {
  if (request.type === CONVERT_IMAGE_MESSAGE_TYPE) {
    void convertImageRequest(request.payload as Record<string, unknown>)
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

  if (request.type === DETECT_CROP_MESSAGE_TYPE) {
    void detectCropRequest(request.payload as Record<string, unknown>)
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

  if (request.type !== "OFFSCREEN_ANALYZE_IMAGE") {
    return false;
  }

  void analyzeImage(request.srcUrl)
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

async function analyzeImage(srcUrl: string): Promise<LocalImageAnalysis> {
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
