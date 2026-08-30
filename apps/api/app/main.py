from contextlib import asynccontextmanager
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.auth import hash_api_key
from app.db import SessionLocal, init_db
from app.models import ApiKey, User
from app.routers import cloud, health


DEMO_EMAIL = "demo@imagelab.local"
DEMO_API_KEY = "dev_imagelab_key"


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    seed_dev_data()
    yield


app = FastAPI(
    title="ImageLab API",
    version="0.1.0",
    description="Inactive local scaffolding for future ImageLab server workflows. The extension does not require or call this service.",
    lifespan=lifespan,
)

cors_origins = [
    origin.strip()
    for origin in os.getenv("IMAGELAB_CORS_ORIGINS", "").split(",")
    if origin.strip()
]
if cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-API-Key", "Authorization"],
    )

app.include_router(health.router)
app.include_router(cloud.router)


def seed_dev_data() -> None:
    # Never create a known credential unless a developer explicitly opts in.
    seed_demo = os.getenv("IMAGELAB_SEED_DEMO", os.getenv("IMAGETRACER_SEED_DEMO", "0"))
    if seed_demo != "1":
        return

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == DEMO_EMAIL))
        if not user:
            user = User(email=DEMO_EMAIL, plan="pro")
            db.add(user)
            db.flush()
        else:
            user.plan = "pro"

        key_hash = hash_api_key(DEMO_API_KEY)
        api_key = db.scalar(select(ApiKey).where(ApiKey.key_hash == key_hash))
        if not api_key:
            db.add(
                ApiKey(
                    user_id=user.id,
                    key_hash=key_hash,
                    name="Local development key",
                    active=True,
                )
            )
        db.commit()
