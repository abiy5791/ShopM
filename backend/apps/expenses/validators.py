import os

from django.core.exceptions import ValidationError

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_BYTES = 5 * 1024 * 1024  # 5 MB


def validate_receipt_image(file) -> None:
    ext = os.path.splitext(file.name)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValidationError("Unsupported file type. Upload a JPG, PNG or WEBP image.")
    size = getattr(file, "size", None)
    if size and size > MAX_BYTES:
        raise ValidationError("File too large (max 5 MB).")
