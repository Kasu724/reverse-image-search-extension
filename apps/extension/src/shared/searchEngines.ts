import type { SearchEngineConfig, SearchEngineId } from "./types";

export const SEARCH_ENGINES: SearchEngineConfig[] = [
  {
    id: "google",
    name: "Google Images",
    description: "Open Google Lens by URL.",
    sendsTo: "Google",
    badge: "Sends to search engine"
  },
  {
    id: "bing",
    name: "Bing Visual Search",
    description: "Open Bing image search with the image URL.",
    sendsTo: "Microsoft Bing",
    badge: "Sends to search engine"
  },
  {
    id: "tineye",
    name: "TinEye",
    description: "Search TinEye's reverse image index by URL.",
    sendsTo: "TinEye",
    badge: "Sends to search engine"
  },
  {
    id: "yandex",
    name: "Yandex Images",
    description: "Open Yandex reverse image search by URL.",
    sendsTo: "Yandex",
    badge: "Sends to search engine"
  },
  {
    id: "saucenao",
    name: "SauceNAO",
    description: "Search SauceNAO's source-focused reverse image index.",
    sendsTo: "SauceNAO",
    badge: "Sends to search engine"
  }
];

export const SEARCH_ENGINE_IDS = SEARCH_ENGINES.map((engine) => engine.id);

export interface SearchUrlResult {
  ok: boolean;
  url?: string;
  reason?: string;
}

export const LOCAL_ONLY_SEARCH_DISABLED_REASON =
  "Reverse image search is disabled in local-only mode. ImageLab does not send image data or image URLs to external services.";

export function getSearchEngine(id: SearchEngineId): SearchEngineConfig {
  const engine = SEARCH_ENGINES.find((candidate) => candidate.id === id);
  if (!engine) {
    throw new Error(`Unknown search engine: ${id}`);
  }
  return engine;
}

export function isNetworkImageUrl(imageUrl: string): boolean {
  try {
    const parsed = new URL(imageUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function getUnsupportedImageReason(imageUrl: string): string {
  if (imageUrl.startsWith("data:")) {
    return "Embedded image data stays local in this build; reverse image search is disabled.";
  }
  if (imageUrl.startsWith("blob:")) {
    return "Page-local image data stays local in this build; reverse image search is disabled.";
  }
  if (imageUrl.startsWith("file:")) {
    return "Local file URLs stay on this device; reverse image search is disabled.";
  }
  return LOCAL_ONLY_SEARCH_DISABLED_REASON;
}

export function buildSearchUrl(engineId: SearchEngineId, imageUrl: string): SearchUrlResult {
  void engineId;
  void imageUrl;
  return { ok: false, reason: LOCAL_ONLY_SEARCH_DISABLED_REASON };
}

export function buildEnabledSearchUrls(
  engineIds: SearchEngineId[],
  imageUrl: string
): Array<{ engineId: SearchEngineId; result: SearchUrlResult }> {
  return engineIds.map((engineId) => ({
    engineId,
    result: buildSearchUrl(engineId, imageUrl)
  }));
}
