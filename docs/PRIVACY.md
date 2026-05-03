# ImageLab Privacy

## Local-Only Processing

By default, ImageLab stores selected images, history, favorites, notes, metadata, and dominant colors in `chrome.storage.local`. Dominant-color analysis runs in an MV3 offscreen document using browser canvas APIs. The default OCR implementation is a local mock adapter and sends nothing.

When a user uploads an image in the extension UI, the image is converted to a local data URL for preview, history, notes, and local analysis. It is not sent to third-party engines or the ImageLab backend until the user explicitly starts a cloud action or reverse search that needs a hosted URL.

For uploaded-image reverse search, Cloud Mode uploads the image to the configured ImageLab API and caches the returned hosted URL on the local image record. That hosted URL is then sent to third-party search engines. For real third-party engine fetches, the API must be reachable from the public internet.

## Search Engines

When a user opens Google Images, Bing Visual Search, TinEye, Yandex Images, or SauceNAO, ImageLab opens that engine with the selected image URL. That third-party search engine receives the URL. The UI labels this action with a **Sends to search engine** badge.

Blob, data, protected, and local file images are not public URLs. The extension warns that these need a future upload/proxy workflow before third-party reverse search can work reliably.

## Cloud Mode

Cloud mode is off by default. When enabled, the extension sends the image URL, page URL, and selected engine list to the configured ImageLab API for cloud search. Cloud analysis sends the image URL and page URL. The current backend returns mock data and stores usage/search records locally in SQLite.

## User Controls

- Enable or disable each search engine.
- Keep cloud mode off for local-only workflows.
- Set the API base URL and API key manually.
- Disable instant open to avoid automatically launching third-party searches.
- Store notes/favorites locally without cloud sync.
