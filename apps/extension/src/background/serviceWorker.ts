import {
  getImageContextMenuAction,
  isOpenImageLabMenuClick,
  registerContextMenus,
  type ImageContextMenuAction
} from "./contextMenus";
import { formatLabel } from "../converter/constants";
import { errorFromPayload, ConversionError, serializeError } from "../converter/errors";
import {
  normalizeCompressionTargetBytes,
  readSettings as readConverterSettings
} from "../converter/settings";
import { isBlobUrl, isDataUrl, isHttpUrl, truncateForDisplay } from "../converter/urls";
import { uploadImageForSearch } from "../shared/cloudClient";
import {
  CONVERT_IMAGE_MESSAGE_TYPE,
  COPY_IMAGE_TO_CLIPBOARD_MESSAGE_TYPE,
  CONTEXT_IMAGE_DETECTED_MESSAGE_TYPE,
  DETECT_CROP_MESSAGE_TYPE,
  ERROR_PAGE_PATH,
  OFFSCREEN_DOCUMENT_PATH
} from "../shared/constants";
import { buildEnabledSearchUrls, buildSearchUrl } from "../shared/searchEngines";
import {
  getCurrentImage,
  getSettings,
  setCurrentImage,
  updateCurrentImage,
  upsertHistoryEntry
} from "../shared/storage";
import { createSelectedImage, imageNeedsUploadProxy } from "../shared/imageMetadata";
import type {
  ContentDetectedImage,
  ContentImageContext,
  DetectedCropResult,
  ImageProcessOptions,
  ImageProcessResult,
  LocalImageAnalysis,
  OutputImageFormat,
  RuntimeRequest,
  RuntimeResponse,
  SearchEngineId,
  SelectedImage
} from "../shared/types";

type OffscreenResponse = {
  ok: boolean;
  analysis?: LocalImageAnalysis;
  error?: string;
};

type ConvertOffscreenResponse = {
  ok: boolean;
  dataUrl?: string;
  filename?: string;
  mimeType?: string;
  byteLength?: number;
  width?: number | null;
  height?: number | null;
  sourceFormat?: string;
  skippedRedundant?: boolean;
  targetBytes?: number | null;
  targetMet?: boolean | null;
  compressionApplied?: boolean;
  error?: unknown;
};

type SuccessfulConvertOffscreenResponse = ConvertOffscreenResponse & {
  dataUrl: string;
  filename: string;
};

type DetectCropOffscreenResponse = {
  ok: boolean;
  crop?: DetectedCropResult["crop"];
  width?: number;
  height?: number;
  error?: unknown;
};

type CopyOffscreenResponse = {
  ok: boolean;
  error?: unknown;
};

type ResolvedContextImage = {
  srcUrl: string;
  pageUrl?: string;
  context: ContentImageContext | null;
  sourceDataUrl?: string;
  sourceMimeType?: string;
  sourceByteLength?: number;
  viewportRect?: ViewportRect;
};

type ContextImageProcessOptions = Partial<ImageProcessOptions> & {
  targetFormat: OutputImageFormat;
  preserveSourceDimensions?: boolean;
};

type ContextImageDetectedRequest = {
  type: typeof CONTEXT_IMAGE_DETECTED_MESSAGE_TYPE;
  image?: ContentDetectedImage;
};

type CachedContextImage = ResolvedContextImage & {
  tabId: number;
  frameId?: number;
  capturedAt: number;
};

type ScriptDetectedContextImage = ResolvedContextImage & {
  score?: number;
};

type ViewportRect = {
  left: number;
  top: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
};

const CACHED_CONTEXT_IMAGE_MAX_AGE_MS = 90_000;
const cachedContextImages = new Map<string, CachedContextImage>();

void registerContextMenus();

chrome.runtime.onInstalled.addListener(() => {
  void registerContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  void registerContextMenus();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (isOpenImageLabMenuClick(info)) {
    void openImageLabSurface(tab?.id);
    return;
  }

  const imageAction = getImageContextMenuAction(info);
  if (imageAction) {
    void handleImageContextClick(info, tab, imageAction);
  }
});

chrome.runtime.onMessage.addListener((request: unknown, sender, sendResponse) => {
  if (isContextImageDetectedRequest(request)) {
    cacheContextImage(request.image, sender);
    sendResponse({ ok: true } satisfies RuntimeResponse);
    return false;
  }

  if (!isRuntimeRequest(request)) {
    return false;
  }

  void handleRuntimeRequest(request)
    .then((response) => sendResponse(response))
    .catch((error: Error) =>
      sendResponse({
        ok: false,
        error: error.message
      } satisfies RuntimeResponse)
    );
  return true;
});

function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in value &&
      [
        "OPEN_SEARCH_ENGINE",
        "OPEN_ENABLED_ENGINES",
        "ANALYZE_CURRENT_IMAGE",
        "PROCESS_CURRENT_IMAGE",
        "DETECT_CURRENT_IMAGE_CROP",
        "GET_CURRENT_IMAGE"
      ].includes(String((value as { type?: unknown }).type))
  );
}

function isContextImageDetectedRequest(value: unknown): value is ContextImageDetectedRequest {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { type?: unknown }).type === CONTEXT_IMAGE_DETECTED_MESSAGE_TYPE
  );
}

async function handleImageContextClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
  action: ImageContextMenuAction
): Promise<void> {
  if (action.type === "convert" || action.type === "convert-default") {
    await handleImageConversionContextClick(info, tab, action);
    return;
  }

  if (action.type === "copy") {
    await handleImageCopyContextClick(info, tab);
    return;
  }

  if (action.type === "compress" || action.type === "auto-crop") {
    await handleImageProcessingContextClick(info, tab, action);
    return;
  }

  if (action.type === "compress-options") {
    await chrome.runtime.openOptionsPage();
    return;
  }

  const image = await captureImageFromContext(info, tab);

  if (!image) {
    await openImageLabSurface(tab?.id);
    return;
  }

  void analyzeAndStore(image);

  try {
    if (action.type === "open-panel") {
      const settings = await getSettings();
      if (settings.instantOpen) {
        await openEnabledEngines(image, settings.enabledEngines);
      }
      await openImageLabSurface(tab?.id);
      return;
    }

    if (action.type === "crop-open") {
      await openImageLabSurface(tab?.id);
      return;
    }

    if (action.type === "search-all") {
      const settings = await getSettings();
      await openEnabledEngines(image, settings.enabledEngines);
      return;
    }

    await openEngine(image, action.engineId);
  } catch (error) {
    await openImageLabSurface(tab?.id);
    console.warn("ImageLab context-menu search failed.", error);
  }
}

async function handleImageConversionContextClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
  action: Extract<ImageContextMenuAction, { type: "convert" | "convert-default" }>
): Promise<void> {
  const targetLabel = getConversionTargetLabel(action);

  try {
    await convertAndDownloadImage(info, tab, action);
  } catch (error) {
    console.error("ImageLab image conversion failed.", error);
    await openConversionErrorPage(error, {
      sourceUrl: info.srcUrl || info.linkUrl || "",
      targetLabel
    });
  }
}

async function handleImageCopyContextClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined
): Promise<void> {
  try {
    const response = await processImageFromContext(info, tab, {
      targetFormat: "png",
      preserveSourceDimensions: true
    });

    if (!response.dataUrl) {
      throw new ConversionError(
        "copy_failed",
        "The selected image could not be prepared for the clipboard."
      );
    }

    await ensureOffscreenDocument();
    const copyResponse = await sendRuntimeMessage<CopyOffscreenResponse>({
      type: COPY_IMAGE_TO_CLIPBOARD_MESSAGE_TYPE,
      dataUrl: response.dataUrl,
      mimeType: response.mimeType || "image/png"
    });

    if (!copyResponse.ok) {
      throw errorFromPayload(copyResponse.error);
    }

    const image = await captureImageFromContext(info, tab);
    if (image) {
      void analyzeAndStore(image);
    }
  } catch (error) {
    console.error("ImageLab image copy failed.", error);
    await openConversionErrorPage(error, {
      sourceUrl: info.srcUrl || info.linkUrl || "",
      targetLabel: "Copy image"
    });
  }
}

async function handleImageProcessingContextClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
  action: Extract<ImageContextMenuAction, { type: "compress" | "auto-crop" }>
): Promise<void> {
  const targetLabel =
    action.type === "compress"
      ? `Compress under ${formatBytes(action.targetBytes)}`
      : action.mode === "transparent"
        ? "Trim transparent border"
        : "Trim solid-color border";

  try {
    const settings = await readConverterSettings();
    const compression =
      action.type === "compress"
        ? {
            targetBytes: normalizeCompressionTargetBytes(action.targetBytes),
            minQuality: settings.compressionMinQuality,
            allowResize: settings.compressionAllowResize
          }
        : null;

    await processAndDownloadImage(info, tab, {
      targetFormat: settings.defaultFormat as OutputImageFormat,
      autoCrop: action.type === "auto-crop" ? action.mode : null,
      compression
    });
  } catch (error) {
    console.error("ImageLab image processing failed.", error);
    await openConversionErrorPage(error, {
      sourceUrl: info.srcUrl || "",
      targetLabel
    });
  }
}

async function convertAndDownloadImage(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
  action: Extract<ImageContextMenuAction, { type: "convert" | "convert-default" }>
): Promise<void> {
  const settings = await readConverterSettings();
  const targetFormat = action.type === "convert-default" ? settings.defaultFormat : action.format;

  await processAndDownloadImage(info, tab, {
    targetFormat: targetFormat as OutputImageFormat
  });
}

async function processAndDownloadImage(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
  options: ContextImageProcessOptions
): Promise<SuccessfulConvertOffscreenResponse> {
  const response = await processImageFromContext(info, tab, options);
  const settings = await readConverterSettings();

  const downloadId = await chrome.downloads.download({
    url: response.dataUrl,
    filename: response.filename,
    saveAs: settings.downloadMode !== "auto",
    conflictAction: "uniquify"
  });

  if (!downloadId && downloadId !== 0) {
    throw new ConversionError(
      "download_failed",
      "Chrome did not start the download. Check your downloads settings and try again."
    );
  }

  return response;
}

async function processImageFromContext(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
  options: ContextImageProcessOptions
): Promise<SuccessfulConvertOffscreenResponse> {
  const settings = await readConverterSettings();
  const effectiveSettings = options.preserveSourceDimensions
    ? {
        ...settings,
        preserveDimensions: true,
        resizeWidth: null,
        resizeHeight: null
      }
    : settings;
  const sourcePayload = await buildConversionSourcePayload(info, tab);

  await ensureOffscreenDocument();

  const response = await sendRuntimeMessage<ConvertOffscreenResponse>({
    type: CONVERT_IMAGE_MESSAGE_TYPE,
    payload: {
      ...sourcePayload,
      pageUrl: info.pageUrl || tab?.url || "",
      frameUrl: info.frameUrl || "",
      targetFormat: options.targetFormat,
      crop: options.crop ?? null,
      autoCrop: options.autoCrop ?? null,
      compression: options.compression ?? null,
      settings: effectiveSettings
    }
  });

  if (!response.ok || !response.dataUrl || !response.filename) {
    throw errorFromPayload(response.error);
  }

  return response as SuccessfulConvertOffscreenResponse;
}

function getConversionTargetLabel(
  action: Extract<ImageContextMenuAction, { type: "convert" | "convert-default" }>
): string {
  if (action.type === "convert-default") {
    return "Quick default format";
  }

  return formatLabel(action.format);
}

async function buildConversionSourcePayload(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
): Promise<Record<string, unknown>> {
  const source = await resolveContextImage(info, tab);
  const sourceUrl = source?.srcUrl;

  if (!sourceUrl) {
    throw new ConversionError(
      "missing_image_url",
      "No image was detected under the right-click point."
    );
  }

  if (source.sourceDataUrl) {
    return {
      sourceUrl,
      sourceDataUrl: source.sourceDataUrl,
      sourceMimeType: source.sourceMimeType || "image/png",
      sourceByteLength: source.sourceByteLength || 0
    };
  }

  if (isDataUrl(sourceUrl)) {
    return { sourceUrl };
  }

  if (isBlobUrl(sourceUrl)) {
    const blobSource = await fetchBlobUrlFromPage(sourceUrl, info, tab);
    return {
      sourceUrl,
      sourceDataUrl: blobSource.dataUrl,
      sourceMimeType: blobSource.mimeType || "",
      sourceByteLength: blobSource.byteLength || 0
    };
  }

  if (isHttpUrl(sourceUrl)) {
    if (isLikelyProtectedImageUrl(sourceUrl)) {
      const visibleCapture = await captureVisibleContextImage(source, tab);
      if (visibleCapture) {
        return {
          sourceUrl,
          sourceDataUrl: visibleCapture.dataUrl,
          sourceMimeType: "image/png",
          sourceByteLength: visibleCapture.byteLength
        };
      }
    }

    return { sourceUrl };
  }

  throw new ConversionError(
    "unsupported_url",
    "This image URL uses a scheme the extension cannot fetch locally.",
    { sourceUrl: truncateForDisplay(sourceUrl) }
  );
}

async function fetchBlobUrlFromPage(
  sourceUrl: string,
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
): Promise<{ dataUrl: string; mimeType?: string; byteLength?: number }> {
  const tabId = tab?.id;
  if (!Number.isInteger(tabId)) {
    throw new ConversionError(
      "missing_tab",
      "Blob images can only be converted from an active browser tab."
    );
  }

  const target: chrome.scripting.InjectionTarget =
    Number.isInteger(info.frameId) && (info.frameId ?? -1) >= 0
      ? { tabId: tabId as number, frameIds: [info.frameId as number] }
      : { tabId: tabId as number };

  const results = await chrome.scripting.executeScript({
    target,
    args: [sourceUrl],
    func: async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Could not read blob URL (${response.status}).`);
      }

      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Could not read the blob image."));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(blob);
      });

      return {
        dataUrl,
        mimeType: blob.type || "",
        byteLength: blob.size || 0
      };
    }
  });

  const result = results?.[0]?.result;
  if (!result?.dataUrl) {
    throw new ConversionError(
      "blob_read_failed",
      "The page did not return readable blob image data."
    );
  }

  return result;
}

function isLikelyProtectedImageUrl(sourceUrl: string): boolean {
  try {
    const hostname = new URL(sourceUrl).hostname.toLowerCase();
    return (
      hostname.endsWith("instagram.com") ||
      hostname.endsWith("cdninstagram.com") ||
      hostname.endsWith("fbcdn.net") ||
      hostname.includes("scontent")
    );
  } catch {
    return false;
  }
}

async function captureVisibleContextImage(
  source: ResolvedContextImage,
  tab?: chrome.tabs.Tab
): Promise<{ dataUrl: string; byteLength: number } | null> {
  const tabId = tab?.id;
  const windowId = tab?.windowId;
  if (!Number.isInteger(tabId) || !Number.isInteger(windowId) || !source.viewportRect) {
    return null;
  }

  try {
    const screenshot = await captureVisibleTabDataUrl(windowId as number);
    const cropped = await cropDataUrlToViewportRect(screenshot, source.viewportRect);
    return {
      dataUrl: cropped,
      byteLength: dataUrlByteLength(cropped)
    };
  } catch (error) {
    console.warn("ImageLab visible image capture failed.", error);
    return null;
  }
}

function captureVisibleTabDataUrl(windowId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      if (!dataUrl) {
        reject(new Error("Chrome did not return a tab capture."));
        return;
      }

      resolve(dataUrl);
    });
  });
}

async function cropDataUrlToViewportRect(dataUrl: string, rect: ViewportRect): Promise<string> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);

  try {
    const scaleX = bitmap.width / Math.max(1, rect.viewportWidth);
    const scaleY = bitmap.height / Math.max(1, rect.viewportHeight);
    const sx = clampNumber(Math.round(rect.left * scaleX), 0, Math.max(0, bitmap.width - 1));
    const sy = clampNumber(Math.round(rect.top * scaleY), 0, Math.max(0, bitmap.height - 1));
    const sw = clampNumber(Math.round(rect.width * scaleX), 1, bitmap.width - sx);
    const sh = clampNumber(Math.round(rect.height * scaleY), 1, bitmap.height - sy);
    const canvas = new OffscreenCanvas(sw, sh);
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Could not create a canvas context for visible image capture.");
    }

    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    const outputBlob = await canvas.convertToBlob({ type: "image/png" });
    return blobToDataUrl(outputBlob);
  } finally {
    if (typeof bitmap.close === "function") {
      bitmap.close();
    }
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }

  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

function dataUrlByteLength(dataUrl: string): number {
  const encoded = dataUrl.split(",", 2)[1] || "";
  return Math.floor((encoded.length * 3) / 4);
}

function cacheContextImage(
  image: ContentDetectedImage | undefined,
  sender: chrome.runtime.MessageSender
): void {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId) || !image?.srcUrl) {
    return;
  }

  pruneCachedContextImages();

  const frameId = Number.isInteger(sender.frameId) ? sender.frameId : undefined;
  cachedContextImages.set(contextImageCacheKey(tabId as number, frameId), {
    tabId: tabId as number,
    frameId,
    srcUrl: image.srcUrl,
    pageUrl: sender.url || sender.tab?.url,
    context: image.context,
    capturedAt: Date.now()
  });
}

function getCachedContextImage(
  tabId: number,
  frameId?: number
): ResolvedContextImage | null {
  pruneCachedContextImages();

  const exact = cachedContextImages.get(contextImageCacheKey(tabId, frameId));
  if (exact) {
    return exact;
  }

  let newest: CachedContextImage | null = null;
  for (const cached of cachedContextImages.values()) {
    if (cached.tabId !== tabId) {
      continue;
    }

    if (!newest || cached.capturedAt > newest.capturedAt) {
      newest = cached;
    }
  }

  return newest;
}

function pruneCachedContextImages(): void {
  const cutoff = Date.now() - CACHED_CONTEXT_IMAGE_MAX_AGE_MS;
  for (const [key, cached] of cachedContextImages) {
    if (cached.capturedAt < cutoff) {
      cachedContextImages.delete(key);
    }
  }
}

function contextImageCacheKey(tabId: number, frameId?: number): string {
  return `${tabId}:${Number.isInteger(frameId) ? frameId : "latest"}`;
}

async function detectContextImageWithScripting(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
): Promise<ResolvedContextImage | null> {
  const tabId = tab?.id;
  if (!Number.isInteger(tabId)) {
    return null;
  }

  const target: chrome.scripting.InjectionTarget =
    Number.isInteger(info.frameId) && (info.frameId ?? -1) >= 0
      ? { tabId: tabId as number, frameIds: [info.frameId as number] }
      : { tabId: tabId as number, allFrames: true };

  try {
    const results = await chrome.scripting.executeScript({
      target,
      func: detectContextImageInPage
    });

    const candidates = results
      .map((result) => result.result)
      .filter((result): result is ScriptDetectedContextImage =>
        Boolean(result?.srcUrl)
      )
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0));

    const candidate = candidates[0];
    if (!candidate) {
      return null;
    }

    return {
      srcUrl: candidate.srcUrl,
      pageUrl: candidate.pageUrl,
      context: candidate.context
    };
  } catch (error) {
    console.warn("ImageLab scripted image detection failed.", error);
    return null;
  }
}

function detectContextImageInPage(): ScriptDetectedContextImage | null {
  const LAST_CONTEXT_POINT_KEY = "__imagelabLastContextPoint";
  const MAX_POINT_AGE_MS = 120_000;
  const MIN_EDGE = 24;
  const MEDIA_SELECTOR = "img, picture img, canvas, svg image, video";
  const IMAGE_URL_ATTRIBUTES = [
    "src",
    "poster",
    "data-src",
    "data-original",
    "data-lazy-src",
    "data-image",
    "data-image-url",
    "data-full-src"
  ];

  const viewportWidth = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
  const viewportHeight = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
  const viewportArea = Math.max(1, viewportWidth * viewportHeight);
  const isInstagram = /(^|\.)instagram\.com$/i.test(location.hostname);

  function getLastContextPoint(): { clientX: number; clientY: number } | null {
    const value = (window as Window & {
      [LAST_CONTEXT_POINT_KEY]?: { clientX?: unknown; clientY?: unknown; capturedAt?: unknown };
    })[LAST_CONTEXT_POINT_KEY];

    if (!value || typeof value !== "object") {
      return null;
    }

    const clientX = Number(value.clientX);
    const clientY = Number(value.clientY);
    const capturedAt = Number(value.capturedAt);
    if (
      !Number.isFinite(clientX) ||
      !Number.isFinite(clientY) ||
      !Number.isFinite(capturedAt) ||
      Date.now() - capturedAt > MAX_POINT_AGE_MS
    ) {
      return null;
    }

    return { clientX, clientY };
  }

  function normalizeUrl(value: string): string {
    try {
      return new URL(value, document.baseURI).href;
    } catch {
      return value;
    }
  }

  function isUsableImageUrl(value: string): boolean {
    if (!value) {
      return false;
    }

    const lower = value.toLowerCase();
    return (
      lower.startsWith("http://") ||
      lower.startsWith("https://") ||
      lower.startsWith("blob:") ||
      lower.startsWith("file:") ||
      lower.startsWith("data:image/")
    );
  }

  function rectVisibleArea(rect: DOMRect): number {
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(viewportWidth, rect.right);
    const bottom = Math.min(viewportHeight, rect.bottom);
    return Math.max(0, right - left) * Math.max(0, bottom - top);
  }

  function rectContainsPoint(rect: DOMRect, clientX: number, clientY: number, tolerance = 0): boolean {
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      clientX >= rect.left - tolerance &&
      clientX <= rect.right + tolerance &&
      clientY >= rect.top - tolerance &&
      clientY <= rect.bottom + tolerance
    );
  }

  function isElementVisible(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    if (rect.width < MIN_EDGE || rect.height < MIN_EDGE || rectVisibleArea(rect) <= 0) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function firstUrlFromCssImage(value: string): string | null {
    const urlPattern = /url\((?:"([^"]+)"|'([^']+)'|([^)"']+))\)/gi;
    let match: RegExpExecArray | null;

    while ((match = urlPattern.exec(value))) {
      const url = normalizeUrl(String(match[1] || match[2] || match[3] || "").trim());
      if (isUsableImageUrl(url)) {
        return url;
      }
    }

    return null;
  }

  function bestSrcFromSrcset(srcset: string): string | null {
    const candidates = srcset
      .split(",")
      .map((candidate) => {
        const [url, descriptor] = candidate.trim().split(/\s+/, 2);
        const score =
          descriptor?.endsWith("x") || descriptor?.endsWith("w")
            ? Number(descriptor.slice(0, -1))
            : 1;

        return {
          url: normalizeUrl(url || ""),
          score: Number.isFinite(score) ? score : 1
        };
      })
      .filter((candidate) => isUsableImageUrl(candidate.url));

    candidates.sort((left, right) => right.score - left.score);
    return candidates[0]?.url ?? null;
  }

  function getImageUrlFromAttributes(element: Element): string | null {
    for (const attribute of IMAGE_URL_ATTRIBUTES) {
      const value = element.getAttribute(attribute);
      if (!value) {
        continue;
      }

      const normalized = normalizeUrl(value);
      if (isUsableImageUrl(normalized)) {
        return normalized;
      }
    }

    return bestSrcFromSrcset(element.getAttribute("srcset") || element.getAttribute("data-srcset") || "");
  }

  function getMediaSource(element: Element): string | null {
    if (element instanceof HTMLImageElement) {
      return normalizeUrl(
        element.currentSrc ||
          element.src ||
          bestSrcFromSrcset(element.getAttribute("srcset") || "") ||
          getImageUrlFromAttributes(element) ||
          ""
      );
    }

    if (element instanceof HTMLVideoElement) {
      const poster = normalizeUrl(element.poster || element.getAttribute("poster") || "");
      return isUsableImageUrl(poster) ? poster : null;
    }

    if (element instanceof HTMLCanvasElement) {
      try {
        return element.toDataURL("image/png");
      } catch {
        return null;
      }
    }

    if (typeof SVGImageElement !== "undefined" && element instanceof SVGImageElement) {
      return normalizeUrl(
        element.href.baseVal ||
          element.getAttribute("href") ||
          element.getAttribute("xlink:href") ||
          ""
      );
    }

    return getImageUrlFromAttributes(element);
  }

  function getElementLabel(element: Element): string {
    return [
      element.getAttribute("alt"),
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("class")
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function buildContext(element: Element): ContentImageContext {
    const rect = element.getBoundingClientRect();
    const label = getElementLabel(element);
    const title =
      element.getAttribute("title") ||
      element.getAttribute("aria-label") ||
      element.getAttribute("alt") ||
      undefined;

    if (element instanceof HTMLImageElement) {
      return {
        altText: element.alt || undefined,
        title,
        width: Math.round(element.naturalWidth || element.width || rect.width) || undefined,
        height: Math.round(element.naturalHeight || element.height || rect.height) || undefined,
        naturalWidth: Math.round(element.naturalWidth || rect.width) || undefined,
        naturalHeight: Math.round(element.naturalHeight || rect.height) || undefined
      };
    }

    if (element instanceof HTMLCanvasElement) {
      return {
        altText: label || undefined,
        title,
        width: element.width || Math.round(rect.width) || undefined,
        height: element.height || Math.round(rect.height) || undefined,
        naturalWidth: element.width || Math.round(rect.width) || undefined,
        naturalHeight: element.height || Math.round(rect.height) || undefined
      };
    }

    return {
      altText: label || undefined,
      title,
      width: Math.round(rect.width) || undefined,
      height: Math.round(rect.height) || undefined,
      naturalWidth: Math.round(rect.width) || undefined,
      naturalHeight: Math.round(rect.height) || undefined
    };
  }

  function viewportRectFromElement(element: Element): ViewportRect {
    const rect = element.getBoundingClientRect();
    const left = Math.max(0, Math.min(viewportWidth, rect.left));
    const top = Math.max(0, Math.min(viewportHeight, rect.top));
    const right = Math.max(left + 1, Math.min(viewportWidth, rect.right));
    const bottom = Math.max(top + 1, Math.min(viewportHeight, rect.bottom));

    return {
      left,
      top,
      width: right - left,
      height: bottom - top,
      viewportWidth,
      viewportHeight
    };
  }

  function dataUrlByteLength(dataUrl: string): number {
    const encoded = dataUrl.split(",", 2)[1] || "";
    return Math.floor((encoded.length * 3) / 4);
  }

  function renderElementToDataUrl(element: Element): string | null {
    try {
      if (element instanceof HTMLCanvasElement) {
        return element.toDataURL("image/png");
      }

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) {
        return null;
      }

      if (element instanceof HTMLImageElement) {
        const width = element.naturalWidth || element.width;
        const height = element.naturalHeight || element.height;
        if (!width || !height) {
          return null;
        }
        canvas.width = width;
        canvas.height = height;
        context.drawImage(element, 0, 0, width, height);
        return canvas.toDataURL("image/png");
      }

      if (element instanceof HTMLVideoElement && element.readyState >= 2) {
        const width = element.videoWidth || Math.round(element.getBoundingClientRect().width);
        const height = element.videoHeight || Math.round(element.getBoundingClientRect().height);
        if (!width || !height) {
          return null;
        }
        canvas.width = width;
        canvas.height = height;
        context.drawImage(element, 0, 0, width, height);
        return canvas.toDataURL("image/png");
      }
    } catch {
      return null;
    }

    return null;
  }

  function scoreElement(element: Element, sourceUrl: string, pointHit: boolean): number {
    const rect = element.getBoundingClientRect();
    const visibleArea = rectVisibleArea(rect);
    const label = getElementLabel(element);
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const viewportCenterDistance = Math.hypot(centerX - viewportWidth / 2, centerY - viewportHeight / 2);
    const centerBonus = Math.max(0, 1000 - viewportCenterDistance);
    const lowerUrl = sourceUrl.toLowerCase();
    let score = visibleArea + centerBonus;

    if (pointHit) {
      score += viewportArea * 2;
    }
    if (element.closest("article")) {
      score += viewportArea * 0.75;
    }
    if (element.closest('[role="dialog"], main')) {
      score += viewportArea * 0.25;
    }
    if (isInstagram && /scontent|cdninstagram|fbcdn/.test(lowerUrl)) {
      score += viewportArea;
    }
    if (label.includes("profile") || label.includes("avatar")) {
      score -= viewportArea * 2;
    }
    if (rect.width < 80 || rect.height < 80) {
      score -= viewportArea;
    }

    return score;
  }

  function detectedFromElement(
    element: Element,
    sourceUrl: string | null,
    pointHit = false
  ): ScriptDetectedContextImage | null {
    const normalized = normalizeUrl(sourceUrl || "");
    if (!isUsableImageUrl(normalized) || !isElementVisible(element)) {
      return null;
    }

    const sourceDataUrl = renderElementToDataUrl(element) || undefined;

    return {
      srcUrl: normalized,
      pageUrl: location.href,
      context: buildContext(element),
      sourceDataUrl,
      sourceMimeType: sourceDataUrl ? "image/png" : undefined,
      sourceByteLength: sourceDataUrl ? dataUrlByteLength(sourceDataUrl) : undefined,
      viewportRect: viewportRectFromElement(element),
      score: scoreElement(element, normalized, pointHit)
    };
  }

  function detectBackgroundImage(element: Element, pointHit = false): ScriptDetectedContextImage | null {
    if (!isElementVisible(element)) {
      return null;
    }

    const sourceUrl = firstUrlFromCssImage(window.getComputedStyle(element).backgroundImage);
    return detectedFromElement(element, sourceUrl, pointHit);
  }

  function detectAtPoint(point: { clientX: number; clientY: number }): ScriptDetectedContextImage | null {
    const candidates: ScriptDetectedContextImage[] = [];
    const seen = new Set<Element>();
    const addElement = (element: Element | null) => {
      let current: Element | null = element;
      let depth = 0;
      while (current && depth < 8) {
        if (!seen.has(current)) {
          seen.add(current);
          const rect = current.getBoundingClientRect();
          const direct =
            rectContainsPoint(rect, point.clientX, point.clientY, 4)
              ? detectedFromElement(current, getMediaSource(current), true) ??
                detectBackgroundImage(current, true)
              : null;
          if (direct) {
            candidates.push(direct);
          }
        }
        current = current.parentElement;
        depth += 1;
      }
    };

    for (const element of document.elementsFromPoint(point.clientX, point.clientY)) {
      addElement(element);
    }

    for (const element of Array.from(document.querySelectorAll(MEDIA_SELECTOR))) {
      if (rectContainsPoint(element.getBoundingClientRect(), point.clientX, point.clientY, 4)) {
        addElement(element);
      }
    }

    candidates.sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
    return candidates[0] ?? null;
  }

  function detectVisibleMedia(): ScriptDetectedContextImage | null {
    const candidates: ScriptDetectedContextImage[] = [];

    for (const element of Array.from(document.querySelectorAll(MEDIA_SELECTOR))) {
      const candidate = detectedFromElement(element, getMediaSource(element), false);
      if (candidate) {
        candidates.push(candidate);
      }
    }

    for (const element of Array.from(document.body?.querySelectorAll("*") ?? [])) {
      const candidate = detectBackgroundImage(element, false);
      if (candidate) {
        candidates.push(candidate);
      }
    }

    candidates.sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
    return candidates[0] ?? null;
  }

  function detectMetaImage(): ScriptDetectedContextImage | null {
    if (!isInstagram || !/\/(p|reel|reels|tv)\//i.test(location.pathname)) {
      return null;
    }

    const content =
      document
        .querySelector<HTMLMetaElement>(
          'meta[property="og:image"], meta[name="twitter:image"], meta[property="twitter:image"]'
        )
        ?.content?.trim() || "";
    const sourceUrl = normalizeUrl(content);
    if (!isUsableImageUrl(sourceUrl)) {
      return null;
    }

    return {
      srcUrl: sourceUrl,
      pageUrl: location.href,
      context: {
        title: document.title || undefined
      },
      score: viewportArea * 4
    };
  }

  const point = getLastContextPoint();
  return (point ? detectAtPoint(point) : null) ?? detectVisibleMedia() ?? detectMetaImage();
}

async function resolveContextImage(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
): Promise<ResolvedContextImage | null> {
  const pageUrl = info.pageUrl ?? tab?.url;
  const frameOptions = getFrameMessageOptions(info);

  if (info.srcUrl) {
    const context = tab?.id
      ? await sendTabMessage<ContentImageContext>(
          tab.id,
          {
            type: "GET_IMAGE_CONTEXT",
            srcUrl: info.srcUrl
          },
          frameOptions
        )
      : null;
    const scripted =
      isLikelyProtectedImageUrl(info.srcUrl) && tab?.id
        ? await detectContextImageWithScripting(info, tab)
        : null;

    if (scripted?.sourceDataUrl || scripted?.viewportRect) {
      return {
        ...scripted,
        srcUrl: scripted.srcUrl || info.srcUrl,
        pageUrl: pageUrl ?? scripted.pageUrl,
        context: scripted.context ?? context
      };
    }

    return {
      srcUrl: info.srcUrl,
      pageUrl,
      context
    };
  }

  if (!tab?.id) {
    return null;
  }

  const detected = await sendTabMessage<ContentDetectedImage>(
    tab.id,
    {
      type: "GET_CONTEXT_IMAGE"
    },
    frameOptions
  );

  const scripted = await detectContextImageWithScripting(info, tab);
  const cached = getCachedContextImage(
    tab.id,
    Number.isInteger(info.frameId) ? (info.frameId as number) : undefined
  );
  const fallback =
    scripted?.sourceDataUrl || scripted?.viewportRect
      ? scripted
      : detected?.srcUrl
        ? detected
        : scripted ?? cached;

  if (!fallback?.srcUrl) {
    return null;
  }

  const fallbackPageUrl = "pageUrl" in fallback ? fallback.pageUrl : undefined;

  return {
    srcUrl: fallback.srcUrl,
    pageUrl: pageUrl ?? fallbackPageUrl,
    context: fallback.context
  };
}

async function captureImageFromContext(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
): Promise<SelectedImage | null> {
  const resolved = await resolveContextImage(info, tab);
  if (!resolved) {
    return null;
  }

  const image = createSelectedImage(resolved.srcUrl, resolved.pageUrl, resolved.context);
  await setCurrentImage(image);
  await upsertHistoryEntry(image);
  return image;
}

async function handleRuntimeRequest(request: RuntimeRequest): Promise<RuntimeResponse> {
  switch (request.type) {
    case "GET_CURRENT_IMAGE": {
      const image = await getCurrentImage();
      return { ok: true, data: image };
    }
    case "OPEN_SEARCH_ENGINE": {
      const image = await getCurrentImage();
      if (!image) {
        return { ok: false, error: "Select an image first." };
      }
      await openEngine(image, request.engineId);
      return { ok: true };
    }
    case "OPEN_ENABLED_ENGINES": {
      const image = await getCurrentImage();
      if (!image) {
        return { ok: false, error: "Select an image first." };
      }
      const settings = await getSettings();
      await openEnabledEngines(image, settings.enabledEngines);
      return { ok: true };
    }
    case "ANALYZE_CURRENT_IMAGE": {
      const image = await getCurrentImage();
      if (!image) {
        return { ok: false, error: "Select an image first." };
      }
      const analysis = await analyzeAndStore(image);
      return { ok: true, data: analysis };
    }
    case "PROCESS_CURRENT_IMAGE": {
      const image = await getCurrentImage();
      if (!image) {
        return { ok: false, error: "Select an image first." };
      }
      const result = await processCurrentImage(image, request.options);
      return { ok: true, data: result };
    }
    case "DETECT_CURRENT_IMAGE_CROP": {
      const image = await getCurrentImage();
      if (!image) {
        return { ok: false, error: "Select an image first." };
      }
      const result = await detectCurrentImageCrop(image, request.mode, request.tolerance);
      return { ok: true, data: result };
    }
    default:
      return { ok: false, error: "Unsupported request." };
  }
}

async function openEngine(image: SelectedImage, engineId: SearchEngineId): Promise<void> {
  const { image: searchableImage, imageUrl } = await ensureSearchableImageUrl(image);
  const result = buildSearchUrl(engineId, imageUrl);
  if (!result.ok || !result.url) {
    throw new Error(result.reason ?? "This image cannot be opened in that search engine.");
  }
  await createTab(result.url);
  await upsertHistoryEntry(searchableImage, [engineId]);
}

async function openEnabledEngines(
  image: SelectedImage,
  engineIds: SearchEngineId[]
): Promise<void> {
  const { image: searchableImage, imageUrl } = await ensureSearchableImageUrl(image);
  const urls = buildEnabledSearchUrls(engineIds, imageUrl);
  const opened: SearchEngineId[] = [];
  const errors: string[] = [];

  for (const { engineId, result } of urls) {
    if (!result.ok || !result.url) {
      errors.push(result.reason ?? `Could not open ${engineId}.`);
      continue;
    }
    await createTab(result.url, false);
    opened.push(engineId);
  }

  if (opened.length > 0) {
    await upsertHistoryEntry(searchableImage, opened);
  }

  if (opened.length === 0 && errors.length > 0) {
    throw new Error(errors[0]);
  }
}

async function ensureSearchableImageUrl(
  image: SelectedImage
): Promise<{ image: SelectedImage; imageUrl: string }> {
  if (!imageNeedsUploadProxy(image.srcUrl)) {
    return { image, imageUrl: image.srcUrl };
  }

  if (image.remoteImageUrl) {
    return { image, imageUrl: image.remoteImageUrl };
  }

  if (!image.srcUrl.startsWith("data:image/")) {
    throw new Error(
      "This protected image cannot be uploaded from the extension yet. Save or upload the image file in ImageLab first."
    );
  }

  const settings = await getSettings();
  if (!settings.cloudMode) {
    throw new Error(
      "Uploaded-image reverse search needs Cloud Mode. Enable Cloud Mode and set your ImageLab API key in settings."
    );
  }

  const upload = await uploadImageForSearch(
    {
      apiBaseUrl: settings.apiBaseUrl,
      apiKey: settings.apiKey
    },
    {
      image_data_url: image.srcUrl,
      filename: image.title ?? image.id
    }
  );

  const updatedImage: SelectedImage = {
    ...image,
    remoteImageUrl: upload.image_url,
    remoteImageUploadedAt: new Date().toISOString()
  };
  await setCurrentImage(updatedImage);
  await upsertHistoryEntry(updatedImage);

  return { image: updatedImage, imageUrl: upload.image_url };
}

async function processCurrentImage(
  image: SelectedImage,
  options: ImageProcessOptions
): Promise<ImageProcessResult> {
  const settings = await readConverterSettings();
  const sourcePayload = buildStoredImageSourcePayload(image);

  await ensureOffscreenDocument();

  const response = await sendRuntimeMessage<ConvertOffscreenResponse>({
    type: CONVERT_IMAGE_MESSAGE_TYPE,
    payload: {
      ...sourcePayload,
      pageUrl: image.pageUrl || "",
      targetFormat: options.targetFormat,
      crop: options.crop ?? null,
      autoCrop: options.autoCrop ?? null,
      compression: options.compression
        ? {
            ...options.compression,
            targetBytes: normalizeCompressionTargetBytes(options.compression.targetBytes),
            minQuality: options.compression.minQuality ?? settings.compressionMinQuality,
            allowResize: options.compression.allowResize ?? settings.compressionAllowResize
          }
        : null,
      settings
    }
  });

  if (!response.ok || !response.dataUrl || !response.filename) {
    throw errorFromPayload(response.error);
  }

  if (options.download) {
    const downloadId = await chrome.downloads.download({
      url: response.dataUrl,
      filename: response.filename,
      saveAs: settings.downloadMode !== "auto",
      conflictAction: "uniquify"
    });

    if (!downloadId && downloadId !== 0) {
      throw new ConversionError(
        "download_failed",
        "Chrome did not start the download. Check your downloads settings and try again."
      );
    }
  }

  const result = normalizeProcessResult(response);

  if (options.updateCurrent) {
    const updatedImage = createSelectedImage(response.dataUrl, image.pageUrl, {
      title: response.filename,
      width: result.width ?? undefined,
      height: result.height ?? undefined,
      naturalWidth: result.width ?? undefined,
      naturalHeight: result.height ?? undefined,
      altText: image.altText
    });
    await setCurrentImage(updatedImage);
    await upsertHistoryEntry(updatedImage);
  }

  return result;
}

async function detectCurrentImageCrop(
  image: SelectedImage,
  mode: "transparent" | "solid",
  tolerance?: number
): Promise<DetectedCropResult> {
  await ensureOffscreenDocument();

  const response = await sendRuntimeMessage<DetectCropOffscreenResponse>({
    type: DETECT_CROP_MESSAGE_TYPE,
    payload: {
      ...buildStoredImageSourcePayload(image),
      mode,
      tolerance
    }
  });

  if (!response.ok || !response.crop || !response.width || !response.height) {
    throw errorFromPayload(response.error);
  }

  return {
    crop: response.crop,
    width: response.width,
    height: response.height
  };
}

function buildStoredImageSourcePayload(image: SelectedImage): Record<string, unknown> {
  if (isDataUrl(image.srcUrl) || isHttpUrl(image.srcUrl)) {
    return { sourceUrl: image.srcUrl };
  }

  throw new ConversionError(
    "unsupported_url",
    "This image can only be processed from its original right-click menu because the saved URL is not fetchable from ImageLab.",
    { sourceUrl: truncateForDisplay(image.srcUrl) }
  );
}

function normalizeProcessResult(response: ConvertOffscreenResponse): ImageProcessResult {
  return {
    dataUrl: response.dataUrl || "",
    filename: response.filename || "image.png",
    mimeType: response.mimeType || "image/png",
    byteLength: response.byteLength ?? 0,
    width: response.width ?? null,
    height: response.height ?? null,
    sourceFormat: response.sourceFormat,
    skippedRedundant: response.skippedRedundant,
    targetBytes: response.targetBytes ?? undefined,
    targetMet: response.targetMet ?? undefined,
    compressionApplied: response.compressionApplied
  };
}

async function analyzeAndStore(image: SelectedImage): Promise<LocalImageAnalysis> {
  const response = await analyzeImageWithOffscreen(image.srcUrl);
  const analysis: LocalImageAnalysis = response.ok && response.analysis
    ? response.analysis
    : {
        dominantColors: [],
        analyzedAt: new Date().toISOString(),
        error: response.error ?? "Local image analysis failed."
      };

  const current = await getCurrentImage();
  if (current?.id === image.id) {
    await updateCurrentImage({
      width: analysis.width ?? current.width,
      height: analysis.height ?? current.height,
      analysis
    });
  } else {
    await upsertHistoryEntry({
      ...image,
      width: analysis.width ?? image.width,
      height: analysis.height ?? image.height,
      analysis
    });
  }

  return analysis;
}

async function analyzeImageWithOffscreen(srcUrl: string): Promise<OffscreenResponse> {
  await ensureOffscreenDocument();
  return sendRuntimeMessage<OffscreenResponse>({
    type: "OFFSCREEN_ANALYZE_IMAGE",
    srcUrl
  });
}

async function ensureOffscreenDocument(): Promise<void> {
  if (!chrome.offscreen) {
    throw new Error("Offscreen documents are not available in this Chromium build.");
  }

  const offscreenApi = chrome.offscreen as typeof chrome.offscreen & {
    hasDocument?: () => Promise<boolean>;
  };

  if (offscreenApi.hasDocument && (await offscreenApi.hasDocument())) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ["BLOBS", "DOM_PARSER", "CLIPBOARD"] as chrome.offscreen.Reason[],
    justification: "Analyze, convert, and copy selected images locally using browser APIs."
  });
}

function getFrameMessageOptions(
  info: chrome.contextMenus.OnClickData
): chrome.tabs.MessageSendOptions | undefined {
  if (Number.isInteger(info.frameId) && (info.frameId ?? -1) >= 0) {
    return { frameId: info.frameId as number };
  }

  return undefined;
}

function sendTabMessage<T>(
  tabId: number,
  message: unknown,
  options?: chrome.tabs.MessageSendOptions
): Promise<T | null> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, options ?? {}, (response: T | undefined) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response ?? null);
    });
  });
}

function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T | undefined) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!response) {
        reject(new Error("No response received."));
        return;
      }
      resolve(response);
    });
  });
}

async function openImageLabSurface(tabId?: number): Promise<void> {
  void tabId;
  await createTab(chrome.runtime.getURL("sidepanel.html"));
}

async function openConversionErrorPage(
  error: unknown,
  context: { sourceUrl: string; targetLabel: string }
): Promise<void> {
  const serialized = serializeError(error);
  const params = new URLSearchParams({
    code: serialized.code,
    message: serialized.message,
    sourceUrl: truncateForDisplay(context.sourceUrl, 500),
    target: context.targetLabel,
    sourceFormat: serialized.details?.sourceFormat
      ? formatLabel(serialized.details.sourceFormat)
      : "Not detected"
  });

  try {
    await createTab(chrome.runtime.getURL(`${ERROR_PAGE_PATH}?${params.toString()}`));
  } catch (openError) {
    console.error("Could not open ImageLab conversion error page.", openError, serialized);
  }
}

function createTab(url: string, active = true): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active }, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tab);
    });
  });
}

function formatBytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes.toLocaleString(undefined, {
    maximumFractionDigits: megabytes >= 10 ? 0 : 1
  })} MB`;
}
