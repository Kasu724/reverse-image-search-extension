export type SearchEngineId = "google" | "bing" | "tineye" | "yandex" | "saucenao";

export type OutputImageFormat = "png" | "jpg" | "webp";

export type AutoCropMode = "transparent" | "solid";

export interface PixelCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageCompressionOptions {
  targetBytes: number;
  minQuality?: number;
  allowResize?: boolean;
  maxIterations?: number;
}

export interface ImageProcessOptions {
  targetFormat: OutputImageFormat;
  crop?: PixelCropRect | null;
  autoCrop?: AutoCropMode | null;
  compression?: ImageCompressionOptions | null;
  download?: boolean;
  updateCurrent?: boolean;
}

export interface ImageProcessResult {
  dataUrl: string;
  filename: string;
  mimeType: string;
  byteLength: number;
  width: number | null;
  height: number | null;
  sourceFormat?: string;
  skippedRedundant?: boolean;
  targetBytes?: number;
  targetMet?: boolean;
  compressionApplied?: boolean;
}

export interface DetectedCropResult {
  crop: PixelCropRect;
  width: number;
  height: number;
}

export interface SearchEngineConfig {
  id: SearchEngineId;
  name: string;
  description: string;
  sendsTo: string;
  badge: "Sends to search engine";
}

export interface DominantColor {
  hex: string;
  rgb: [number, number, number];
  percentage: number;
}

export interface OcrResult {
  status: "available" | "unavailable" | "error";
  text: string;
  confidence?: number;
  engine: "mock" | "tesseract";
  message?: string;
}

export interface LocalImageAnalysis {
  width?: number;
  height?: number;
  dominantColors: DominantColor[];
  ocr?: OcrResult;
  analyzedAt: string;
  error?: string;
}

export interface SelectedImage {
  id: string;
  srcUrl: string;
  remoteImageUrl?: string;
  remoteImageUploadedAt?: string;
  pageUrl?: string;
  altText?: string;
  title?: string;
  width?: number;
  height?: number;
  capturedAt: string;
  analysis?: LocalImageAnalysis;
}

export interface SearchHistoryItem {
  id: string;
  image: SelectedImage;
  engines: SearchEngineId[];
  createdAt: string;
  updatedAt: string;
  favorite: boolean;
  note?: string;
}

export interface ImageLabSettings {
  enabledEngines: SearchEngineId[];
  privacyMode: boolean;
  instantOpen: boolean;
  cloudMode: boolean;
  apiBaseUrl: string;
  apiKey: string;
}

export type NotesByImageId = Record<string, string>;

export interface CloudSearchRequest {
  image_url: string;
  page_url?: string;
  enabled_engines: SearchEngineId[];
}

export interface CloudSearchResult {
  engine: string;
  title: string;
  url: string;
  thumbnail_url?: string;
  snippet: string;
  confidence: number;
}

export interface CloudSearchResponse {
  results: CloudSearchResult[];
  usage: CloudUsage;
}

export interface CloudAnalysisResponse {
  description: string;
  likely_objects: string[];
  likely_source_hints: string[];
  suggested_queries: string[];
}

export interface CloudImageUploadRequest {
  image_data_url: string;
  filename?: string;
}

export interface CloudImageUploadResponse {
  upload_id: string;
  image_url: string;
  content_type: string;
  size_bytes: number;
}

export interface CloudUsage {
  plan: "free" | "pro" | "creator" | "team";
  used: number;
  limit: number | null;
  remaining: number | null;
  period: string;
}

export type RuntimeRequest =
  | { type: "OPEN_SEARCH_ENGINE"; engineId: SearchEngineId }
  | { type: "OPEN_ENABLED_ENGINES" }
  | { type: "ANALYZE_CURRENT_IMAGE" }
  | { type: "PROCESS_CURRENT_IMAGE"; options: ImageProcessOptions }
  | { type: "DETECT_CURRENT_IMAGE_CROP"; mode: AutoCropMode; tolerance?: number }
  | { type: "GET_CURRENT_IMAGE" };

export interface RuntimeResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface ContentImageContext {
  altText?: string;
  title?: string;
  width?: number;
  height?: number;
  naturalWidth?: number;
  naturalHeight?: number;
}
