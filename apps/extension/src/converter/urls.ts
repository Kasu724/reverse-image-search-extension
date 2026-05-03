// @ts-nocheck
export function isDataUrl(value) {
  return typeof value === "string" && /^data:/i.test(value);
}

export function isBlobUrl(value) {
  return typeof value === "string" && /^blob:/i.test(value);
}

export function isHttpUrl(value) {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function truncateForDisplay(value, maxLength = 220) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}
