# ImageLab API

Local FastAPI backend for optional ImageLab cloud mode. It uses SQLite by default and seeds a demo Pro user:

- Email: `demo@imagelab.local`
- API key: `dev_imagelab_key`

## Run

```bash
python -m venv .venv
.venv\Scripts\activate
python -m pip install -e ".[dev]"
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Then set the extension API base URL to `http://127.0.0.1:8000` and API key to `dev_imagelab_key`.
