import {
  AlertTriangle,
  Cloud,
  Crop,
  Download,
  ExternalLink,
  FileArchive,
  FileText,
  History,
  ImageIcon,
  Link,
  Loader2,
  Palette,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Upload,
  Wand2
} from "lucide-react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { OUTPUT_FORMATS, formatLabel } from "../converter/constants";
import {
  DEFAULT_SETTINGS as DEFAULT_CONVERTER_SETTINGS,
  normalizeCompressionTargetBytes,
  readSettings as readConverterSettings
} from "../converter/settings";
import { getCloudUsage, runCloudAnalyze, runCloudSearch, uploadImageForSearch } from "./cloudClient";
import { createSelectedImage, formatDimensions, imageNeedsUploadProxy } from "./imageMetadata";
import { getCloudDisclosure, getThirdPartyDisclosure, getUploadProxyHint } from "./permissions";
import { SEARCH_ENGINES, getSearchEngine } from "./searchEngines";
import {
  getCurrentImage,
  getFavorites,
  getHistory,
  getNotes,
  getSettings,
  setCurrentImage,
  setNote,
  subscribeToStorage,
  toggleFavorite,
  upsertHistoryEntry
} from "./storage";
import type {
  CloudAnalysisResponse,
  CloudSearchResult,
  CloudUsage,
  DetectedCropResult,
  ImageProcessResult,
  ImageLabSettings,
  OutputImageFormat,
  PixelCropRect,
  SearchEngineId,
  SearchHistoryItem,
  SelectedImage
} from "./types";
import { sendRuntimeMessage } from "./runtime";

interface ImageWorkspaceProps {
  surface: "popup" | "sidepanel";
}

type ProcessingBusyAction = "process-image" | "detect-crop-transparent" | "detect-crop-solid";

type BusyAction =
  | SearchEngineId
  | "all"
  | "analysis"
  | "cloud-search"
  | "cloud-analyze"
  | ProcessingBusyAction
  | null;

type ConverterSettings = typeof DEFAULT_CONVERTER_SETTINGS & {
  defaultFormat: OutputImageFormat;
  compressionTargetBytes: number;
  compressionMinQuality: number;
  compressionAllowResize: boolean;
};

const MAX_LOCAL_UPLOAD_BYTES = 2_500_000;

export function ImageWorkspace({ surface }: ImageWorkspaceProps) {
  const [settings, setSettings] = useState<ImageLabSettings | null>(null);
  const [converterSettings, setConverterSettings] = useState<ConverterSettings | null>(null);
  const [currentImage, setCurrentImageState] = useState<SelectedImage | null>(null);
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [favorites, setFavorites] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState<BusyAction>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [cloudResults, setCloudResults] = useState<CloudSearchResult[]>([]);
  const [cloudAnalysis, setCloudAnalysis] = useState<CloudAnalysisResponse | null>(null);
  const [usage, setUsage] = useState<CloudUsage | null>(null);
  const [outputFormat, setOutputFormat] = useState<OutputImageFormat>("png");
  const [cropEnabled, setCropEnabled] = useState(false);
  const [cropRect, setCropRect] = useState<PixelCropRect | null>(null);
  const [compressEnabled, setCompressEnabled] = useState(false);
  const [compressTargetMb, setCompressTargetMb] = useState("2");
  const [processingDefaultsLoaded, setProcessingDefaultsLoaded] = useState(false);

  async function refresh() {
    const [
      nextSettings,
      nextConverterSettings,
      image,
      nextHistory,
      nextNotes,
      nextFavorites
    ] = await Promise.all([
      getSettings(),
      readConverterSettings(),
      getCurrentImage(),
      getHistory(),
      getNotes(),
      getFavorites()
    ]);
    setSettings(nextSettings);
    setConverterSettings(nextConverterSettings as ConverterSettings);
    setCurrentImageState(image);
    setHistory(nextHistory);
    setNotes(nextNotes);
    setFavorites(nextFavorites);
    setNoteDraft(image ? nextNotes[image.id] ?? "" : "");
  }

  useEffect(() => {
    void refresh();
    return subscribeToStorage(() => {
      void refresh();
    });
  }, []);

  useEffect(() => {
    if (!converterSettings || processingDefaultsLoaded) {
      return;
    }

    setOutputFormat(converterSettings.defaultFormat);
    setCompressTargetMb(formatMegabytesInput(converterSettings.compressionTargetBytes));
    setProcessingDefaultsLoaded(true);
  }, [converterSettings, processingDefaultsLoaded]);

  useEffect(() => {
    const size = getImagePixelSize(currentImage);
    setCropEnabled(false);
    setCropRect(size ? { x: 0, y: 0, width: size.width, height: size.height } : null);
  }, [
    currentImage?.id,
    currentImage?.width,
    currentImage?.height,
    currentImage?.analysis?.width,
    currentImage?.analysis?.height
  ]);

  const enabledEngines = useMemo(() => {
    if (!settings) {
      return [];
    }
    return SEARCH_ENGINES.filter((engine) => settings.enabledEngines.includes(engine.id));
  }, [settings]);

  const isFavorite = Boolean(currentImage && favorites.includes(currentImage.id));
  const dimensions = currentImage
    ? formatDimensions(
        currentImage.analysis?.width ?? currentImage.width,
        currentImage.analysis?.height ?? currentImage.height
      )
    : "";
  const uploadProxyHint = currentImage ? getUploadProxyHint(currentImage) : null;

  async function runAction(action: BusyAction, operation: () => Promise<void>) {
    setBusy(action);
    setError("");
    setStatus("");
    try {
      await operation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action failed.");
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  async function openEngine(engineId: SearchEngineId) {
    await runAction(engineId, async () => {
      const response = await sendRuntimeMessage({ type: "OPEN_SEARCH_ENGINE", engineId });
      if (!response.ok) {
        throw new Error(response.error ?? "Could not open search engine.");
      }
      setStatus(`Opened ${getSearchEngine(engineId).name}.`);
    });
  }

  async function openAll() {
    await runAction("all", async () => {
      const response = await sendRuntimeMessage({ type: "OPEN_ENABLED_ENGINES" });
      if (!response.ok) {
        throw new Error(response.error ?? "Could not open enabled engines.");
      }
      setStatus("Opened all enabled engines.");
    });
  }

  async function analyzeCurrentImage() {
    await runAction("analysis", async () => {
      const response = await sendRuntimeMessage({ type: "ANALYZE_CURRENT_IMAGE" });
      if (!response.ok) {
        throw new Error(response.error ?? "Local analysis failed.");
      }
      setStatus("Local analysis refreshed.");
    });
  }

  async function selectImage(image: SelectedImage, message: string) {
    await runAction("analysis", async () => {
      await setCurrentImage(image);
      await upsertHistoryEntry(image);
      setCloudResults([]);
      setCloudAnalysis(null);

      const response = await sendRuntimeMessage({ type: "ANALYZE_CURRENT_IMAGE" });
      setStatus(response.ok ? `${message} Local analysis refreshed.` : message);
    });
  }

  async function addImageUrl() {
    const trimmed = manualUrl.trim();
    if (!trimmed) {
      setError("Enter an image URL first.");
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      setError("Enter a valid HTTP or HTTPS image URL.");
      return;
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      setError("Image URLs must use HTTP or HTTPS.");
      return;
    }

    const image = createSelectedImage(parsed.href, undefined, {
      title: getHostname(parsed.href)
    });
    setManualUrl("");
    await selectImage(image, "Image URL added.");
  }

  async function uploadImage(file: File | null) {
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    if (file.size > MAX_LOCAL_UPLOAD_BYTES) {
      setError("Local uploads are limited to 2.5 MB in this build.");
      return;
    }

    await runAction("analysis", async () => {
      const dataUrl = await readFileAsDataUrl(file);
      const dimensions = await readImageDimensions(dataUrl);
      const image = createSelectedImage(dataUrl, undefined, {
        title: file.name,
        width: dimensions.width,
        height: dimensions.height,
        naturalWidth: dimensions.width,
        naturalHeight: dimensions.height
      });
      await setCurrentImage(image);
      await upsertHistoryEntry(image);
      setCloudResults([]);
      setCloudAnalysis(null);

      const response = await sendRuntimeMessage({ type: "ANALYZE_CURRENT_IMAGE" });
      setStatus(response.ok ? "Image uploaded locally. Local analysis refreshed." : "Image uploaded locally.");
    });
  }

  async function ensureCloudReadyImage(image: SelectedImage): Promise<SelectedImage> {
    if (!imageNeedsUploadProxy(image.srcUrl) || image.remoteImageUrl) {
      return image;
    }
    if (!settings?.cloudMode) {
      throw new Error(
        "Uploaded images need Cloud Mode before they can be sent to cloud search or third-party reverse search."
      );
    }
    if (!image.srcUrl.startsWith("data:image/")) {
      throw new Error("This protected image cannot be uploaded from the extension yet.");
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
    setCurrentImageState(updatedImage);
    return updatedImage;
  }

  async function saveNoteDraft() {
    if (!currentImage) {
      return;
    }
    await setNote(currentImage.id, noteDraft);
    setStatus("Note saved locally.");
    await refresh();
  }

  async function toggleCurrentFavorite() {
    if (!currentImage) {
      return;
    }
    const next = await toggleFavorite(currentImage.id);
    setStatus(next ? "Added to favorites." : "Removed from favorites.");
    await refresh();
  }

  async function selectHistoryItem(item: SearchHistoryItem) {
    await setCurrentImage(item.image);
    setStatus("Loaded history item.");
    await refresh();
  }

  async function cloudSearch() {
    if (!settings || !currentImage) {
      return;
    }
    await runAction("cloud-search", async () => {
      const cloudReadyImage = await ensureCloudReadyImage(currentImage);
      const response = await runCloudSearch(
        { apiBaseUrl: settings.apiBaseUrl, apiKey: settings.apiKey },
        {
          image_url: cloudReadyImage.remoteImageUrl ?? cloudReadyImage.srcUrl,
          page_url: cloudReadyImage.pageUrl,
          enabled_engines: settings.enabledEngines
        }
      );
      setCloudResults(response.results);
      setUsage(response.usage);
      setStatus("Cloud search returned mock normalized results.");
    });
  }

  async function cloudAnalyze() {
    if (!settings || !currentImage) {
      return;
    }
    await runAction("cloud-analyze", async () => {
      const cloudReadyImage = await ensureCloudReadyImage(currentImage);
      const response = await runCloudAnalyze(
        { apiBaseUrl: settings.apiBaseUrl, apiKey: settings.apiKey },
        {
          image_url: cloudReadyImage.remoteImageUrl ?? cloudReadyImage.srcUrl,
          page_url: cloudReadyImage.pageUrl
        }
      );
      setCloudAnalysis(response);
      setStatus("Cloud analysis returned mock AI hints.");
    });
  }

  async function refreshUsage() {
    if (!settings) {
      return;
    }
    await runAction("cloud-search", async () => {
      const response = await getCloudUsage({
        apiBaseUrl: settings.apiBaseUrl,
        apiKey: settings.apiKey
      });
      setUsage(response);
      setStatus("Usage refreshed.");
    });
  }

  async function detectCrop(mode: "transparent" | "solid") {
    if (!currentImage) {
      return;
    }

    await runAction(`detect-crop-${mode}` as ProcessingBusyAction, async () => {
      const response = await sendRuntimeMessage<DetectedCropResult>({
        type: "DETECT_CURRENT_IMAGE_CROP",
        mode
      });
      if (!response.ok || !response.data) {
        throw new Error(response.error ?? "Could not detect a crop area.");
      }
      setCropEnabled(true);
      setCropRect(response.data.crop);
      setStatus(
        mode === "transparent"
          ? "Transparent border crop detected."
          : "Solid-color border crop detected."
      );
    });
  }

  async function processCurrentImage(updateCurrent: boolean) {
    if (!currentImage || !converterSettings) {
      return;
    }

    const compressionTargetBytes = normalizeCompressionTargetBytes(
      Number(compressTargetMb) * 1024 * 1024
    );

    await runAction("process-image", async () => {
      const response = await sendRuntimeMessage<ImageProcessResult>({
        type: "PROCESS_CURRENT_IMAGE",
        options: {
          targetFormat: outputFormat,
          crop: cropEnabled ? cropRect : null,
          compression: compressEnabled
            ? {
                targetBytes: compressionTargetBytes,
                minQuality: converterSettings.compressionMinQuality,
                allowResize: converterSettings.compressionAllowResize
              }
            : null,
          download: !updateCurrent,
          updateCurrent
        }
      });
      if (!response.ok || !response.data) {
        throw new Error(response.error ?? "Could not process the image.");
      }

      const result = response.data;
      const targetMessage =
        compressEnabled && result.targetBytes
          ? result.targetMet
            ? ` under ${formatBytes(result.targetBytes)}`
            : ` at ${formatBytes(result.byteLength)}, above the ${formatBytes(result.targetBytes)} target`
          : "";
      setStatus(
        updateCurrent
          ? `Processed image is now active (${formatLabel(outputFormat)}, ${formatBytes(result.byteLength)}).`
          : `Downloaded ${formatLabel(outputFormat)}${targetMessage}.`
      );
    });
  }

  function openOptions() {
    chrome.runtime.openOptionsPage();
  }

  return (
    <main
      className={
        surface === "popup"
          ? "w-[420px] bg-ink-50 text-ink-900 dark:bg-slate-950 dark:text-slate-100"
          : "min-h-screen bg-ink-50 text-ink-900 dark:bg-slate-950 dark:text-slate-100"
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 p-4">
        <header className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-md bg-ink-900 text-white dark:bg-slate-100 dark:text-slate-950">
                <Search size={17} />
              </div>
              <div>
                <h1 className="text-lg font-semibold leading-tight">ImageLab</h1>
                <p className="text-xs text-ink-500 dark:text-slate-400">
                  Local reverse image workflow
                </p>
              </div>
            </div>
          </div>
          <button
            className="it-button-secondary h-9 w-9 p-0"
            type="button"
            title="Open settings"
            onClick={openOptions}
          >
            <Settings size={17} />
          </button>
        </header>

        {status ? <StatusNotice tone="success">{status}</StatusNotice> : null}
        {error ? <StatusNotice tone="error">{error}</StatusNotice> : null}

        {!settings ? (
          <Panel className="p-5 text-sm text-ink-500">Loading ImageLab...</Panel>
        ) : (
          <>
            <PrivacyStrip settings={settings} />
            <ImageInputPanel
              manualUrl={manualUrl}
              busy={busy}
              onManualUrlChange={setManualUrl}
              onAddImageUrl={addImageUrl}
              onUploadImage={uploadImage}
            />
            <CurrentImageCard
              image={currentImage}
              dimensions={dimensions}
              uploadProxyHint={uploadProxyHint}
              isFavorite={isFavorite}
              onFavorite={toggleCurrentFavorite}
            />

            {currentImage ? (
              <>
                <ImageProcessingPanel
                  image={currentImage}
                  converterSettings={converterSettings}
                  outputFormat={outputFormat}
                  cropEnabled={cropEnabled}
                  cropRect={cropRect}
                  compressEnabled={compressEnabled}
                  compressTargetMb={compressTargetMb}
                  busy={busy}
                  onOutputFormatChange={setOutputFormat}
                  onCropEnabledChange={setCropEnabled}
                  onCropRectChange={setCropRect}
                  onCompressEnabledChange={setCompressEnabled}
                  onCompressTargetMbChange={setCompressTargetMb}
                  onDetectCrop={detectCrop}
                  onProcess={processCurrentImage}
                />

                <Panel className="p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold">Search engines</h2>
                      <p className="text-xs text-ink-500 dark:text-slate-400">
                        Opens a third-party page with the image URL.
                      </p>
                    </div>
                    <Badge tone="warning">Sends to search engine</Badge>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {enabledEngines.map((engine) => (
                      <button
                        key={engine.id}
                        className="it-button-secondary justify-between"
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void openEngine(engine.id)}
                      >
                        <span className="flex items-center gap-2">
                          {busy === engine.id ? <Loader2 className="animate-spin" size={16} /> : <ExternalLink size={16} />}
                          {engine.name}
                        </span>
                      </button>
                    ))}
                  </div>
                  <button
                    className="it-button-primary mt-3 w-full"
                    type="button"
                    disabled={busy !== null || enabledEngines.length === 0}
                    onClick={() => void openAll()}
                  >
                    {busy === "all" ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
                    Open all enabled engines
                  </button>
                </Panel>

                <Panel className="p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Palette size={17} />
                      <h2 className="text-sm font-semibold">Local analysis</h2>
                    </div>
                    <Badge tone="local">Local</Badge>
                  </div>
                  <ColorList colors={currentImage.analysis?.dominantColors ?? []} />
                  <div className="mt-3 rounded-md bg-ink-50 p-3 text-xs text-ink-700 dark:bg-slate-800 dark:text-slate-300">
                    <div className="mb-1 flex items-center gap-2 font-semibold">
                      <FileText size={14} />
                      OCR
                    </div>
                    {currentImage.analysis?.ocr?.text ? (
                      <p>{currentImage.analysis.ocr.text}</p>
                    ) : (
                      <p>{currentImage.analysis?.ocr?.message ?? "Optional OCR adapter is ready; Tesseract.js is not bundled by default."}</p>
                    )}
                  </div>
                  {currentImage.analysis?.error ? (
                    <StatusNotice tone="error">{currentImage.analysis.error}</StatusNotice>
                  ) : null}
                  <button
                    className="it-button-secondary mt-3 w-full"
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void analyzeCurrentImage()}
                  >
                    {busy === "analysis" ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
                    Refresh local analysis
                  </button>
                </Panel>

                <Panel className="p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">Notes</h2>
                    <Badge tone="local">Local</Badge>
                  </div>
                  <textarea
                    className="min-h-20 w-full resize-y rounded-md border border-ink-100 bg-white p-2 text-sm outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-500/20 dark:border-slate-700 dark:bg-slate-950"
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    placeholder="Add local notes or tags..."
                  />
                  <button className="it-button-secondary mt-2 w-full" type="button" onClick={() => void saveNoteDraft()}>
                    Save note
                  </button>
                </Panel>

                <CloudSection
                  settings={settings}
                  usage={usage}
                  results={cloudResults}
                  analysis={cloudAnalysis}
                  busy={busy}
                  onSearch={cloudSearch}
                  onAnalyze={cloudAnalyze}
                  onRefreshUsage={refreshUsage}
                />
              </>
            ) : null}

            <HistoryList history={history} notes={notes} onSelect={selectHistoryItem} />
          </>
        )}
      </div>
    </main>
  );
}

function Panel({ className = "", children }: { className?: string; children: ReactNode }) {
  return <section className={`it-panel rounded-lg ${className}`}>{children}</section>;
}

function Badge({ tone, children }: { tone: "local" | "warning" | "cloud"; children: ReactNode }) {
  const classes = {
    local: "bg-signal-500/10 text-signal-600 dark:text-emerald-300",
    warning: "bg-amber-400/15 text-amber-700 dark:text-amber-300",
    cloud: "bg-berry-500/10 text-berry-600 dark:text-pink-300"
  };
  return <span className={`it-badge ${classes[tone]}`}>{children}</span>;
}

function StatusNotice({ tone, children }: { tone: "success" | "error"; children: ReactNode }) {
  return (
    <div
      className={`rounded-md border p-3 text-sm ${
        tone === "success"
          ? "border-signal-500/30 bg-signal-500/10 text-signal-600 dark:text-emerald-300"
          : "border-red-400/30 bg-red-400/10 text-red-700 dark:text-red-300"
      }`}
    >
      {children}
    </div>
  );
}

function PrivacyStrip({ settings }: { settings: ImageLabSettings }) {
  return (
    <Panel className="grid gap-2 p-3 text-xs text-ink-700 dark:text-slate-300">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 shrink-0 text-signal-600" size={16} />
        <span>{getThirdPartyDisclosure(settings)}</span>
      </div>
      <div className="flex items-start gap-2">
        <Cloud className="mt-0.5 shrink-0 text-berry-600" size={16} />
        <span>{getCloudDisclosure(settings)}</span>
      </div>
    </Panel>
  );
}

function ImageInputPanel({
  manualUrl,
  busy,
  onManualUrlChange,
  onAddImageUrl,
  onUploadImage
}: {
  manualUrl: string;
  busy: BusyAction;
  onManualUrlChange: (value: string) => void;
  onAddImageUrl: () => void;
  onUploadImage: (file: File | null) => void;
}) {
  return (
    <Panel className="p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ImageIcon size={17} />
          <h2 className="text-sm font-semibold">Add image</h2>
        </div>
        <Badge tone="local">Local</Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input
          className="min-w-0 rounded-md border border-ink-100 bg-white px-3 py-2 text-sm outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-500/20 dark:border-slate-700 dark:bg-slate-950"
          type="url"
          value={manualUrl}
          placeholder="https://example.com/image.jpg"
          onChange={(event) => onManualUrlChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAddImageUrl();
            }
          }}
        />
        <button
          className="it-button-secondary"
          type="button"
          disabled={busy !== null}
          onClick={onAddImageUrl}
        >
          <Link size={16} />
          Use URL
        </button>
      </div>
      <label className="it-button-secondary mt-2 w-full cursor-pointer">
        <Upload size={16} />
        Upload image
        <input
          className="sr-only"
          type="file"
          accept="image/*"
          disabled={busy !== null}
          onChange={(event) => {
            void onUploadImage(event.currentTarget.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
        />
      </label>
      <p className="mt-2 text-xs text-ink-500 dark:text-slate-400">
        Uploaded images stay local until you run cloud or reverse search.
      </p>
    </Panel>
  );
}

function CurrentImageCard({
  image,
  dimensions,
  uploadProxyHint,
  isFavorite,
  onFavorite
}: {
  image: SelectedImage | null;
  dimensions: string;
  uploadProxyHint: string | null;
  isFavorite: boolean;
  onFavorite: () => void;
}) {
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    setPreviewFailed(false);
  }, [image?.id]);

  if (!image) {
    return (
      <Panel className="p-5 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-md bg-ink-100 text-ink-500 dark:bg-slate-800">
          <ImageIcon size={22} />
        </div>
        <h2 className="mt-3 text-base font-semibold">No image selected</h2>
        <p className="mt-1 text-sm text-ink-500 dark:text-slate-400">
          Right-click an image on a web page and choose ImageLab.
        </p>
      </Panel>
    );
  }

  return (
    <Panel className="overflow-hidden">
      <div className="grid grid-cols-[96px_1fr] gap-3 p-3">
        <div className="grid h-24 w-24 place-items-center overflow-hidden rounded-md bg-ink-100 dark:bg-slate-800">
          {!previewFailed ? (
            <img
              className="h-full w-full object-cover"
              src={image.srcUrl}
              alt={image.altText || "Selected image preview"}
              onError={() => setPreviewFailed(true)}
            />
          ) : (
            <ImageIcon className="text-ink-500" size={26} />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">
                {image.altText || image.title || getHostname(image.srcUrl)}
              </h2>
              <p className="mt-1 truncate text-xs text-ink-500 dark:text-slate-400">
                {getHostname(image.pageUrl ?? image.srcUrl)}
              </p>
            </div>
            <button
              className={`it-button-secondary h-9 w-9 shrink-0 p-0 ${
                isFavorite ? "text-amber-500" : ""
              }`}
              type="button"
              title={isFavorite ? "Remove favorite" : "Add favorite"}
              onClick={onFavorite}
            >
              <Star size={17} fill={isFavorite ? "currentColor" : "none"} />
            </button>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-ink-500 dark:text-slate-400">Dimensions</dt>
              <dd className="font-medium">{dimensions}</dd>
            </div>
            <div>
              <dt className="text-ink-500 dark:text-slate-400">Captured</dt>
              <dd className="font-medium">{new Date(image.capturedAt).toLocaleString()}</dd>
            </div>
          </dl>
        </div>
      </div>
      {uploadProxyHint ? (
        <div className="flex items-start gap-2 border-t border-ink-100 bg-amber-400/10 p-3 text-xs text-amber-800 dark:border-slate-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 shrink-0" size={14} />
          <span>{uploadProxyHint}</span>
        </div>
      ) : null}
    </Panel>
  );
}

function ImageProcessingPanel({
  image,
  converterSettings,
  outputFormat,
  cropEnabled,
  cropRect,
  compressEnabled,
  compressTargetMb,
  busy,
  onOutputFormatChange,
  onCropEnabledChange,
  onCropRectChange,
  onCompressEnabledChange,
  onCompressTargetMbChange,
  onDetectCrop,
  onProcess
}: {
  image: SelectedImage;
  converterSettings: ConverterSettings | null;
  outputFormat: OutputImageFormat;
  cropEnabled: boolean;
  cropRect: PixelCropRect | null;
  compressEnabled: boolean;
  compressTargetMb: string;
  busy: BusyAction;
  onOutputFormatChange: (format: OutputImageFormat) => void;
  onCropEnabledChange: (enabled: boolean) => void;
  onCropRectChange: (crop: PixelCropRect) => void;
  onCompressEnabledChange: (enabled: boolean) => void;
  onCompressTargetMbChange: (value: string) => void;
  onDetectCrop: (mode: "transparent" | "solid") => void;
  onProcess: (updateCurrent: boolean) => void;
}) {
  const imageSize = getImagePixelSize(image);
  const normalizedCrop = imageSize && cropRect ? clampCropRect(cropRect, imageSize.width, imageSize.height) : null;
  const processingBusy = busy === "process-image";
  const cropBusy = busy === "detect-crop-transparent" || busy === "detect-crop-solid";

  function resetCrop() {
    if (!imageSize) {
      return;
    }
    onCropEnabledChange(false);
    onCropRectChange({ x: 0, y: 0, width: imageSize.width, height: imageSize.height });
  }

  function setCenteredAspectCrop(aspectRatio: number) {
    if (!imageSize) {
      return;
    }

    const sourceRatio = imageSize.width / imageSize.height;
    const width = sourceRatio > aspectRatio ? Math.round(imageSize.height * aspectRatio) : imageSize.width;
    const height = sourceRatio > aspectRatio ? imageSize.height : Math.round(imageSize.width / aspectRatio);
    onCropEnabledChange(true);
    onCropRectChange({
      x: Math.round((imageSize.width - width) / 2),
      y: Math.round((imageSize.height - height) / 2),
      width,
      height
    });
  }

  return (
    <Panel className="p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={17} />
          <h2 className="text-sm font-semibold">Process image</h2>
        </div>
        <Badge tone="local">Local</Badge>
      </div>

      <div className="grid gap-3">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Convert to</span>
          <select
            className="rounded-md border border-ink-100 bg-white px-3 py-2 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-500/20 dark:border-slate-700 dark:bg-slate-950"
            value={outputFormat}
            onChange={(event) => onOutputFormatChange(event.target.value as OutputImageFormat)}
          >
            {OUTPUT_FORMATS.map((format) => (
              <option key={format} value={format}>
                {formatLabel(format)}
              </option>
            ))}
          </select>
        </label>

        <div className="rounded-md border border-ink-100 bg-white p-3 dark:border-slate-700 dark:bg-slate-950">
          <label className="mb-3 flex cursor-pointer items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 font-semibold">
              <Crop size={16} />
              Crop
            </span>
            <input
              className="h-5 w-5 accent-signal-600"
              type="checkbox"
              checked={cropEnabled}
              disabled={!imageSize}
              onChange={(event) => onCropEnabledChange(event.target.checked)}
            />
          </label>

          {imageSize && normalizedCrop ? (
            <div className="grid gap-3">
              <CropPreview
                image={image}
                sourceWidth={imageSize.width}
                sourceHeight={imageSize.height}
                cropRect={normalizedCrop}
                disabled={!cropEnabled}
                onCropRectChange={(nextCrop) => {
                  onCropEnabledChange(true);
                  onCropRectChange(nextCrop);
                }}
              />
              <div className="grid grid-cols-4 gap-2">
                <CropNumberField
                  label="X"
                  value={normalizedCrop.x}
                  max={imageSize.width - 1}
                  disabled={!cropEnabled}
                  onChange={(x) =>
                    onCropRectChange(clampCropRect({ ...normalizedCrop, x }, imageSize.width, imageSize.height))
                  }
                />
                <CropNumberField
                  label="Y"
                  value={normalizedCrop.y}
                  max={imageSize.height - 1}
                  disabled={!cropEnabled}
                  onChange={(y) =>
                    onCropRectChange(clampCropRect({ ...normalizedCrop, y }, imageSize.width, imageSize.height))
                  }
                />
                <CropNumberField
                  label="W"
                  value={normalizedCrop.width}
                  max={imageSize.width}
                  disabled={!cropEnabled}
                  onChange={(width) =>
                    onCropRectChange(clampCropRect({ ...normalizedCrop, width }, imageSize.width, imageSize.height))
                  }
                />
                <CropNumberField
                  label="H"
                  value={normalizedCrop.height}
                  max={imageSize.height}
                  disabled={!cropEnabled}
                  onChange={(height) =>
                    onCropRectChange(clampCropRect({ ...normalizedCrop, height }, imageSize.width, imageSize.height))
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button
                  className="it-button-secondary"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => onDetectCrop("transparent")}
                >
                  {busy === "detect-crop-transparent" ? <Loader2 className="animate-spin" size={16} /> : <Wand2 size={16} />}
                  Transparent
                </button>
                <button
                  className="it-button-secondary"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => onDetectCrop("solid")}
                >
                  {busy === "detect-crop-solid" ? <Loader2 className="animate-spin" size={16} /> : <Wand2 size={16} />}
                  Solid
                </button>
                <button className="it-button-secondary" type="button" disabled={busy !== null} onClick={() => setCenteredAspectCrop(1)}>
                  1:1
                </button>
                <button className="it-button-secondary" type="button" disabled={busy !== null} onClick={resetCrop}>
                  <RotateCcw size={16} />
                  Reset
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button className="it-button-secondary" type="button" disabled={busy !== null} onClick={() => setCenteredAspectCrop(4 / 3)}>
                  4:3
                </button>
                <button className="it-button-secondary" type="button" disabled={busy !== null} onClick={() => setCenteredAspectCrop(16 / 9)}>
                  16:9
                </button>
              </div>
            </div>
          ) : (
            <p className="rounded-md bg-ink-50 p-3 text-sm text-ink-500 dark:bg-slate-800 dark:text-slate-400">
              Image dimensions are needed before manual crop controls can be shown.
            </p>
          )}
        </div>

        <div className="rounded-md border border-ink-100 bg-white p-3 dark:border-slate-700 dark:bg-slate-950">
          <label className="mb-3 flex cursor-pointer items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 font-semibold">
              <FileArchive size={16} />
              Compress
            </span>
            <input
              className="h-5 w-5 accent-signal-600"
              type="checkbox"
              checked={compressEnabled}
              onChange={(event) => onCompressEnabledChange(event.target.checked)}
            />
          </label>
          <label className={`grid gap-1 text-sm ${compressEnabled ? "" : "opacity-60"}`}>
            <span className="font-medium">Target size</span>
            <div className="grid grid-cols-[1fr_56px] gap-2">
              <input
                className="rounded-md border border-ink-100 bg-white px-3 py-2 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-500/20 disabled:cursor-not-allowed dark:border-slate-700 dark:bg-slate-950"
                type="number"
                min="0.05"
                max="100"
                step="0.1"
                value={compressTargetMb}
                disabled={!compressEnabled}
                onChange={(event) => onCompressTargetMbChange(event.target.value)}
              />
              <span className="grid place-items-center rounded-md border border-ink-100 bg-ink-50 text-sm font-medium dark:border-slate-700 dark:bg-slate-800">
                MB
              </span>
            </div>
          </label>
          {converterSettings ? (
            <p className="mt-2 text-xs text-ink-500 dark:text-slate-400">
              Uses minimum quality {converterSettings.compressionMinQuality.toFixed(2)}
              {converterSettings.compressionAllowResize ? " and may shrink dimensions." : "."}
            </p>
          ) : null}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            className="it-button-primary"
            type="button"
            disabled={busy !== null || cropBusy}
            onClick={() => onProcess(false)}
          >
            {processingBusy ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
            Download result
          </button>
          <button
            className="it-button-secondary"
            type="button"
            disabled={busy !== null || cropBusy}
            onClick={() => onProcess(true)}
          >
            {processingBusy ? <Loader2 className="animate-spin" size={16} /> : <ImageIcon size={16} />}
            Use result
          </button>
        </div>
      </div>
    </Panel>
  );
}

function CropPreview({
  image,
  sourceWidth,
  sourceHeight,
  cropRect,
  disabled,
  onCropRectChange
}: {
  image: SelectedImage;
  sourceWidth: number;
  sourceHeight: number;
  cropRect: PixelCropRect;
  disabled: boolean;
  onCropRectChange: (crop: PixelCropRect) => void;
}) {
  type DragMode = "draw" | "move" | "nw" | "ne" | "sw" | "se";
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{
    mode: DragMode;
    startX: number;
    startY: number;
    startRect: PixelCropRect;
  } | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const left = (cropRect.x / sourceWidth) * 100;
  const top = (cropRect.y / sourceHeight) * 100;
  const width = (cropRect.width / sourceWidth) * 100;
  const height = (cropRect.height / sourceHeight) * 100;

  useEffect(() => {
    setPreviewFailed(false);
  }, [image.id]);

  function getPoint(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }

    return {
      x: clampNumber(Math.round(((event.clientX - rect.left) / rect.width) * sourceWidth), 0, sourceWidth),
      y: clampNumber(Math.round(((event.clientY - rect.top) / rect.height) * sourceHeight), 0, sourceHeight)
    };
  }

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>, mode: DragMode) {
    if (disabled) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    previewRef.current?.setPointerCapture(event.pointerId);
    const point = getPoint(event);
    setDrag({
      mode,
      startX: point.x,
      startY: point.y,
      startRect: cropRect
    });
  }

  function updateDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag || disabled) {
      return;
    }

    const point = getPoint(event);
    const deltaX = point.x - drag.startX;
    const deltaY = point.y - drag.startY;
    const start = drag.startRect;
    let next = start;

    if (drag.mode === "draw") {
      next = {
        x: Math.min(drag.startX, point.x),
        y: Math.min(drag.startY, point.y),
        width: Math.abs(point.x - drag.startX),
        height: Math.abs(point.y - drag.startY)
      };
    } else if (drag.mode === "move") {
      next = {
        ...start,
        x: start.x + deltaX,
        y: start.y + deltaY
      };
    } else {
      const leftEdge = drag.mode.includes("w") ? start.x + deltaX : start.x;
      const rightEdge = drag.mode.includes("e") ? start.x + start.width + deltaX : start.x + start.width;
      const topEdge = drag.mode.includes("n") ? start.y + deltaY : start.y;
      const bottomEdge = drag.mode.includes("s") ? start.y + start.height + deltaY : start.y + start.height;
      next = {
        x: Math.min(leftEdge, rightEdge),
        y: Math.min(topEdge, bottomEdge),
        width: Math.abs(rightEdge - leftEdge),
        height: Math.abs(bottomEdge - topEdge)
      };
    }

    onCropRectChange(clampCropRect(next, sourceWidth, sourceHeight));
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (previewRef.current?.hasPointerCapture(event.pointerId)) {
      previewRef.current.releasePointerCapture(event.pointerId);
    }
    setDrag(null);
  }

  return (
    <div
      ref={previewRef}
      className={`relative w-full touch-none select-none overflow-hidden rounded-md bg-ink-100 dark:bg-slate-800 ${
        disabled ? "cursor-not-allowed" : "cursor-crosshair"
      }`}
      style={{ aspectRatio: `${sourceWidth} / ${sourceHeight}` }}
      onPointerDown={(event) => beginDrag(event, "draw")}
      onPointerMove={updateDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {!previewFailed ? (
        <img
          className="h-full w-full object-fill"
          src={image.srcUrl}
          alt=""
          draggable={false}
          onError={() => setPreviewFailed(true)}
        />
      ) : (
        <div className="grid h-full place-items-center text-ink-500">
          <ImageIcon size={28} />
        </div>
      )}
      <div
        className="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
        style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
        onPointerDown={(event) => beginDrag(event, "move")}
      >
        {(["nw", "ne", "sw", "se"] as const).map((handle) => (
          <div
            key={handle}
            className={`absolute h-4 w-4 rounded-full border-2 border-white bg-signal-500 ${
              handle.includes("n") ? "-top-2" : "-bottom-2"
            } ${handle.includes("w") ? "-left-2" : "-right-2"}`}
            onPointerDown={(event) => beginDrag(event, handle)}
          />
        ))}
      </div>
    </div>
  );
}

function CropNumberField({
  label,
  value,
  max,
  disabled,
  onChange
}: {
  label: string;
  value: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1 text-xs font-medium">
      <span>{label}</span>
      <input
        className="min-w-0 rounded-md border border-ink-100 bg-white px-2 py-2 text-sm outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-500/20 disabled:cursor-not-allowed dark:border-slate-700 dark:bg-slate-950"
        type="number"
        min="0"
        max={max}
        step="1"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ColorList({ colors }: { colors: Array<{ hex: string; percentage: number }> }) {
  if (colors.length === 0) {
    return (
      <p className="rounded-md bg-ink-50 p-3 text-sm text-ink-500 dark:bg-slate-800 dark:text-slate-400">
        Dominant colors will appear after local canvas analysis succeeds.
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      {colors.map((color) => (
        <div key={color.hex} className="flex items-center gap-3">
          <span
            className="h-7 w-7 shrink-0 rounded-md border border-black/10"
            style={{ backgroundColor: color.hex }}
          />
          <span className="w-20 text-sm font-medium">{color.hex}</span>
          <div className="h-2 flex-1 overflow-hidden rounded bg-ink-100 dark:bg-slate-800">
            <div className="h-full rounded bg-signal-500" style={{ width: `${color.percentage}%` }} />
          </div>
          <span className="w-10 text-right text-xs text-ink-500 dark:text-slate-400">
            {color.percentage}%
          </span>
        </div>
      ))}
    </div>
  );
}

function CloudSection({
  settings,
  usage,
  results,
  analysis,
  busy,
  onSearch,
  onAnalyze,
  onRefreshUsage
}: {
  settings: ImageLabSettings;
  usage: CloudUsage | null;
  results: CloudSearchResult[];
  analysis: CloudAnalysisResponse | null;
  busy: BusyAction;
  onSearch: () => void;
  onAnalyze: () => void;
  onRefreshUsage: () => void;
}) {
  return (
    <Panel className="p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Cloud size={17} />
          <h2 className="text-sm font-semibold">Cloud mode</h2>
        </div>
        <Badge tone="cloud">Cloud Pro</Badge>
      </div>

      {!settings.cloudMode ? (
        <p className="rounded-md bg-ink-50 p-3 text-sm text-ink-500 dark:bg-slate-800 dark:text-slate-400">
          Cloud mode is off in settings. Local search and analysis remain fully usable.
        </p>
      ) : (
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <button className="it-button-secondary" type="button" disabled={busy !== null} onClick={onSearch}>
              {busy === "cloud-search" ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
              Cloud search
            </button>
            <button className="it-button-secondary" type="button" disabled={busy !== null} onClick={onAnalyze}>
              {busy === "cloud-analyze" ? <Loader2 className="animate-spin" size={16} /> : <FileText size={16} />}
              AI analyze
            </button>
          </div>
          <button className="it-button-secondary w-full" type="button" disabled={busy !== null} onClick={onRefreshUsage}>
            Usage: {usage ? `${usage.used}/${usage.limit ?? "unlimited"} this month` : "refresh"}
          </button>
          {results.length > 0 ? (
            <div className="grid gap-2">
              {results.map((result) => (
                <a
                  key={`${result.engine}-${result.url}`}
                  className="rounded-md border border-ink-100 bg-white p-3 text-sm hover:bg-ink-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-900"
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <div className="font-semibold">{result.title}</div>
                  <div className="mt-1 text-xs text-ink-500 dark:text-slate-400">
                    {result.engine} - {Math.round(result.confidence * 100)}%
                  </div>
                  <p className="mt-1 text-xs">{result.snippet}</p>
                </a>
              ))}
            </div>
          ) : null}
          {analysis ? (
            <div className="rounded-md bg-ink-50 p-3 text-sm dark:bg-slate-800">
              <p className="font-semibold">{analysis.description}</p>
              <p className="mt-2 text-xs text-ink-500 dark:text-slate-400">
                Suggested: {analysis.suggested_queries.join(", ")}
              </p>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

function HistoryList({
  history,
  notes,
  onSelect
}: {
  history: SearchHistoryItem[];
  notes: Record<string, string>;
  onSelect: (item: SearchHistoryItem) => void;
}) {
  return (
    <Panel className="p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <History size={17} />
          <h2 className="text-sm font-semibold">Local history</h2>
        </div>
        <Badge tone="local">Local</Badge>
      </div>
      {history.length === 0 ? (
        <p className="text-sm text-ink-500 dark:text-slate-400">No searches recorded yet.</p>
      ) : (
        <div className="grid max-h-80 gap-2 overflow-y-auto pr-1">
          {history.map((item) => (
            <button
              key={item.id}
              className="grid grid-cols-[44px_1fr] gap-2 rounded-md border border-ink-100 bg-white p-2 text-left hover:bg-ink-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-900"
              type="button"
              onClick={() => onSelect(item)}
            >
              <div className="h-11 w-11 overflow-hidden rounded bg-ink-100 dark:bg-slate-800">
                <img className="h-full w-full object-cover" src={item.image.srcUrl} alt="" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  {item.favorite ? <Star className="text-amber-500" size={13} fill="currentColor" /> : null}
                  <span className="truncate text-sm font-medium">
                    {item.image.altText || getHostname(item.image.srcUrl)}
                  </span>
                </div>
                <p className="truncate text-xs text-ink-500 dark:text-slate-400">
                  {item.engines.length ? item.engines.join(", ") : "Captured"}
                </p>
                {notes[item.id] ? (
                  <p className="mt-1 truncate text-xs text-ink-700 dark:text-slate-300">{notes[item.id]}</p>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}

function getImagePixelSize(image: SelectedImage | null): { width: number; height: number } | null {
  const width = image?.analysis?.width ?? image?.width;
  const height = image?.analysis?.height ?? image?.height;
  if (!width || !height) {
    return null;
  }

  return {
    width,
    height
  };
}

function clampCropRect(crop: PixelCropRect, sourceWidth: number, sourceHeight: number): PixelCropRect {
  const minSize = Math.max(1, Math.round(Math.min(sourceWidth, sourceHeight) * 0.01));
  const width = clampNumber(Math.round(crop.width), minSize, sourceWidth);
  const height = clampNumber(Math.round(crop.height), minSize, sourceHeight);
  const x = clampNumber(Math.round(crop.x), 0, sourceWidth - width);
  const y = clampNumber(Math.round(crop.y), 0, sourceHeight - height);

  return { x, y, width, height };
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  const megabytes = bytes / (1024 * 1024);
  return `${megabytes.toLocaleString(undefined, {
    maximumFractionDigits: megabytes >= 10 ? 0 : 1
  })} MB`;
}

function formatMegabytesInput(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return Number(megabytes.toFixed(2)).toString();
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 60);
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read the uploaded image."));
    };
    reader.onerror = () => reject(new Error("Could not read the uploaded image."));
    reader.readAsDataURL(file);
  });
}

function readImageDimensions(srcUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height
      });
    image.onerror = () => reject(new Error("Could not inspect the uploaded image."));
    image.src = srcUrl;
  });
}
