# ImageLab Freemium Plan

This document is future planning, not a description of active functionality. The current release is local-only and has no cloud, billing, monitoring, OCR service, or external reverse-search integration.

## Free

- Local right-click capture.
- Local history, notes, and favorites.
- Local metadata and dominant-color analysis.
- Local analysis and editing only.

## Pro (future, inactive)

- Conceptual only; not active in the extension.
- Normalized cloud result aggregation.
- Cloud analysis and source hints.
- Saved cloud searches.
- Cloud searches per month: `300`.

## Creator/Researcher (future, inactive)

- Higher-volume source tracking.
- Batch search.
- Monitoring definitions.
- Export-oriented workflows.
- Cloud searches per month: `1500`.

## Team (future, inactive)

- Configurable usage limits.
- Shared saved searches and monitoring.
- Admin controls and future billing management.

## Local vs future scaffolding

All current features run in the browser and store data in `chrome.storage.local`. External reverse-search navigation and cloud processing are disabled for the current local-only phase.

The backend and plan descriptions above are future planning only. They are not implemented active features and the extension does not call the API.
