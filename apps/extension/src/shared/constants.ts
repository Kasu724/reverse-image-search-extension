export const EXTENSION_NAME = "ImageLab";

export const STORAGE_KEYS = {
  settings: "imagelab.search.settings",
  currentImage: "imagelab.search.currentImage",
  searchHistory: "imagelab.search.searchHistory",
  notes: "imagelab.search.notes",
  favorites: "imagelab.search.favorites"
} as const;

export const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";

export const CONTEXT_MENU_ID = "imagelab-image";
export const CONTEXT_MENU_IDS = {
  openImageLab: "imagelab-open",
  imageParent: CONTEXT_MENU_ID,
  convertParent: "imagelab-convert",
  convertDownloadPng: "imagelab-convert-download-png",
  convertDownloadJpg: "imagelab-convert-download-jpg",
  convertDownloadWebp: "imagelab-convert-download-webp",
  convertQuickDefault: "imagelab-convert-quick-default",
  cropParent: "imagelab-crop",
  cropOpenEditor: "imagelab-crop-open-editor",
  cropAutoTransparent: "imagelab-crop-auto-transparent",
  cropAutoSolid: "imagelab-crop-auto-solid",
  compressParent: "imagelab-compress",
  compressPresetPrefix: "imagelab-compress-preset:",
  compressOpenOptions: "imagelab-compress-open-options",
  searchParent: "imagelab-search",
  searchOpenPanel: "imagelab-search-open-panel",
  searchAll: "imagelab-search-all",
  searchEnginePrefix: "imagelab-search-engine:"
} as const;

export const OFFSCREEN_DOCUMENT_PATH = "src/offscreen/offscreen.html";

export const ERROR_PAGE_PATH = "conversion-error.html";

export const CONVERT_IMAGE_MESSAGE_TYPE = "imagelab:convert-image";

export const DETECT_CROP_MESSAGE_TYPE = "imagelab:detect-crop";

export const MAX_HISTORY_ITEMS = 60;
