# Deployment

## Local Development

Extension:

```bash
pnpm install
pnpm build
```

Load `apps/extension/dist` as an unpacked extension.

API:

```bash
cd apps/api
python -m venv .venv
.venv\Scripts\activate
python -m pip install -e ".[dev]"
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## Environment Variables

- `DATABASE_URL`: SQLAlchemy database URL. Defaults to `sqlite:///./imagelab.db`.
- `IMAGELAB_SEED_DEMO`: Set to `0` to disable dev user/key seeding.
- `IMAGELAB_UPLOAD_DIR`: Directory for uploaded image proxy files. Defaults to `./uploaded_images`.
- `IMAGELAB_MAX_UPLOAD_BYTES`: Maximum backend upload size. Defaults to `5000000`.

## Render

- Create a Web Service from the repo.
- Root directory: `apps/api`.
- Build command: `python -m pip install -e .`
- Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Use a managed Postgres database later by setting `DATABASE_URL`.

## Railway

- Create a service from `apps/api`.
- Install with `python -m pip install -e .`.
- Start with `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
- Add Postgres and set `DATABASE_URL` when moving beyond SQLite.

## Fly.io

- Add a Dockerfile under `apps/api` when ready.
- Run Uvicorn on `0.0.0.0:8080`.
- Use Fly Postgres or an external managed Postgres instance for production.

## AWS Later

- API: ECS/Fargate, App Runner, or Lambda container.
- Database: RDS Postgres.
- Scheduled monitors: EventBridge plus workers.
- Secrets: AWS Secrets Manager or SSM Parameter Store.

## Extension Release

Run `pnpm build`, review `apps/extension/dist`, then package that directory for Chrome Web Store, Edge Add-ons, or Opera extension distribution. MV3 does not allow remotely hosted extension code, so all extension JavaScript, CSS, and assets must remain bundled.
