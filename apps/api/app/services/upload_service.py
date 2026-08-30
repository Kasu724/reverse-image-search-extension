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

IMAGE_SIGNATURES = {
    "image/png": lambda value: value.startswith(b"\x89PNG\r\n\x1a\n"),
    "image/jpeg": lambda value: value.startswith(b"\xff\xd8\xff") and value.endswith(b"\xff\xd9"),
    "image/gif": lambda value: value.startswith((b"GIF87a", b"GIF89a")),
    "image/webp": lambda value: value.startswith(b"RIFF") and value[8:12] == b"WEBP",
}


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
    content_type = content_type.lower()
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

    if not image_bytes or not IMAGE_SIGNATURES[content_type](image_bytes):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload content does not match its declared image type.",
        )

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    upload_id = secrets.token_urlsafe(18)
    path = UPLOAD_DIR / f"{upload_id}{extension}"
    try:
        path.write_bytes(image_bytes)
    except OSError as exc:
        # Do not return a record for a partially written/unavailable upload.
        path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to store uploaded image locally.",
        ) from exc
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
