# ImageLab Product Spec

## Product

ImageLab is a Chromium extension for image conversion, reverse image search, and lightweight source investigation. The free product runs locally: it converts selected images, captures image context, opens user-selected search engines, analyzes metadata and dominant colors, and stores notes/history in browser storage. Cloud mode is optional and adds normalized results, saved cloud searches, batch workflows, monitoring, and AI-assisted source discovery.

## Personas

Casual user:

- Wants to find where an image came from.
- Needs a simple right-click flow and clear privacy signals.

Student/researcher:

- Compares sources across multiple engines.
- Needs local notes, history, and repeatable searches.

Artist/creator:

- Tracks unauthorized reposts or altered copies.
- Benefits from favorites, monitoring, and batch search.

Journalist/investigator:

- Needs source hints, saved searches, and careful disclosure of where data is sent.
- Benefits from cloud aggregation and monitoring, but requires explicit controls.

## MVP

- MV3 extension with right-click image capture.
- Page-level context menu item to open ImageLab from normal page right-clicks.
- Image context submenu for opening the panel, searching one engine, or searching all enabled engines.
- Image context submenu presets for conversion, cropping helpers, and compression targets.
- Manual image entry from a public URL or small local upload.
- Combined local UI for crop, compression, and format conversion before download or reuse.
- Configurable engines: Google Images, Bing Visual Search, TinEye, Yandex Images, SauceNAO.
- Popup and extension tab with selected image, metadata, dominant colors, notes, favorites, and local history.
- Options page for privacy mode, instant open, enabled engines, cloud mode, API URL, and API key.
- FastAPI backend with seeded dev API key, SQLite, usage limits, and mock cloud endpoints.

## V1

- Lazy-loaded Tesseract.js OCR option.
- Better fallback UI for blob/data/protected images.
- Cloud upload/proxy for images without public URLs.
- Saved cloud searches and searchable collections.
- Background monitor definitions with scheduled workers.

## V2

- Licensed result aggregation providers.
- AI-assisted source discovery with explainable confidence.
- Batch queues and exports.
- Team spaces, shared investigations, role-based access, billing, and audit logs.
