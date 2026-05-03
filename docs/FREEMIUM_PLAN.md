# ImageLab Freemium Plan

## Free

- Local right-click capture.
- Local history, notes, tags, and favorites.
- Local metadata and dominant-color analysis.
- Open configured third-party search engines.
- Optional OCR adapter boundary, with Tesseract.js planned as a local opt-in pack.
- Cloud searches per month: `0`.

## Pro

- Mocked now, real cloud-ready later.
- Normalized cloud result aggregation.
- Cloud analysis and source hints.
- Saved cloud searches.
- Cloud searches per month: `300`.

## Creator/Researcher

- Higher-volume source tracking.
- Batch search.
- Monitoring definitions.
- Export-oriented workflows.
- Cloud searches per month: `1500`.

## Team

- Configurable usage limits.
- Shared saved searches and monitoring.
- Admin controls and future billing management.

## Local vs Cloud

Local features run in the browser and store data in `chrome.storage.local`. Opening a third-party engine sends the image URL to that engine because that is how URL-based reverse image search works.

Cloud features call the ImageLab backend. These features require server resources because they need account state, usage accounting, saved records, batch queues, monitoring jobs, normalized result storage, upload/proxy support, and eventually paid provider integrations.
