"""
The one upload pipeline every media feature in SoulLog goes through.

Journal photo/voice attachments, Sanctuary posts, message attachments,
profile avatars and covers all validate here. Having a single module means
a limit or an allowed type is changed in one place, and — more importantly —
that no feature can accidentally skip validation by writing its own
half-version of it.

What is actually checked, and why each one matters:

  size      A client-side check is a convenience, not a control. The real
            limit lives here, read from settings so it's configurable per
            deployment.
  extension Cheap first pass, and it's what determines the stored filename.
  content   The browser-supplied Content-Type is attacker-controlled, so it
            is never trusted on its own. Images are verified by actually
            opening them with Pillow; audio and video are checked against
            their file signature (magic bytes).
  filename  The original name is discarded entirely and replaced with a
            random one. That removes path traversal, overwriting someone
            else's file, and the surprisingly common case of a filename
            that leaks personal information.

Storage backend is deliberately not this module's concern: everything is
written through Django's configured default storage, so local disk and S3
are the same code path (see `STORAGES` in config/settings.py).
"""

import mimetypes
import os
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic"}
AUDIO_EXTENSIONS = {".mp3", ".m4a", ".aac", ".wav", ".ogg", ".webm"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".m4v"}

# Leading bytes that identify a container format. Used for audio and video,
# where we have no equivalent of Pillow's "just try to open it".
_MAGIC_SIGNATURES = [
    (b"\xff\xfb", "audio/mpeg"),
    (b"\xff\xf3", "audio/mpeg"),
    (b"\xff\xf2", "audio/mpeg"),
    (b"ID3", "audio/mpeg"),
    (b"RIFF", "audio/wav"),
    (b"OggS", "audio/ogg"),
    (b"\x1a\x45\xdf\xa3", "video/webm"),  # Matroska/WebM — also used for audio
]


class UploadKind:
    IMAGE = "image"
    AUDIO = "audio"
    VIDEO = "video"


_LIMIT_SETTING = {
    UploadKind.IMAGE: "MAX_IMAGE_UPLOAD_MB",
    UploadKind.AUDIO: "MAX_AUDIO_UPLOAD_MB",
    UploadKind.VIDEO: "MAX_VIDEO_UPLOAD_MB",
}

_ALLOWED_EXTENSIONS = {
    UploadKind.IMAGE: IMAGE_EXTENSIONS,
    UploadKind.AUDIO: AUDIO_EXTENSIONS,
    UploadKind.VIDEO: VIDEO_EXTENSIONS,
}


def kind_for_extension(extension):
    extension = extension.lower()
    for kind, allowed in _ALLOWED_EXTENSIONS.items():
        if extension in allowed:
            return kind
    return None


def max_bytes(kind):
    return getattr(settings, _LIMIT_SETTING[kind]) * 1024 * 1024


def _verify_image(uploaded_file):
    """Open the file as an image. A file that only *claims* to be a PNG
    fails here, which is the point."""
    from PIL import Image, UnidentifiedImageError

    uploaded_file.seek(0)
    try:
        image = Image.open(uploaded_file)
        image.verify()
    except (UnidentifiedImageError, OSError, ValueError):
        raise ValidationError("That file isn't a readable image.")
    finally:
        uploaded_file.seek(0)


def _verify_signature(uploaded_file, kind):
    uploaded_file.seek(0)
    header = uploaded_file.read(16)
    uploaded_file.seek(0)

    # ISO base media format (MP4/MOV/M4A) puts 'ftyp' at offset 4.
    if len(header) >= 12 and header[4:8] == b"ftyp":
        return

    for signature, _label in _MAGIC_SIGNATURES:
        if header.startswith(signature):
            return

    raise ValidationError(
        "That file doesn't look like a valid {} file.".format(
            "audio" if kind == UploadKind.AUDIO else "video"
        )
    )


def validate_upload(uploaded_file, allowed_kinds=None):
    """
    Validates `uploaded_file` and returns `(kind, extension, mime_type)`.

    Raises `django.core.exceptions.ValidationError` with a message written
    for a human, because these messages are shown directly in the UI.
    """
    original_name = getattr(uploaded_file, "name", "") or ""
    extension = os.path.splitext(original_name)[1].lower()

    kind = kind_for_extension(extension)
    if kind is None:
        raise ValidationError(
            "Unsupported file type. Allowed: images (jpg, png, gif, webp, heic), "
            "audio (mp3, m4a, aac, wav, ogg), video (mp4, mov, webm)."
        )

    if allowed_kinds is not None and kind not in allowed_kinds:
        readable = " or ".join(sorted(allowed_kinds))
        raise ValidationError(f"This field only accepts {readable} files.")

    limit = max_bytes(kind)
    if uploaded_file.size > limit:
        raise ValidationError(
            f"That file is {uploaded_file.size / 1024 / 1024:.1f} MB — the limit "
            f"for {kind} uploads is {limit // 1024 // 1024} MB."
        )
    if uploaded_file.size == 0:
        raise ValidationError("That file is empty.")

    if kind == UploadKind.IMAGE:
        _verify_image(uploaded_file)
    else:
        _verify_signature(uploaded_file, kind)

    mime_type = mimetypes.guess_type(f"x{extension}")[0] or "application/octet-stream"
    return kind, extension, mime_type


def safe_upload_name(instance, filename):
    """
    `upload_to` callable. Discards the client's filename entirely.

    Files are partitioned by owner id so that a bucket listing (or an `ls`)
    never mixes two users' media together, which makes both debugging and
    a future per-user deletion sweep straightforward.
    """
    extension = os.path.splitext(filename)[1].lower() or ".bin"
    owner_id = (
        getattr(instance, "owner_id", None)
        or getattr(instance, "user_id", None)
        or getattr(instance, "author_id", None)
        or "shared"
    )
    prefix = getattr(instance, "UPLOAD_PREFIX", "uploads")
    return f"{prefix}/{owner_id}/{uuid.uuid4().hex}{extension}"
