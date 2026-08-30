# ImageLab privacy

## Active product

ImageLab's active extension is local-only. Images are processed with browser APIs. Settings, current-image state, bounded history, favorites, notes, metadata, and dominant-color analysis remain in the local Chromium profile. There is no analytics, telemetry, hosted AI, cloud processing, or silent upload.

Selecting an HTTP(S) image already displayed on a page or entering a remote image URL may cause ImageLab to retrieve that selected source directly from its origin. That source request is necessary to read the chosen image; ImageLab does not forward the bytes, URL, page context, or result to a backend, search provider, or image-processing service.

The extension does not require `apps/api`. The backend directory is inactive future scaffolding and is not part of normal runtime.

## External navigation

The local-only product does not send image URLs or image bytes to reverse-search providers. Any future external-search capability must be an explicit, separately reviewed action with a clear disclosure before navigation.

## Storage and permissions

Embedded local images are kept within a bounded history budget so they do not consume the entire extension storage quota. Browser storage and browser-managed permissions remain subject to the Chromium profile's own storage and privacy controls. Removing the extension or clearing its extension data removes its local state through Chromium.

Broad HTTP(S) page access supports context-image detection and direct retrieval of the user-selected source. Other requested capabilities are used for context menus, downloads, local storage, clipboard writes, local offscreen processing, scripting into the active page, and temporary active-tab capture.
