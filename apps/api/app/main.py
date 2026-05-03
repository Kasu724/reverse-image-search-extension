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
    description="Cloud-ready API for ImageLab reverse image workflows.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(cloud.router)


def seed_dev_data() -> None:
    seed_demo = os.getenv("IMAGELAB_SEED_DEMO", os.getenv("IMAGETRACER_SEED_DEMO", "1"))
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
