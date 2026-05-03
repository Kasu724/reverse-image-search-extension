import {
  DEFAULT_API_BASE_URL,
  MAX_HISTORY_ITEMS,
  STORAGE_KEYS
} from "./constants";
import type {
  ImageLabSettings,
  NotesByImageId,
  SearchEngineId,
  SearchHistoryItem,
  SelectedImage
} from "./types";

export const DEFAULT_SETTINGS: ImageLabSettings = {
  enabledEngines: ["google", "bing", "tineye", "yandex", "saucenao"],
  privacyMode: true,
  instantOpen: false,
  cloudMode: false,
  apiBaseUrl: DEFAULT_API_BASE_URL,
  apiKey: ""
};

function storageGet<T>(keys: string[] | Record<string, unknown>): Promise<T> {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (items) => resolve(items as T));
  });
}

function storageSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

export async function getSettings(): Promise<ImageLabSettings> {
  const result = await storageGet<Record<string, ImageLabSettings>>({
    [STORAGE_KEYS.settings]: DEFAULT_SETTINGS
  });
  return {
    ...DEFAULT_SETTINGS,
    ...(result[STORAGE_KEYS.settings] ?? {})
  };
}

export async function saveSettings(settings: Partial<ImageLabSettings>): Promise<void> {
  const current = await getSettings();
  await storageSet({
    [STORAGE_KEYS.settings]: {
      ...current,
      ...settings
    }
  });
}

export async function getCurrentImage(): Promise<SelectedImage | null> {
  const result = await storageGet<Record<string, SelectedImage | null>>({
    [STORAGE_KEYS.currentImage]: null
  });
  return result[STORAGE_KEYS.currentImage] ?? null;
}

export async function setCurrentImage(image: SelectedImage | null): Promise<void> {
  await storageSet({ [STORAGE_KEYS.currentImage]: image });
}

export async function getHistory(): Promise<SearchHistoryItem[]> {
  const result = await storageGet<Record<string, SearchHistoryItem[]>>({
    [STORAGE_KEYS.searchHistory]: []
  });
  return result[STORAGE_KEYS.searchHistory] ?? [];
}

export async function getNotes(): Promise<NotesByImageId> {
  const result = await storageGet<Record<string, NotesByImageId>>({
    [STORAGE_KEYS.notes]: {}
  });
  return result[STORAGE_KEYS.notes] ?? {};
}

export async function getFavorites(): Promise<string[]> {
  const result = await storageGet<Record<string, string[]>>({
    [STORAGE_KEYS.favorites]: []
  });
  return result[STORAGE_KEYS.favorites] ?? [];
}

export async function upsertHistoryEntry(
  image: SelectedImage,
  engines: SearchEngineId[] = []
): Promise<SearchHistoryItem[]> {
  const [history, notes, favorites] = await Promise.all([
    getHistory(),
    getNotes(),
    getFavorites()
  ]);
  const now = new Date().toISOString();
  const existing = history.find((item) => item.id === image.id);
  const engineSet = new Set<SearchEngineId>([...(existing?.engines ?? []), ...engines]);
  const updated: SearchHistoryItem = {
    id: image.id,
    image,
    engines: [...engineSet],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    favorite: favorites.includes(image.id),
    note: notes[image.id]
  };
  const next = [updated, ...history.filter((item) => item.id !== image.id)].slice(
    0,
    MAX_HISTORY_ITEMS
  );
  await storageSet({ [STORAGE_KEYS.searchHistory]: next });
  return next;
}

export async function updateCurrentImage(partial: Partial<SelectedImage>): Promise<SelectedImage | null> {
  const current = await getCurrentImage();
  if (!current) {
    return null;
  }
  const updated = {
    ...current,
    ...partial
  };
  await setCurrentImage(updated);
  await upsertHistoryEntry(updated);
  return updated;
}

export async function setNote(imageId: string, note: string): Promise<void> {
  const [notes, history] = await Promise.all([getNotes(), getHistory()]);
  const nextNotes = {
    ...notes,
    [imageId]: note
  };
  const nextHistory = history.map((item) =>
    item.id === imageId
      ? {
          ...item,
          note,
          updatedAt: new Date().toISOString()
        }
      : item
  );
  await storageSet({
    [STORAGE_KEYS.notes]: nextNotes,
    [STORAGE_KEYS.searchHistory]: nextHistory
  });
}

export async function toggleFavorite(imageId: string): Promise<boolean> {
  const [favorites, history] = await Promise.all([getFavorites(), getHistory()]);
  const isFavorite = favorites.includes(imageId);
  const nextFavorites = isFavorite
    ? favorites.filter((favoriteId) => favoriteId !== imageId)
    : [...favorites, imageId];
  const nextHistory = history.map((item) =>
    item.id === imageId
      ? {
          ...item,
          favorite: !isFavorite,
          updatedAt: new Date().toISOString()
        }
      : item
  );
  await storageSet({
    [STORAGE_KEYS.favorites]: nextFavorites,
    [STORAGE_KEYS.searchHistory]: nextHistory
  });
  return !isFavorite;
}

export function subscribeToStorage(
  callback: (changes: Record<string, chrome.storage.StorageChange>) => void
): () => void {
  chrome.storage.onChanged.addListener(callback);
  return () => chrome.storage.onChanged.removeListener(callback);
}
