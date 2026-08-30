import { MAX_HISTORY_ITEMS, MAX_HISTORY_STORAGE_BYTES, STORAGE_KEYS } from "./constants";
import type {
  ImageLabSettings,
  NotesByImageId,
  SearchEngineId,
  SearchHistoryItem,
  SelectedImage
} from "./types";

export const DEFAULT_SETTINGS: ImageLabSettings = {
  enabledEngines: [],
  privacyMode: true,
  instantOpen: false
};

function storageGet<T>(keys: string[] | Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(items as T);
    });
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

let mutationQueue: Promise<void> = Promise.resolve();

function serializeMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(mutation, mutation);
  mutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function trimHistory(history: SearchHistoryItem[]): SearchHistoryItem[] {
  const next = history.slice(0, MAX_HISTORY_ITEMS);
  while (next.length > 1 && JSON.stringify(next).length > MAX_HISTORY_STORAGE_BYTES) {
    next.pop();
  }
  return next;
}

function mergeDefined<T extends object>(base: T, incoming: Partial<T>): T {
  const definedIncoming = Object.fromEntries(
    Object.entries(incoming).filter(([, value]) => value !== undefined)
  );
  return Object.fromEntries(
    Object.entries({ ...base, ...definedIncoming })
  ) as T;
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
  return serializeMutation(async () => {
    const current = await getSettings();
    await storageSet({
      [STORAGE_KEYS.settings]: { ...current, ...settings }
    });
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
  return serializeMutation(async () => {
    const [history, notes, favorites] = await Promise.all([getHistory(), getNotes(), getFavorites()]);
    const now = new Date().toISOString();
    const existing = history.find((item) => item.id === image.id);
    const engineSet = new Set<SearchEngineId>([...(existing?.engines ?? []), ...engines]);
    const mergedImage = mergeDefined(existing?.image ?? image, image);
    const updated: SearchHistoryItem = { id: image.id, image: mergedImage, engines: [...engineSet], createdAt: existing?.createdAt ?? now, updatedAt: now, favorite: favorites.includes(image.id), note: notes[image.id] };
    const next = trimHistory([updated, ...history.filter((item) => item.id !== image.id)]);
    await storageSet({ [STORAGE_KEYS.searchHistory]: next });
    return next;
  });
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
  return serializeMutation(async () => {
    const [notes, history] = await Promise.all([getNotes(), getHistory()]);
    const nextNotes = { ...notes, [imageId]: note };
    const nextHistory = history.map((item) => item.id === imageId ? { ...item, note, updatedAt: new Date().toISOString() } : item);
    await storageSet({ [STORAGE_KEYS.notes]: nextNotes, [STORAGE_KEYS.searchHistory]: trimHistory(nextHistory) });
  });
}

export async function toggleFavorite(imageId: string): Promise<boolean> {
  return serializeMutation(async () => {
    const [favorites, history] = await Promise.all([getFavorites(), getHistory()]);
    const isFavorite = favorites.includes(imageId);
    const nextFavorites = isFavorite ? favorites.filter((favoriteId) => favoriteId !== imageId) : [...favorites, imageId];
    const nextHistory = history.map((item) => item.id === imageId ? { ...item, favorite: !isFavorite, updatedAt: new Date().toISOString() } : item);
    await storageSet({ [STORAGE_KEYS.favorites]: nextFavorites, [STORAGE_KEYS.searchHistory]: trimHistory(nextHistory) });
    return !isFavorite;
  });
}

export function subscribeToStorage(
  callback: (changes: Record<string, chrome.storage.StorageChange>) => void
): () => void {
  chrome.storage.onChanged.addListener(callback);
  return () => chrome.storage.onChanged.removeListener(callback);
}
