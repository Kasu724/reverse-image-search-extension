import type { ContentDetectedImage, ContentImageContext } from "../shared/types";

interface GetImageContextRequest {
  type: "GET_IMAGE_CONTEXT";
  srcUrl: string;
}

interface GetContextImageRequest {
  type: "GET_CONTEXT_IMAGE";
  srcUrl?: string;
}

type ContentScriptRequest = GetImageContextRequest | GetContextImageRequest;

const LAST_CONTEXT_IMAGE_MAX_AGE_MS = 60_000;
const CONTEXT_IMAGE_DETECTED_MESSAGE_TYPE = "imagelab:context-image-detected";
const LAST_CONTEXT_POINT_KEY = "__imagelabLastContextPoint";
const ELEMENT_STACK_PROBE_LIMIT = 12;
const MIN_DOCUMENT_FALLBACK_EDGE = 24;
const IMAGE_SELECTOR = "img, picture, canvas, svg image";
const IMAGE_URL_ATTRIBUTES = [
  "src",
  "poster",
  "data-src",
  "data-original",
  "data-lazy-src",
  "data-image",
  "data-image-url",
  "data-full-src"
] as const;

let lastContextImage: ContentDetectedImage | null = null;
let lastContextImageAt = 0;
let lastContextPoint: { clientX: number; clientY: number } | null = null;

document.addEventListener(
  "contextmenu",
  (event) => {
    lastContextPoint = {
      clientX: event.clientX,
      clientY: event.clientY
    };
    setLastContextPoint(lastContextPoint);
    lastContextImage = detectImageAtPoint(event.clientX, event.clientY, event);
    lastContextImageAt = Date.now();
    if (lastContextImage) {
      notifyDetectedContextImage(lastContextImage);
    }
  },
  { capture: true }
);

chrome.runtime.onMessage.addListener(
  (request: unknown, _sender, sendResponse) => {
    if (!isContentScriptRequest(request)) {
      return false;
    }

    if (request.type === "GET_IMAGE_CONTEXT") {
      const image = findImageBySource(request.srcUrl);
      const cached =
        lastContextImage?.srcUrl &&
        normalizeUrl(lastContextImage.srcUrl) === normalizeUrl(request.srcUrl)
          ? lastContextImage
          : null;
      const context = image
        ? buildContext(image)
        : cached?.context ?? {};

      sendResponse(context satisfies ContentImageContext);
      return true;
    }

    if (request.type === "GET_CONTEXT_IMAGE") {
      const image = request.srcUrl ? findImageBySource(request.srcUrl) : null;
      if (image) {
        sendResponse({
          srcUrl: getImageElementSource(image),
          context: buildContext(image)
        } satisfies ContentDetectedImage);
        return true;
      }

      sendResponse(getRecentContextImage());
      return true;
    }

    return false;
  }
);

function isContentScriptRequest(value: unknown): value is ContentScriptRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const request = value as { type?: unknown; srcUrl?: unknown };
  if (request.type === "GET_CONTEXT_IMAGE") {
    return request.srcUrl === undefined || typeof request.srcUrl === "string";
  }

  return request.type === "GET_IMAGE_CONTEXT" && typeof request.srcUrl === "string";
}

function getRecentContextImage(): ContentDetectedImage | null {
  if (Date.now() - lastContextImageAt > LAST_CONTEXT_IMAGE_MAX_AGE_MS) {
    return null;
  }

  if (!lastContextImage && lastContextPoint) {
    lastContextImage = detectImageAtPoint(lastContextPoint.clientX, lastContextPoint.clientY);
    if (lastContextImage) {
      notifyDetectedContextImage(lastContextImage);
    }
  }

  return lastContextImage;
}

function detectImageAtPoint(
  clientX: number,
  clientY: number,
  event?: MouseEvent
): ContentDetectedImage | null {
  const candidates = collectCandidateElements(clientX, clientY, event);

  for (const element of candidates) {
    const detected = detectImageFromElement(element, clientX, clientY, false);
    if (detected) {
      return detected;
    }
  }

  for (const element of candidates) {
    const detected = detectImageFromElement(element, clientX, clientY, true);
    if (detected) {
      return detected;
    }
  }

  const documentImage = findDocumentImageAtPoint(clientX, clientY);
  if (documentImage) {
    return documentImage;
  }

  return null;
}

function collectCandidateElements(
  clientX: number,
  clientY: number,
  event?: MouseEvent
): Element[] {
  const elements: Element[] = [];
  const seen = new Set<Element>();
  const addElement = (element: Element | null) => {
    if (!element || seen.has(element)) {
      return;
    }
    seen.add(element);
    elements.push(element);
  };
  const addWithAncestors = (element: Element | null) => {
    let current: Element | null = element;
    let depth = 0;
    while (current && depth < 8) {
      addElement(current);
      current = current.parentElement;
      depth += 1;
    }
  };

  if (event) {
    for (const pathEntry of event.composedPath()) {
      if (pathEntry instanceof Element) {
        addWithAncestors(pathEntry);
      }
    }
  }

  for (const element of document.elementsFromPoint(clientX, clientY)) {
    addWithAncestors(element);
  }

  collectElementsBelowPoint(clientX, clientY, addWithAncestors);

  return elements;
}

function collectElementsBelowPoint(
  clientX: number,
  clientY: number,
  addWithAncestors: (element: Element | null) => void
): void {
  const changed: Array<{ element: HTMLElement | SVGElement; pointerEvents: string }> = [];
  const probed = new Set<Element>();

  try {
    for (let index = 0; index < ELEMENT_STACK_PROBE_LIMIT; index += 1) {
      const element = document.elementFromPoint(clientX, clientY);
      if (!element || probed.has(element)) {
        break;
      }

      probed.add(element);
      addWithAncestors(element);

      if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) {
        break;
      }

      changed.push({
        element,
        pointerEvents: element.style.pointerEvents
      });
      element.style.pointerEvents = "none";
    }
  } finally {
    for (const item of changed.reverse()) {
      item.element.style.pointerEvents = item.pointerEvents;
    }
  }
}

function detectImageFromElement(
  element: Element,
  clientX: number,
  clientY: number,
  includeDescendants: boolean
): ContentDetectedImage | null {
  const direct = detectDirectImageElement(element, clientX, clientY);
  if (direct) {
    return direct;
  }

  const background = detectBackgroundImage(element, clientX, clientY);
  if (background) {
    return background;
  }

  if (!includeDescendants) {
    return null;
  }

  const descendant = findDescendantImageAtPoint(element, clientX, clientY);
  if (descendant) {
    return descendant;
  }

  return null;
}

function detectDirectImageElement(
  element: Element,
  clientX: number,
  clientY: number
): ContentDetectedImage | null {
  if (!rectContainsPoint(element.getBoundingClientRect(), clientX, clientY, 2)) {
    return null;
  }

  if (element instanceof HTMLImageElement) {
    return detectedFromUrl(getImageElementSource(element), buildContext(element));
  }

  if (element instanceof HTMLPictureElement) {
    const image = element.querySelector("img");
    return image ? detectedFromUrl(getImageElementSource(image), buildContext(image)) : null;
  }

  if (element instanceof HTMLCanvasElement) {
    return detectCanvasImage(element);
  }

  if (isSvgImageElement(element)) {
    const href =
      element.href.baseVal ||
      element.getAttribute("href") ||
      element.getAttribute("xlink:href") ||
      "";
    return detectedFromUrl(href, buildContext(element));
  }

  const attributeUrl = getImageUrlFromAttributes(element);
  if (attributeUrl) {
    return detectedFromUrl(attributeUrl, buildContext(element));
  }

  return null;
}

function detectBackgroundImage(
  element: Element,
  clientX: number,
  clientY: number
): ContentDetectedImage | null {
  if (!rectContainsPoint(element.getBoundingClientRect(), clientX, clientY, 2)) {
    return null;
  }

  const style = window.getComputedStyle(element);
  if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") {
    return null;
  }

  const backgroundUrl = firstUrlFromCssImage(style.backgroundImage);
  if (!backgroundUrl) {
    return null;
  }

  return detectedFromUrl(backgroundUrl, buildContext(element));
}

function findDescendantImageAtPoint(
  element: Element,
  clientX: number,
  clientY: number
): ContentDetectedImage | null {
  const descendants = Array.from(element.querySelectorAll(IMAGE_SELECTOR))
    .filter((descendant) =>
      rectContainsPoint(descendant.getBoundingClientRect(), clientX, clientY, 4)
    )
    .sort((left, right) => rectArea(right.getBoundingClientRect()) - rectArea(left.getBoundingClientRect()));

  for (const descendant of descendants) {
    const detected = detectDirectImageElement(descendant, clientX, clientY);
    if (detected) {
      return detected;
    }
  }

  return null;
}

function findDocumentImageAtPoint(
  clientX: number,
  clientY: number
): ContentDetectedImage | null {
  const mediaCandidates = Array.from(document.querySelectorAll(IMAGE_SELECTOR))
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return (
        rectContainsPoint(rect, clientX, clientY, 4) &&
        rect.width >= MIN_DOCUMENT_FALLBACK_EDGE &&
        rect.height >= MIN_DOCUMENT_FALLBACK_EDGE
      );
    })
    .sort((left, right) => rectArea(left.getBoundingClientRect()) - rectArea(right.getBoundingClientRect()));

  for (const element of mediaCandidates) {
    const detected = detectDirectImageElement(element, clientX, clientY);
    if (detected) {
      return detected;
    }
  }

  const backgroundCandidates = Array.from(document.body?.querySelectorAll("*") ?? [])
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return (
        rectContainsPoint(rect, clientX, clientY, 2) &&
        rect.width >= MIN_DOCUMENT_FALLBACK_EDGE &&
        rect.height >= MIN_DOCUMENT_FALLBACK_EDGE
      );
    })
    .sort((left, right) => rectArea(left.getBoundingClientRect()) - rectArea(right.getBoundingClientRect()));

  for (const element of backgroundCandidates) {
    const detected = detectBackgroundImage(element, clientX, clientY);
    if (detected) {
      return detected;
    }
  }

  return null;
}

function findImageBySource(srcUrl: string): HTMLImageElement | null {
  const normalizedTarget = normalizeUrl(srcUrl);
  const images = Array.from(document.images);

  return (
    images.find((image) => normalizeUrl(image.currentSrc) === normalizedTarget) ??
    images.find((image) => normalizeUrl(image.src) === normalizedTarget) ??
    images.find((image) => image.currentSrc === srcUrl || image.src === srcUrl) ??
    null
  );
}

function detectCanvasImage(canvas: HTMLCanvasElement): ContentDetectedImage | null {
  try {
    return {
      srcUrl: canvas.toDataURL("image/png"),
      context: buildContext(canvas)
    };
  } catch {
    return null;
  }
}

function detectedFromUrl(
  srcUrl: string | null | undefined,
  context: ContentImageContext
): ContentDetectedImage | null {
  const normalized = normalizeUrl(srcUrl || "");
  if (!isUsableImageUrl(normalized)) {
    return null;
  }

  return {
    srcUrl: normalized,
    context
  };
}

function getImageElementSource(image: HTMLImageElement): string {
  return (
    image.currentSrc ||
    image.src ||
    bestSrcFromSrcset(image.getAttribute("srcset") || "") ||
    getImageUrlFromAttributes(image) ||
    ""
  );
}

function getImageUrlFromAttributes(element: Element): string | null {
  for (const attribute of IMAGE_URL_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (value && isUsableImageUrl(normalizeUrl(value))) {
      return value;
    }
  }

  const srcset = element.getAttribute("srcset") || element.getAttribute("data-srcset");
  return bestSrcFromSrcset(srcset || "");
}

function bestSrcFromSrcset(srcset: string): string | null {
  const candidates = srcset
    .split(",")
    .map((candidate) => {
      const [url, descriptor] = candidate.trim().split(/\s+/, 2);
      const score = descriptor?.endsWith("x")
        ? Number(descriptor.slice(0, -1))
        : descriptor?.endsWith("w")
          ? Number(descriptor.slice(0, -1))
          : 1;

      return {
        url,
        score: Number.isFinite(score) ? score : 1
      };
    })
    .filter((candidate) => candidate.url && isUsableImageUrl(normalizeUrl(candidate.url)));

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.url ?? null;
}

function firstUrlFromCssImage(value: string): string | null {
  const urlPattern = /url\((?:"([^"]+)"|'([^']+)'|([^)"']+))\)/gi;
  let match: RegExpExecArray | null;

  while ((match = urlPattern.exec(value))) {
    const url = match[1] || match[2] || match[3] || "";
    if (isUsableImageUrl(normalizeUrl(url.trim()))) {
      return url.trim();
    }
  }

  return null;
}

function buildContext(element: Element): ContentImageContext {
  const rect = element.getBoundingClientRect();
  const title = getElementTitle(element);
  const altText =
    element instanceof HTMLImageElement
      ? element.alt || undefined
      : element.getAttribute("aria-label") || undefined;

  if (element instanceof HTMLImageElement) {
    return {
      altText,
      title,
      width: imageDimension(imageRenderedWidth(element), rect.width),
      height: imageDimension(imageRenderedHeight(element), rect.height),
      naturalWidth: imageDimension(element.naturalWidth, rect.width),
      naturalHeight: imageDimension(element.naturalHeight, rect.height)
    };
  }

  if (element instanceof HTMLCanvasElement) {
    return {
      altText,
      title,
      width: imageDimension(element.width, rect.width),
      height: imageDimension(element.height, rect.height),
      naturalWidth: imageDimension(element.width, rect.width),
      naturalHeight: imageDimension(element.height, rect.height)
    };
  }

  return {
    altText,
    title,
    width: imageDimension(undefined, rect.width),
    height: imageDimension(undefined, rect.height),
    naturalWidth: imageDimension(undefined, rect.width),
    naturalHeight: imageDimension(undefined, rect.height)
  };
}

function getElementTitle(element: Element): string | undefined {
  return (
    element.getAttribute("title") ||
    element.getAttribute("aria-label") ||
    element.getAttribute("alt") ||
    undefined
  );
}

function imageRenderedWidth(image: HTMLImageElement): number {
  return image.width || image.getBoundingClientRect().width;
}

function imageRenderedHeight(image: HTMLImageElement): number {
  return image.height || image.getBoundingClientRect().height;
}

function imageDimension(primary: number | undefined, fallback: number): number | undefined {
  const value = primary && primary > 0 ? primary : fallback;
  return value > 0 ? Math.round(value) : undefined;
}

function rectContainsPoint(
  rect: DOMRect,
  clientX: number,
  clientY: number,
  tolerance = 0
): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    clientX >= rect.left - tolerance &&
    clientX <= rect.right + tolerance &&
    clientY >= rect.top - tolerance &&
    clientY <= rect.bottom + tolerance
  );
}

function rectArea(rect: DOMRect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function isSvgImageElement(element: Element): element is SVGImageElement {
  return typeof SVGImageElement !== "undefined" && element instanceof SVGImageElement;
}

function isUsableImageUrl(value: string): boolean {
  if (!value) {
    return false;
  }

  const lower = value.toLowerCase();
  return (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("blob:") ||
    lower.startsWith("file:") ||
    lower.startsWith("data:image/")
  );
}

function setLastContextPoint(point: { clientX: number; clientY: number }): void {
  (window as Window & {
    [LAST_CONTEXT_POINT_KEY]?: { clientX: number; clientY: number; capturedAt: number };
  })[LAST_CONTEXT_POINT_KEY] = {
    ...point,
    capturedAt: Date.now()
  };
}

function notifyDetectedContextImage(image: ContentDetectedImage): void {
  chrome.runtime.sendMessage(
    {
      type: CONTEXT_IMAGE_DETECTED_MESSAGE_TYPE,
      image
    },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

function normalizeUrl(value: string): string {
  try {
    return new URL(value, document.baseURI).href;
  } catch {
    return value;
  }
}
