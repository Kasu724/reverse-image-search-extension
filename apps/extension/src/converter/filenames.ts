// @ts-nocheck
import {
  formatFromExtension,
  targetExtensionForFormat
} from "./constants";

const ILLEGAL_FILENAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001F]/g;
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const MAX_FILENAME_LENGTH = 180;

export function sanitizeFilename(value, fallback = "image") {
  const fallbackName = fallback === "" ? "" : String(fallback || "image");
  let filename = typeof value === "string" ? value : "";

  filename = filename
    .normalize("NFKC")
    .replace(ILLEGAL_FILENAME_CHARACTERS, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");

  if (!filename || RESERVED_WINDOWS_NAMES.test(filename)) {
    filename = fallbackName;
  }

  if (!filename) {
    return "";
  }

  if (filename.length > MAX_FILENAME_LENGTH) {
    const extension = getFileExtension(filename);
    const extensionSuffix = extension ? `.${extension}` : "";
    const keepLength = MAX_FILENAME_LENGTH - extensionSuffix.length;
    filename = `${filename.slice(0, Math.max(1, keepLength))}${extensionSuffix}`;
  }

  return filename;
}

export function getFileExtension(filename) {
  if (typeof filename !== "string") {
    return "";
  }

  const cleanName = filename.split(/[?#]/)[0];
  const lastSegment = cleanName.split(/[\\/]/).pop() || "";
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === lastSegment.length - 1) {
    return "";
  }

  return lastSegment.slice(dotIndex + 1).toLowerCase();
}

export function replaceExtension(filename, targetExtension) {
  const cleanExtension = String(targetExtension || "").trim().replace(/^\./, "").toLowerCase();
  if (!cleanExtension) {
    return sanitizeFilename(filename);
  }

  const sanitized = sanitizeFilename(filename);
  const dotIndex = sanitized.lastIndexOf(".");
  const stem = dotIndex > 0 ? sanitized.slice(0, dotIndex) : sanitized;
  return sanitizeFilename(`${stem || "image"}.${cleanExtension}`);
}

export function extractFilenameFromUrl(sourceUrl) {
  if (typeof sourceUrl !== "string" || !sourceUrl.trim()) {
    return "";
  }

  if (/^(data|blob):/i.test(sourceUrl)) {
    return "";
  }

  try {
    const url = new URL(sourceUrl);
    const segment = url.pathname.split("/").filter(Boolean).pop() || "";
    return sanitizeFilename(decodeURIComponent(segment), "");
  } catch {
    const withoutQuery = sourceUrl.split(/[?#]/)[0];
    const segment = withoutQuery.split(/[\\/]/).filter(Boolean).pop() || "";
    try {
      return sanitizeFilename(decodeURIComponent(segment), "");
    } catch {
      return sanitizeFilename(segment, "");
    }
  }
}

export function parseContentDispositionFilename(header) {
  if (typeof header !== "string" || !header.trim()) {
    return "";
  }

  const filenameStarMatch = header.match(/filename\*\s*=\s*([^;]+)/i);
  if (filenameStarMatch) {
    const rawValue = stripQuotes(filenameStarMatch[1].trim());
    const encodedPart = rawValue.includes("''") ? rawValue.split("''").slice(1).join("''") : rawValue;
    try {
      return sanitizeFilename(decodeURIComponent(encodedPart), "");
    } catch {
      return sanitizeFilename(encodedPart, "");
    }
  }

  const filenameMatch = header.match(/filename\s*=\s*("[^"]+"|[^;]+)/i);
  if (!filenameMatch) {
    return "";
  }

  return sanitizeFilename(stripQuotes(filenameMatch[1].trim()), "");
}

export function deriveDownloadFilename({
  sourceUrl = "",
  contentDisposition = "",
  targetFormat = "",
  targetExtension = "",
  now = new Date()
} = {}) {
  const extension = targetExtension || targetExtensionForFormat(targetFormat) || "png";
  const fromHeader = parseContentDispositionFilename(contentDisposition);
  const fromUrl = extractFilenameFromUrl(sourceUrl);
  const fallback = `${hostnameFromUrl(sourceUrl) || "image"}-${formatTimestamp(now)}`;
  return fromHeader || fromUrl
    ? replaceExtension(fromHeader || fromUrl, extension)
    : sanitizeFilename(`${fallback}.${extension}`);
}

export function hostnameFromUrl(sourceUrl) {
  if (typeof sourceUrl !== "string" || !sourceUrl.trim()) {
    return "image";
  }

  try {
    if (sourceUrl.startsWith("blob:")) {
      const innerUrl = sourceUrl.slice("blob:".length);
      return sanitizeFilename(new URL(innerUrl).hostname || "image", "image");
    }

    const url = new URL(sourceUrl);
    if (url.protocol === "data:") {
      return "image";
    }

    return sanitizeFilename(url.hostname || "image", "image");
  } catch {
    return "image";
  }
}

export function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate())
  ].join("") + `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

export function sourceFormatFromUrl(sourceUrl) {
  return formatFromExtension(getFileExtension(extractFilenameFromUrl(sourceUrl)));
}

function stripQuotes(value) {
  return value.replace(/^"(.*)"$/, "$1").replace(/\\"/g, "\"");
}
