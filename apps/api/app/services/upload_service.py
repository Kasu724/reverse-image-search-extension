from dataclasses import dataclass
import base64
import binascii
import os
from pathlib import Path
import re
import secrets

from fastapi import HTTPException, status


MAX_UPLOAD_BYTES = int(
    os.getenv("IMAGELAB_MAX_UPLOAD_BYTES", os.getenv("IMAGETRACER_MAX_UPLOAD_BYTES", "5000000"))
)
UPLOAD_DIR = Path(
    os.getenv("IMAGELAB_UPLOAD_DIR", os.getenv("IMAGETRACER_UPLOAD_DIR", "./uploaded_images"))
)

CONTENT_TYPE_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

DATA_URL_PATTERN = re.compile(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", re.DOTALL)


@dataclass(frozen=True)
class StoredUpload:
    upload_id: str
    path: Path
    content_type: str
    size_bytes: int


def save_image_data_url(image_data_url: str) -> StoredUpload:
    match = DATA_URL_PATTERN.match(image_data_url)
    if not match:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload must be an image data URL with base64 content.",
        )

    content_type, encoded = match.groups()
    extension = CONTENT_TYPE_EXTENSIONS.get(content_type)
    if not extension:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Supported upload types are JPEG, PNG, WebP, and GIF.",
        )

    try:
        image_bytes = base64.b64decode(encoded, validate=True)
    except binascii.Error as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload contains invalid base64 image data.",
        ) from exc

    if len(image_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Uploaded images are limited to {MAX_UPLOAD_BYTES} bytes.",
        )

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    upload_id = secrets.token_urlsafe(18)
    path = UPLOAD_DIR / f"{upload_id}{extension}"
    path.write_bytes(image_bytes)
    return StoredUpload(
        upload_id=upload_id,
        path=path,
        content_type=content_type,
        size_bytes=len(image_bytes),
    )


def find_uploaded_image(upload_id: str) -> StoredUpload | None:
    for content_type, extension in CONTENT_TYPE_EXTENSIONS.items():
        path = UPLOAD_DIR / f"{upload_id}{extension}"
        if path.exists() and path.is_file():
            return StoredUpload(
                upload_id=upload_id,
                path=path,
                content_type=content_type,
                size_bytes=path.stat().st_size,
            )
    return None
