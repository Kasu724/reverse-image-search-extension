# Deployment

ImageLab currently ships as a local-only Chromium extension. Build the unpacked extension with `pnpm build`, then load `apps/extension/dist` in a Chromium-based browser with Developer mode enabled. No hosted backend, cloud account, network service, or deployment platform is required.

`apps/api` is inactive future scaffolding. It may be run on loopback for local backend tests, but it is not a supported production deployment and must not be exposed publicly. It uses SQLite and local upload files by default. Demo credentials are disabled unless `IMAGELAB_SEED_DEMO=1` is explicitly provided, and CORS is disabled unless an explicit local allowlist is configured with `IMAGELAB_CORS_ORIGINS`.

Do not deploy the API to Render, Railway, Fly.io, AWS, or another public host as part of the current product phase. Future server work requires a separate privacy and security review.
