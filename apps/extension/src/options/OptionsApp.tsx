import {
  Cloud,
  Download,
  ImageIcon,
  KeyRound,
  Loader2,
  PanelRightOpen,
  Search,
  ShieldCheck,
  ToggleLeft
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { OUTPUT_FORMATS, formatLabel } from "../converter/constants";
import {
  DEFAULT_SETTINGS as DEFAULT_CONVERTER_SETTINGS,
  DOWNLOAD_MODES,
  MAX_RESIZE_DIMENSION,
  normalizeCompressionTargetBytes,
  normalizeHexColor,
  normalizeResizeDimension,
  normalizeSettings as normalizeConverterSettings,
  readSettings as readConverterSettings,
  resetSettings as resetConverterSettings,
  writeSettings as writeConverterSettings
} from "../converter/settings";
import { getCloudUsage } from "../shared/cloudClient";
import { SEARCH_ENGINES } from "../shared/searchEngines";
import { DEFAULT_SETTINGS, getSettings, saveSettings } from "../shared/storage";
import type { CloudUsage, ImageLabSettings, SearchEngineId } from "../shared/types";

type ConverterSettings = {
  defaultFormat: string;
  jpgQuality: number;
  webpQuality: number;
  jpgBackgroundColor: string;
  askWhereToSave: boolean;
  downloadMode: string;
  skipRedundantConversion: boolean;
  preserveDimensions: boolean;
  resizeWidth: number | null;
  resizeHeight: number | null;
  compressionTargetBytes: number;
  compressionMinQuality: number;
  compressionAllowResize: boolean;
};

export function OptionsApp() {
  const [settings, setSettings] = useState<ImageLabSettings>(DEFAULT_SETTINGS);
  const [converterSettings, setConverterSettings] = useState<ConverterSettings>(
    DEFAULT_CONVERTER_SETTINGS
  );
  const [usage, setUsage] = useState<CloudUsage | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loadingUsage, setLoadingUsage] = useState(false);

  useEffect(() => {
    void Promise.all([getSettings(), readConverterSettings()]).then(
      ([nextSearchSettings, nextConverterSettings]) => {
        setSettings(nextSearchSettings);
        setConverterSettings(nextConverterSettings as ConverterSettings);
      }
    );
  }, []);

  const enabledSet = useMemo(() => new Set(settings.enabledEngines), [settings.enabledEngines]);

  async function update(partial: Partial<ImageLabSettings>) {
    const next = {
      ...settings,
      ...partial
    };
    setSettings(next);
    await saveSettings(partial);
    setStatus("Settings saved.");
    setError("");
  }

  async function toggleEngine(engineId: SearchEngineId) {
    const next = enabledSet.has(engineId)
      ? settings.enabledEngines.filter((id) => id !== engineId)
      : [...settings.enabledEngines, engineId];
    await update({ enabledEngines: next });
  }

  async function updateConverter(partial: Partial<ConverterSettings>) {
    const next = normalizeConverterSettings({
      ...converterSettings,
      ...partial
    });
    setConverterSettings(next as ConverterSettings);
    await writeConverterSettings(next);
    setStatus("Settings saved.");
    setError("");
  }

  async function resetConverter() {
    const defaults = await resetConverterSettings();
    setConverterSettings(defaults as ConverterSettings);
    setStatus("Conversion settings reset.");
    setError("");
  }

  async function refreshUsage() {
    setLoadingUsage(true);
    setStatus("");
    setError("");
    try {
      const response = await getCloudUsage({
        apiBaseUrl: settings.apiBaseUrl,
        apiKey: settings.apiKey
      });
      setUsage(response);
      setStatus("Usage loaded from the configured API.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load usage.");
    } finally {
      setLoadingUsage(false);
    }
  }

  async function openImageLabPanel() {
    await chrome.tabs.create({
      url: chrome.runtime.getURL("sidepanel.html")
    });
  }

  return (
    <main className="min-h-screen bg-ink-50 p-4 text-ink-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto grid max-w-4xl gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">ImageLab settings</h1>
            <p className="text-sm text-ink-500 dark:text-slate-400">
              Configure conversion, reverse search, privacy defaults, and optional cloud mode.
            </p>
          </div>
          <button
            className="it-button-primary"
            type="button"
            onClick={() => void openImageLabPanel()}
          >
            <PanelRightOpen size={16} />
            Open ImageLab
          </button>
        </header>

        {status ? <Notice tone="success">{status}</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}

        <section className="it-panel rounded-lg p-4">
          <div className="mb-3 flex items-center gap-2">
            <ImageIcon size={18} />
            <h2 className="text-base font-semibold">Conversion output</h2>
          </div>
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Default quick-convert format</span>
              <select
                className="rounded-md border border-ink-100 bg-white px-3 py-2 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-500/20 dark:border-slate-700 dark:bg-slate-950"
                value={converterSettings.defaultFormat}
                onChange={(event) => void updateConverter({ defaultFormat: event.target.value })}
              >
                {OUTPUT_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {formatLabel(format)}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <QualityField
                label="JPG quality"
                value={converterSettings.jpgQuality}
                onChange={(jpgQuality) => void updateConverter({ jpgQuality })}
              />
              <QualityField
                label="WEBP quality"
                value={converterSettings.webpQuality}
                onChange={(webpQuality) => void updateConverter({ webpQuality })}
              />
            </div>

            <label className="grid gap-1 text-sm">
              <span className="font-medium">JPG background for transparent images</span>
              <div className="grid grid-cols-[52px_1fr] gap-2">
                <input
                  className="h-10 w-full rounded-md border border-ink-100 bg-white p-1 dark:border-slate-700 dark:bg-slate-950"
                  type="color"
                  value={converterSettings.jpgBackgroundColor}
                  onChange={(event) =>
                    void updateConverter({ jpgBackgroundColor: event.target.value })
                  }
                />
                <input
                  className="rounded-md border border-ink-100 bg-white px-3 py-2 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-500/20 dark:border-slate-700 dark:bg-slate-950"
                  value={converterSettings.jpgBackgroundColor}
                  onChange={(event) =>
                    setConverterSettings({
                      ...converterSettings,
                      jpgBackgroundColor: event.target.value
                    })
                  }
                  onBlur={(event) =>
                    void updateConverter({
                      jpgBackgroundColor: normalizeHexColor(event.target.value)
                    })
                  }
                />
              </div>
            </label>
          </div>
        </section>

        <section className="it-panel rounded-lg p-4">
          <div className="mb-3 flex items-center gap-2">
            <Download size={18} />
            <h2 className="text-base font-semibold">Download and resize</h2>
          </div>
          <div className="grid gap-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <RadioCard
                title="Show save dialog"
                description="Choose the final file name and location each time."
                checked={converterSettings.downloadMode === DOWNLOAD_MODES.PROMPT}
                onChange={() => void updateConverter({ downloadMode: DOWNLOAD_MODES.PROMPT })}
              />
              <RadioCard
                title="Download automatically"
                description="Save straight into the browser's Downloads folder."
                checked={converterSettings.downloadMode === DOWNLOAD_MODES.AUTO}
                onChange={() => void updateConverter({ downloadMode: DOWNLOAD_MODES.AUTO })}
              />
            </div>

            <ToggleRow
              title="Skip redundant conversion"
              description="Download without re-encoding when the source already matches the selected format."
              checked={converterSettings.skipRedundantConversion}
              onChange={(checked) => void updateConverter({ skipRedundantConversion: checked })}
            />
            <ToggleRow
              title="Preserve original dimensions"
              description="When off, ImageLab scales down to fit the max width or height below."
              checked={converterSettings.preserveDimensions}
              onChange={(checked) => void updateConverter({ preserveDimensions: checked })}
            />

            <div
              className={`grid gap-3 rounded-md border border-ink-100 bg-white p-3 dark:border-slate-700 dark:bg-slate-950 ${
                converterSettings.preserveDimensions ? "opacity-60" : ""
              }`}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <DimensionField
                  label="Max width"
                  value={converterSettings.resizeWidth}
                  disabled={converterSettings.preserveDimensions}
                  onChange={(resizeWidth) => void updateConverter({ resizeWidth })}
                />
                <DimensionField
                  label="Max height"
                  value={converterSettings.resizeHeight}
                  disabled={converterSettings.preserveDimensions}
                  onChange={(resizeHeight) => void updateConverter({ resizeHeight })}
                />
              </div>
            </div>

            <div className="grid gap-3 rounded-md border border-ink-100 bg-white p-3 dark:border-slate-700 dark:bg-slate-950">
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Default compression target</span>
                <div className="grid grid-cols-[1fr_56px] gap-2">
                  <input
                    className="rounded-md border border-ink-100 bg-white px-3 py-2 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-500/20 dark:border-slate-700 dark:bg-slate-950"
                    type="number"
                    min="0.05"
                    max="100"
                    step="0.1"
                    value={bytesToMegabytes(converterSettings.compressionTargetBytes)}
                    onChange={(event) =>
                      void updateConverter({
                        compressionTargetBytes: megabytesToBytes(event.target.value)
                      })
                    }
                  />
                  <span className="grid place-items-center rounded-md border border-ink-100 bg-ink-50 text-sm font-medium dark:border-slate-700 dark:bg-slate-800">
                    MB
                  </span>
                </div>
              </label>
              <QualityField
                label="Minimum compression quality"
                value={converterSettings.compressionMinQuality}
                onChange={(compressionMinQuality) => void updateConverter({ compressionMinQuality })}
              />
              <ToggleRow
                title="Allow compression to shrink dimensions"
                description="When quality alone is not enough, ImageLab may scale the image down to meet the target size."
                checked={converterSettings.compressionAllowResize}
                onChange={(compressionAllowResize) =>
                  void updateConverter({ compressionAllowResize })
                }
              />
            </div>

            <button className="it-button-secondary w-fit" type="button" onClick={() => void resetConverter()}>
              Reset conversion defaults
            </button>
          </div>
        </section>

        <section className="it-panel rounded-lg p-4">
          <div className="mb-3 flex items-center gap-2">
            <Search size={18} />
            <h2 className="text-base font-semibold">Search engines</h2>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {SEARCH_ENGINES.map((engine) => (
              <label
                key={engine.id}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-ink-100 bg-white p-3 dark:border-slate-700 dark:bg-slate-950"
              >
                <input
                  className="mt-1 h-4 w-4 accent-signal-600"
                  type="checkbox"
                  checked={enabledSet.has(engine.id)}
                  onChange={() => void toggleEngine(engine.id)}
                />
                <span>
                  <span className="block text-sm font-semibold">{engine.name}</span>
                  <span className="block text-xs text-ink-500 dark:text-slate-400">
                    {engine.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="it-panel rounded-lg p-4">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck size={18} />
            <h2 className="text-base font-semibold">Privacy and workflow</h2>
          </div>
          <div className="grid gap-3">
            <ToggleRow
              title="Privacy mode"
              description="Shows clear warnings before workflows that send image URLs outside the browser."
              checked={settings.privacyMode}
              onChange={(checked) => void update({ privacyMode: checked })}
            />
            <ToggleRow
              title="Instant open"
              description="After a context-menu capture, immediately open all enabled search engines."
              checked={settings.instantOpen}
              onChange={(checked) => void update({ instantOpen: checked })}
            />
          </div>
        </section>

        <section className="it-panel rounded-lg p-4">
          <div className="mb-3 flex items-center gap-2">
            <Cloud size={18} />
            <h2 className="text-base font-semibold">Cloud mode</h2>
          </div>
          <div className="grid gap-3">
            <ToggleRow
              title="Enable cloud mode"
              description="Unlocks calls to your configured ImageLab FastAPI backend for mock normalized search and analysis."
              checked={settings.cloudMode}
              onChange={(checked) => void update({ cloudMode: checked })}
            />
            <label className="grid gap-1 text-sm">
              <span className="font-medium">API base URL</span>
              <input
                className="rounded-md border border-ink-100 bg-white px-3 py-2 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-500/20 dark:border-slate-700 dark:bg-slate-950"
                value={settings.apiBaseUrl}
                onChange={(event) => setSettings({ ...settings, apiBaseUrl: event.target.value })}
                onBlur={() => void update({ apiBaseUrl: settings.apiBaseUrl })}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="flex items-center gap-2 font-medium">
                <KeyRound size={15} />
                API key
              </span>
              <input
                className="rounded-md border border-ink-100 bg-white px-3 py-2 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-500/20 dark:border-slate-700 dark:bg-slate-950"
                value={settings.apiKey}
                placeholder="dev_imagelab_key"
                type="password"
                onChange={(event) => setSettings({ ...settings, apiKey: event.target.value })}
                onBlur={() => void update({ apiKey: settings.apiKey })}
              />
            </label>
            <button className="it-button-secondary w-fit" type="button" onClick={() => void refreshUsage()}>
              {loadingUsage ? <Loader2 className="animate-spin" size={16} /> : <ToggleLeft size={16} />}
              Refresh usage
            </button>
            {usage ? (
              <div className="rounded-md bg-ink-50 p-3 text-sm dark:bg-slate-800">
                <div className="font-semibold">
                  {usage.plan} plan · {usage.period}
                </div>
                <div className="mt-1 text-ink-500 dark:text-slate-400">
                  Used {usage.used} of {usage.limit ?? "unlimited"} cloud searches. Remaining{" "}
                  {usage.remaining ?? "unlimited"}.
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-md border border-ink-100 bg-white p-3 dark:border-slate-700 dark:bg-slate-950">
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-ink-500 dark:text-slate-400">{description}</span>
      </span>
      <input
        className="h-5 w-5 accent-signal-600"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function QualityField({
  label,
  value,
  onChange
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const normalizedValue = Number(value).toFixed(2);

  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <div className="grid grid-cols-[1fr_72px] gap-2">
        <input
          className="accent-signal-600"
          type="range"
          min="0.1"
          max="1"
          step="0.01"
          value={normalizedValue}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <input
          className="rounded-md border border-ink-100 bg-white px-2 py-2 text-center outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-500/20 dark:border-slate-700 dark:bg-slate-950"
          type="number"
          min="0.1"
          max="1"
          step="0.01"
          value={normalizedValue}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
    </label>
  );
}

function DimensionField({
  label,
  value,
  disabled,
  onChange
}: {
  label: string;
  value: number | null;
  disabled: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        className="rounded-md border border-ink-100 bg-white px-3 py-2 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-500/20 disabled:cursor-not-allowed dark:border-slate-700 dark:bg-slate-950"
        type="number"
        min="1"
        max={MAX_RESIZE_DIMENSION}
        step="1"
        placeholder={`No limit (up to ${MAX_RESIZE_DIMENSION})`}
        disabled={disabled}
        value={value ?? ""}
        onChange={(event) => onChange(normalizeResizeDimension(event.target.value))}
      />
    </label>
  );
}

function RadioCard({
  title,
  description,
  checked,
  onChange
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${
        checked
          ? "border-signal-500 bg-signal-500/10"
          : "border-ink-100 bg-white dark:border-slate-700 dark:bg-slate-950"
      }`}
    >
      <input
        className="mt-1 h-4 w-4 accent-signal-600"
        type="radio"
        checked={checked}
        onChange={onChange}
      />
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-ink-500 dark:text-slate-400">{description}</span>
      </span>
    </label>
  );
}

function bytesToMegabytes(bytes: number): string {
  const value = bytes / (1024 * 1024);
  return Number(value.toFixed(2)).toString();
}

function megabytesToBytes(value: string): number {
  return normalizeCompressionTargetBytes(Number(value) * 1024 * 1024);
}

function Notice({ tone, children }: { tone: "success" | "error"; children: ReactNode }) {
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
