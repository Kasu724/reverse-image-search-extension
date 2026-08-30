import type { ContentImageContext, SelectedImage } from "./types";

export function createImageId(srcUrl: string): string {
  const bytes = new TextEncoder().encode(`${srcUrl}:${Date.now()}:${Math.random()}`);
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return `img_${Date.now()}_${(hash >>> 0).toString(36)}`;
}

export function createSelectedImage(
  srcUrl: string,
  pageUrl?: string,
  context?: ContentImageContext | null
): SelectedImage {
  return {
    id: createImageId(srcUrl),
    srcUrl,
    pageUrl,
    altText: context?.altText,
    title: context?.title,
    width: context?.naturalWidth ?? context?.width,
    height: context?.naturalHeight ?? context?.height,
    capturedAt: new Date().toISOString()
  };
}

export function formatDimensions(width?: number, height?: number): string {
  if (!width || !height) {
    return "Unknown dimensions";
  }
  return `${width} x ${height}`;
}
