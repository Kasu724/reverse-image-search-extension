import { CONTEXT_MENU_IDS } from "../shared/constants";
import { COMPRESSION_PRESETS } from "../converter/settings";
import type { AutoCropMode } from "../shared/types";

export type ImageContextMenuAction =
  | { type: "convert"; format: "png" | "jpg" | "webp" }
  | { type: "convert-default" }
  | { type: "copy" }
  | { type: "crop-open" }
  | { type: "auto-crop"; mode: AutoCropMode }
  | { type: "compress"; targetBytes: number }
  | { type: "compress-options" };

const IMAGE_TOOL_CONTEXTS: NonNullable<chrome.contextMenus.CreateProperties["contexts"]> = [
  "image",
  "page",
  "link"
];

let contextMenuRegistration: Promise<void> | null = null;

export function registerContextMenus(): Promise<void> {
  if (contextMenuRegistration) {
    return contextMenuRegistration;
  }

  const registration = new Promise<void>((resolve, reject) => {
    chrome.contextMenus.removeAll(() => {
      const removeError = chrome.runtime.lastError;
      if (removeError) {
        reject(new Error(removeError.message));
        return;
      }

      const menuItems: chrome.contextMenus.CreateProperties[] = [
        {
        id: CONTEXT_MENU_IDS.openImageLab,
        title: "Open ImageLab",
        contexts: ["page", "selection", "link", "editable", "video", "audio", "image"]
        },
        {
        id: CONTEXT_MENU_IDS.imageParent,
        title: "ImageLab",
        contexts: IMAGE_TOOL_CONTEXTS
        },
        {
        id: CONTEXT_MENU_IDS.convertParent,
        parentId: CONTEXT_MENU_IDS.imageParent,
        title: "Convert",
        contexts: IMAGE_TOOL_CONTEXTS
        },
        {
        id: CONTEXT_MENU_IDS.convertDownloadPng,
        parentId: CONTEXT_MENU_IDS.convertParent,
        title: "Download as PNG",
        contexts: IMAGE_TOOL_CONTEXTS
        },
        {
        id: CONTEXT_MENU_IDS.convertDownloadJpg,
        parentId: CONTEXT_MENU_IDS.convertParent,
        title: "Download as JPG",
        contexts: IMAGE_TOOL_CONTEXTS
        },
        {
        id: CONTEXT_MENU_IDS.convertDownloadWebp,
        parentId: CONTEXT_MENU_IDS.convertParent,
        title: "Download as WEBP",
        contexts: IMAGE_TOOL_CONTEXTS
        },
        {
        id: CONTEXT_MENU_IDS.convertQuickDefault,
        parentId: CONTEXT_MENU_IDS.convertParent,
        title: "Quick Convert Using Default Format",
        contexts: IMAGE_TOOL_CONTEXTS
        },
        {
        id: CONTEXT_MENU_IDS.copyImage,
        parentId: CONTEXT_MENU_IDS.imageParent,
        title: "Copy Image",
        contexts: IMAGE_TOOL_CONTEXTS
        },
        {
        id: CONTEXT_MENU_IDS.cropParent,
        parentId: CONTEXT_MENU_IDS.imageParent,
        title: "Crop",
        contexts: IMAGE_TOOL_CONTEXTS
        },
        {
        id: CONTEXT_MENU_IDS.cropOpenEditor,
        parentId: CONTEXT_MENU_IDS.cropParent,
        title: "Open Crop Editor",
        contexts: IMAGE_TOOL_CONTEXTS
        },
        {
        id: CONTEXT_MENU_IDS.cropAutoTransparent,
        parentId: CONTEXT_MENU_IDS.cropParent,
        title: "Trim Transparent Border and Download",
        contexts: IMAGE_TOOL_CONTEXTS
        },
        {
        id: CONTEXT_MENU_IDS.cropAutoSolid,
        parentId: CONTEXT_MENU_IDS.cropParent,
        title: "Trim Solid-Color Border and Download",
        contexts: IMAGE_TOOL_CONTEXTS
        },
        {
        id: CONTEXT_MENU_IDS.compressParent,
        parentId: CONTEXT_MENU_IDS.imageParent,
        title: "Compress",
        contexts: IMAGE_TOOL_CONTEXTS
        }
      ];

      for (const preset of COMPRESSION_PRESETS) {
        menuItems.push({
          id: `${CONTEXT_MENU_IDS.compressPresetPrefix}${preset.targetBytes}`,
          parentId: CONTEXT_MENU_IDS.compressParent,
          title: `Download under ${preset.label}`,
          contexts: IMAGE_TOOL_CONTEXTS
        });
      }

      menuItems.push({
        id: CONTEXT_MENU_IDS.compressOpenOptions,
        parentId: CONTEXT_MENU_IDS.compressParent,
        title: "Compression Settings...",
        contexts: IMAGE_TOOL_CONTEXTS
      });

      void (async () => {
        for (const properties of menuItems) {
          await createContextMenu(properties);
        }
      })().then(resolve, reject);
    });
  });

  let scheduledRegistration: Promise<void>;
  scheduledRegistration = registration.finally(() => {
    if (contextMenuRegistration === scheduledRegistration) {
      contextMenuRegistration = null;
    }
  });
  contextMenuRegistration = scheduledRegistration;
  return scheduledRegistration;
}

function createContextMenu(properties: chrome.contextMenus.CreateProperties): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      chrome.contextMenus.create(properties, () => {
        const createError = chrome.runtime.lastError;
        if (createError) {
          reject(new Error(createError.message));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
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

  if (info.menuItemId === CONTEXT_MENU_IDS.copyImage) {
    return { type: "copy" };
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

  return null;
}
