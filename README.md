# ImageLab

ImageLab is a Manifest V3 Chromium extension for image tools such as image conversion and reverse image search.

## Features

- Right-click an image, open **ImageLab**, then choose **Convert** or **Search**.
- Convert and download selected images as PNG, JPG, or WEBP.
- Use quick convert with a configurable default output format.
- Crop manually in the ImageLab UI, apply aspect-ratio crops, or auto-trim transparent and solid-color borders.
- Compress images to a target size from the UI or right-click presets for 1, 2, 5, and 10 MB.
- Combine crop, compression, and format conversion in one local processing step.
- Preserve dimensions by default, or scale down to a max width and/or height.
- Configure JPG quality, WEBP quality, JPG background color, compression defaults, save-dialog behavior, and redundant-conversion skipping.
- Search selected image URLs with Google Images, Bing Visual Search, TinEye, Yandex Images, SauceNAO, or all enabled engines.
- Open the ImageLab popup/side panel to paste an image URL, upload a small local image, view local analysis, save notes, mark favorites, and review history.
- Run local dominant-color analysis through an MV3 offscreen document.
- Use the optional FastAPI backend for cloud-mode upload/search/analyze workflows.

## Project Layout

- `apps/extension`: the ImageLab Chrome extension.
- `apps/api`: optional local FastAPI backend used by cloud mode.
- `docs`: backend/cloud planning and deployment notes.

## Setup

Install JavaScript dependencies:

```bash
pnpm install
```

Install backend dependencies only if you plan to use cloud mode:

```bash
cd apps/api
python -m venv .venv
.venv\Scripts\activate
python -m pip install -e ".[dev]"
```

## Build And Load

Build the unpacked extension:

```bash
pnpm build
```

Load `apps/extension/dist` as an unpacked extension from `chrome://extensions`, `edge://extensions`, or another Chromium extension page with Developer mode enabled.

## Development

```bash
pnpm dev:extension
pnpm typecheck
pnpm test
pnpm build
```

For the optional backend:

```bash
cd apps/api
.venv\Scripts\activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Seeded local credentials:

- API base URL: `http://127.0.0.1:8000`
- API key: `dev_imagelab_key`
- User: `demo@imagelab.local`
- Plan: `pro`

## Notes

- Conversion happens locally in the browser. It fetches only the image URL selected from the context menu.
- Third-party reverse search opens external search-engine pages with the selected image URL.
- Uploaded/data/blob/local images need cloud mode before third-party search engines can access them.
- Animated GIF, animated WEBP, and APNG conversion uses the first frame.
- Very large images are limited by browser memory and canvas limits.
