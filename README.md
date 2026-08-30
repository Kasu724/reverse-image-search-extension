# ImageLab

ImageLab is an open-source, MIT-licensed Manifest V3 Chromium extension for local image conversion and inspection.

The active product is local-only. It has no hosted backend dependency, cloud processing, remote AI, analytics, telemetry, third-party image processor, or silent upload. Reverse-image-search navigation is disabled in this phase, so ImageLab does not disclose selected image URLs or bytes to search providers.

## Features

- Convert selected images to PNG, JPG, or WebP from the context menu or workspace.
- Crop manually, apply common aspect ratios, or trim transparent and solid-color borders.
- Compress toward a target file size, with optional dimension reduction.
- Copy processed images or download them with predictable, sanitized filenames.
- Inspect dimensions and dominant colors locally in an MV3 offscreen document.
- Upload a local image or enter an image URL, then keep local notes, favorites, and bounded history in `chrome.storage.local`.
- Configure output quality, dimensions, compression defaults, save-dialog behavior, and redundant-conversion handling.

Selecting an image already displayed on a web page or entering a remote image URL may retrieve that image directly from its source host. The retrieved bytes are processed on the device and are not forwarded to an ImageLab server or third-party processing service.

## Project layout

- `apps/extension`: the active Chromium extension.
- `apps/api`: inactive FastAPI scaffolding retained for separately reviewed future work. The extension does not import, start, require, or call it.
- `docs`: product, privacy, deployment, and future-planning notes.

## Setup and validation

Requires Node.js 20 or newer and pnpm 9.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm test:api
pnpm build
```

Load `apps/extension/dist` as an unpacked extension from a Chromium extensions page with Developer mode enabled.

The extension requests access to HTTP(S) pages so its content script can identify the image the user selected and the local converter can retrieve those selected source bytes. It also uses context menus, downloads, offscreen canvas/document APIs, storage, scripting, clipboard write access, and temporary active-tab capture for protected or page-local images.

## Inactive API scaffolding

The API is not part of the active product. For local backend development only, follow [apps/api/README.md](apps/api/README.md) and bind it to `127.0.0.1`. Do not deploy or expose it publicly during the local-only phase.

## Known limits

- Animated GIF, animated WebP, and APNG conversion uses the first frame.
- Very large images remain subject to browser memory and canvas limits.
- Some protected images cannot be read directly; ImageLab attempts a local visible-tab capture when permitted.
- OCR is not implemented in the active build; the existing adapter reports it as unavailable and performs no network request.

## License

Copyright (c) 2026 Kasu724. Released under the [MIT License](LICENSE).
