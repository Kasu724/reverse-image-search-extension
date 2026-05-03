// @ts-nocheck
export const FORMATS = Object.freeze({
  PNG: "png",
  JPG: "jpg",
  WEBP: "webp"
});

export const OUTPUT_FORMATS = Object.freeze([
  FORMATS.PNG,
  FORMATS.JPG,
  FORMATS.WEBP
]);

export const INPUT_FORMATS = Object.freeze([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "apng",
  "avif",
  "svg"
]);

export const MIME_BY_FORMAT = Object.freeze({
  [FORMATS.PNG]: "image/png",
  [FORMATS.JPG]: "image/jpeg",
  [FORMATS.WEBP]: "image/webp"
});

export const EXTENSION_BY_FORMAT = Object.freeze({
  [FORMATS.PNG]: "png",
  [FORMATS.JPG]: "jpg",
  [FORMATS.WEBP]: "webp"
});

export const FORMAT_LABELS = Object.freeze({
  [FORMATS.PNG]: "PNG",
  [FORMATS.JPG]: "JPG",
  [FORMATS.WEBP]: "WEBP",
  gif: "GIF",
  apng: "APNG",
  avif: "AVIF",
  svg: "SVG"
});

export const FORMAT_BY_MIME = Object.freeze({
  "image/png": FORMATS.PNG,
  "image/apng": "apng",
  "image/jpeg": FORMATS.JPG,
  "image/jpg": FORMATS.JPG,
  "image/pjpeg": FORMATS.JPG,
  "image/webp": FORMATS.WEBP,
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "text/xml": "svg",
  "application/xml": "svg"
});

export const MIME_BY_EXTENSION = Object.freeze({
  png: "image/png",
  apng: "image/apng",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  pjpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
  svgz: "image/svg+xml"
});

export function normalizeMimeType(mimeType) {
  if (typeof mimeType !== "string") {
    return "";
  }

  return mimeType.split(";")[0].trim().toLowerCase();
}

export function normalizeFormat(format) {
  if (typeof format !== "string") {
    return "";
  }

  const lower = format.trim().toLowerCase().replace(/^\./, "");
  return lower === "jpeg" ? FORMATS.JPG : lower;
}

export function isOutputFormat(format) {
  return OUTPUT_FORMATS.includes(normalizeFormat(format));
}

export function formatFromMimeType(mimeType) {
  return FORMAT_BY_MIME[normalizeMimeType(mimeType)] || "";
}

export function formatFromExtension(extension) {
  const normalized = normalizeFormat(extension);
  const mimeType = MIME_BY_EXTENSION[normalized];
  return mimeType ? formatFromMimeType(mimeType) : "";
}

export function targetMimeForFormat(format) {
  const normalized = normalizeFormat(format);
  return MIME_BY_FORMAT[normalized] || "";
}

export function targetExtensionForFormat(format) {
  const normalized = normalizeFormat(format);
  return EXTENSION_BY_FORMAT[normalized] || "";
}

export function formatMatches(left, right) {
  const normalizedLeft = normalizeFormat(left);
  const normalizedRight = normalizeFormat(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function formatLabel(format) {
  return FORMAT_LABELS[normalizeFormat(format)] || String(format || "").toUpperCase();
}
