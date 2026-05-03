import type { ImageLabSettings, SelectedImage } from "./types";
import { imageNeedsUploadProxy } from "./imageMetadata";

export function getThirdPartyDisclosure(settings: ImageLabSettings): string {
  if (!settings.privacyMode) {
    return "Search engines will receive the image URL when you open a search.";
  }
  return "Privacy mode is on. Local analysis stays in your browser; opening a search engine sends this image URL to that engine.";
}

export function getCloudDisclosure(settings: ImageLabSettings): string {
  if (!settings.cloudMode) {
    return "Cloud mode is off. ImageLab will not send image data to the backend.";
  }
  return "Cloud mode sends image URLs or explicit uploads to your configured ImageLab API.";
}

export function getUploadProxyHint(image: SelectedImage): string | null {
  if (!imageNeedsUploadProxy(image.srcUrl)) {
    return null;
  }
  if (image.remoteImageUrl) {
    return "This uploaded image has a backend-hosted URL for third-party search engines.";
  }
  return "Uploaded or protected images can be searched after Cloud Mode uploads them to a reachable ImageLab API.";
}
