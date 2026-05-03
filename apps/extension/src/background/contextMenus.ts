import { CONTEXT_MENU_IDS } from "../shared/constants";
import { COMPRESSION_PRESETS } from "../converter/settings";
import { SEARCH_ENGINES } from "../shared/searchEngines";
import type { AutoCropMode, SearchEngineId } from "../shared/types";

export type ImageContextMenuAction =
  | { type: "convert"; format: "png" | "jpg" | "webp" }
  | { type: "convert-default" }
  | { type: "crop-open" }
  | { type: "auto-crop"; mode: AutoCropMode }
  | { type: "compress"; targetBytes: number }
  | { type: "compress-options" }
  | { type: "open-panel" }
  | { type: "search-all" }
  | { type: "search-engine"; engineId: SearchEngineId };

export function registerContextMenus(): Promise<void> {
  return new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: CONTEXT_MENU_IDS.openImageLab,
        title: "Open ImageLab",
        contexts: ["page", "selection", "link", "editable", "video", "audio"]
      });

      chrome.contextMenus.create({
        id: CONTEXT_MENU_IDS.imageParent,
        title: "ImageLab",
        contexts: ["image"]
      });

      chrome.contextMenus.create({
        id: CONTEXT_MENU_IDS.convertParent,
        parentId: CONTEXT_MENU_IDS.imageParent,
        title: "Convert",
        contexts: ["image"]
      });

      chrome.contextMenus.create({
        id: CONTEXT_MENU_IDS.convertDownloadPng,
        parentId: CONTEXT_MENU_IDS.convertParent,
        title: "Download as PNG",
        contexts: ["image"]
      });

      chrome.contextMenus.create({
        id: CONTEXT_MENU_IDS.convertDownloadJpg,
        parentId: CONTEXT_MENU_IDS.convertParent,
        title: "Download as JPG",
        contexts: ["image"]
      });

      chrome.contextMenus.create({
        id: CONTEXT_MENU_IDS.convertDownloadWebp,
        parentId: CONTEXT_MENU_IDS.convertParent,
        title: "Download as WEBP",
        contexts: ["image"]
      });

      chrome.contextMenus.create({
        id: CONTEXT_MENU_IDS.convertQuickDefault,
        parentId: CONTEXT_MENU_IDS.convertParent,
        title: "Quick Convert Using Default Format",
        contexts: ["image"]
      });

      chrome.contextMenus.create({
        id: CONTEXT_MENU_IDS.cropParent,
        parentId: CONTEXT_MENU_IDS.imageParent,
        title: "Crop",
        contexts: ["image"]
      });

      chrome.contextMenus.create({
        id: CONTEXT_MENU_IDS.cropOpenEditor,
        parentId: CONTEXT_MENU_IDS.cropParent,
        title: "Open Crop Editor",
        contexts: ["image"]
      });

      chrome.contextMenus.create({
        id: CONTEXT_MENU_IDS.cropAutoTransparent,
        parentId: CONTEXT_MENU_IDS.cropParent,
        title: "Trim Transparent Border and Download",
        contexts: ["image"]
      });

      chrome.contextMenus.create({
        id: CONTEXT_MENU_IDS.cropAutoSolid,
        parentId: CONTEXT_MENU_IDS.cropParent,
        title: "Trim Solid-Color Border and Download",
        contexts: ["image"]
      });

      chrome.contextMenus.create({
        id: CONTEXT_MENU_IDS.compressParent,
        parentId: CONTEXT_MENU_IDS.imageParent,
        title: "Compress",
        contexts: ["image"]
      });

      for (const preset of COMPRESSION_PRESETS) {
        chrome.contextMenus.create({
          id: `${CONTEXT_MENU_IDS.compressPresetPrefix}${preset.targetBytes}`,
          parentId: CONTEXT_MENU_IDS.compressParent,
          title: `Download under ${preset.label}`,
          contexts: ["image"]
        });
      }

      chrome.contextMenus.create({
        id: CONTEXT_MENU_IDS.compressOpenOptions,
        parentId: CONTEXT_MENU_IDS.compressParent,
        title: "Compression Settings...",
        contexts: ["image"]
      });

      chrome.contextMenus.create({
        id: CONTEXT_MENU_IDS.searchParent,
        parentId: CONTEXT_MENU_IDS.imageParent,
        title: "Search",
        contexts: ["image"]
      });

      chrome.contextMenus.create({
        id: CONTEXT_MENU_IDS.searchOpenPanel,
        parentId: CONTEXT_MENU_IDS.searchParent,
        title: "Open panel",
        contexts: ["image"]
      });

      chrome.contextMenus.create({
        id: CONTEXT_MENU_IDS.searchAll,
        parentId: CONTEXT_MENU_IDS.searchParent,
        title: "Search all enabled engines",
        contexts: ["image"]
      });

      for (const engine of SEARCH_ENGINES) {
        chrome.contextMenus.create({
          id: `${CONTEXT_MENU_IDS.searchEnginePrefix}${engine.id}`,
          parentId: CONTEXT_MENU_IDS.searchParent,
          title: `Search ${engine.name}`,
          contexts: ["image"]
        });
      }

      resolve();
    });
  });
}

export function isOpenImageLabMenuClick(
  info: chrome.contextMenus.OnClickData
): boolean {
  return info.menuItemId === CONTEXT_MENU_IDS.openImageLab;
}

export function getImageContextMenuAction(
  info: chrome.contextMenus.OnClickData
): ImageContextMenuAction | null {
  if (info.menuItemId === CONTEXT_MENU_IDS.convertDownloadPng) {
    return { type: "convert", format: "png" };
  }

  if (info.menuItemId === CONTEXT_MENU_IDS.convertDownloadJpg) {
    return { type: "convert", format: "jpg" };
  }

  if (info.menuItemId === CONTEXT_MENU_IDS.convertDownloadWebp) {
    return { type: "convert", format: "webp" };
  }

  if (info.menuItemId === CONTEXT_MENU_IDS.convertQuickDefault) {
    return { type: "convert-default" };
  }

  if (info.menuItemId === CONTEXT_MENU_IDS.cropOpenEditor) {
    return { type: "crop-open" };
  }

  if (info.menuItemId === CONTEXT_MENU_IDS.cropAutoTransparent) {
    return { type: "auto-crop", mode: "transparent" };
  }

  if (info.menuItemId === CONTEXT_MENU_IDS.cropAutoSolid) {
    return { type: "auto-crop", mode: "solid" };
  }

  if (info.menuItemId === CONTEXT_MENU_IDS.compressOpenOptions) {
    return { type: "compress-options" };
  }

  if (
    typeof info.menuItemId === "string" &&
    info.menuItemId.startsWith(CONTEXT_MENU_IDS.compressPresetPrefix)
  ) {
    const targetBytes = Number(info.menuItemId.slice(CONTEXT_MENU_IDS.compressPresetPrefix.length));
    if (Number.isFinite(targetBytes) && targetBytes > 0) {
      return { type: "compress", targetBytes };
    }
  }

  if (info.menuItemId === CONTEXT_MENU_IDS.searchOpenPanel) {
    return { type: "open-panel" };
  }

  if (info.menuItemId === CONTEXT_MENU_IDS.searchAll) {
    return { type: "search-all" };
  }

  if (
    typeof info.menuItemId === "string" &&
    info.menuItemId.startsWith(CONTEXT_MENU_IDS.searchEnginePrefix)
  ) {
    const engineId = info.menuItemId.slice(
      CONTEXT_MENU_IDS.searchEnginePrefix.length
    ) as SearchEngineId;
    return { type: "search-engine", engineId };
  }

  return null;
}
