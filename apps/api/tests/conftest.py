import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TEST_DB = Path(__file__).resolve().parent / "test_imagelab.db"
TEST_UPLOADS = Path(__file__).resolve().parent / "test_uploads"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"
os.environ["IMAGELAB_UPLOAD_DIR"] = str(TEST_UPLOADS)

from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def clean_test_db():
    engine.dispose()
    if TEST_DB.exists():
        TEST_DB.unlink()
    if TEST_UPLOADS.exists():
        for child in TEST_UPLOADS.iterdir():
            child.unlink()
        TEST_UPLOADS.rmdir()
    yield
    engine.dispose()
    if TEST_DB.exists():
        TEST_DB.unlink()
    if TEST_UPLOADS.exists():
        for child in TEST_UPLOADS.iterdir():
            child.unlink()
        TEST_UPLOADS.rmdir()


@pytest.fixture()
def client():
    with TestClient(app) as test_client:
        yield test_client
