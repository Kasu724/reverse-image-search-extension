# ImageLab Product Spec

## Current product

ImageLab is a local-only Chromium extension for image conversion, cropping, compression, inspection, and organization. All transforms and analysis use browser APIs. Settings, current-image state, notes, favorites, and bounded history use the local Chromium profile.

The current release does not provide reverse-image-search navigation, cloud uploads, cloud analysis, hosted result aggregation, billing, monitoring, or telemetry. No core workflow requires `apps/api` or another network service.

When the user selects an HTTP(S) image already displayed on a page or enters a remote image URL, ImageLab may retrieve that selected source directly. It does not forward the image to a processing or search provider.

## Current workflows

- Capture an image from an image, page, or link context and open the ImageLab workspace.
- Convert and download PNG, JPG, and WebP output.
- Copy a locally processed PNG to the clipboard.
- Crop manually, choose common aspect ratios, or trim transparent/solid borders.
- Compress toward configurable byte targets, optionally reducing dimensions.
- Upload a small local image or enter a remote source URL.
- Inspect dimensions and dominant colors locally.
- Save local notes, mark favorites, and reopen bounded local history.
- Configure conversion quality, background, resize, compression, and download behavior.

## Product constraints

- No hosted backend, remote AI, analytics, telemetry, billing, or cloud account.
- No silent upload or forwarding of image URLs, bytes, page context, notes, history, or activity.
- No third-party image-processing or reverse-search integration.
- No remote executable code.
- Public/source image retrieval is limited to the image the user explicitly selected or entered.
- Browser memory, canvas limits, source permissions, and cross-origin protections may limit some images.
- Animated formats are decoded as a single frame.
- OCR is unavailable in the active build and its placeholder adapter makes no external request.

## Inactive future scaffolding

`apps/api` contains local FastAPI/SQLite mock routes for separately reviewed future work. It is not imported or called by the extension, is not a production service, and must not be publicly deployed in the current phase.

Ideas in `FREEMIUM_PLAN.md` are planning notes only. Any future network feature requires a new privacy, permission, security, consent, and data-retention review before activation.
