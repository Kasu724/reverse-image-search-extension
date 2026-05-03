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

type DetectCropOffscreenResponse = {
  ok: boolean;
  crop?: DetectedCropResult["crop"];
  width?: number;
  height?: number;
  error?: unknown;
};

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

chrome.runtime.onMessage.addListener((request: RuntimeRequest, _sender, sendResponse) => {
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

async function handleImageContextClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
  action: ImageContextMenuAction
): Promise<void> {
  if (action.type === "convert" || action.type === "convert-default") {
    await handleImageConversionContextClick(info, tab, action);
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
      sourceUrl: info.srcUrl || "",
      targetLabel
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
  if (!info.srcUrl) {
    throw new ConversionError(
      "missing_image_url",
      "This image does not expose a usable URL to the extension."
    );
  }

  const settings = await readConverterSettings();
  const targetFormat = action.type === "convert-default" ? settings.defaultFormat : action.format;

  await processAndDownloadImage(info, tab, {
    targetFormat: targetFormat as OutputImageFormat
  });
}

async function processAndDownloadImage(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
  options: Partial<ImageProcessOptions> & { targetFormat: OutputImageFormat }
): Promise<ConvertOffscreenResponse> {
  const settings = await readConverterSettings();
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
      settings
    }
  });

  if (!response.ok || !response.dataUrl || !response.filename) {
    throw errorFromPayload(response.error);
  }

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
  const sourceUrl = info.srcUrl;

  if (!sourceUrl) {
    throw new ConversionError(
      "missing_image_url",
      "The selected image does not have a usable URL."
    );
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

async function captureImageFromContext(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab
): Promise<SelectedImage | null> {
  if (!info.srcUrl) {
    return null;
  }

  const context = tab?.id
    ? await sendTabMessage<ContentImageContext>(tab.id, {
        type: "GET_IMAGE_CONTEXT",
        srcUrl: info.srcUrl
      })
    : null;

  const image = createSelectedImage(info.srcUrl, info.pageUrl ?? tab?.url, context);
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
    reasons: ["BLOBS", "DOM_PARSER"] as chrome.offscreen.Reason[],
    justification: "Analyze and convert selected images locally using canvas APIs."
  });
}

function sendTabMessage<T>(tabId: number, message: unknown): Promise<T | null> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response: T | undefined) => {
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
