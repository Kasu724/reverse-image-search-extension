# ImageLab API scaffolding

This FastAPI application is inactive future scaffolding. The current ImageLab extension is completely local-only and does not call this API, upload images, or depend on a backend. The `/api/cloud` routes are mock development routes, not a deployed cloud product.

Run it only on loopback while developing backend code:

```bash
python -m venv .venv
.venv\Scripts\activate
python -m pip install -e ".[dev]"
$env:IMAGELAB_SEED_DEMO = "1"
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Demo credentials are created only when `IMAGELAB_SEED_DEMO=1` is explicitly set. Never expose the development key or this service to a network. CORS is disabled by default; set `IMAGELAB_CORS_ORIGINS` to an explicit comma-separated allowlist only for local testing.
