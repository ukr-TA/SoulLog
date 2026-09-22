"""
SoulLog backend settings.

Everything environment-specific is read from `.env` (see `.env.example`)
so no secrets ever live in source control — see spec §82 and §65.

One settings module, not a dev/prod split into separate files: every
production concern below is switched on by an environment variable and
defaults to the safe local-development behaviour. That keeps a single
source of truth (spec §115 — do not overengineer) while still making the
project deployable without a rewrite. `DEBUG=False` is what flips the
security-hardening block near the bottom on.
"""

from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv
import os

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_bool(name, default=False):
    return os.environ.get(name, str(default)).lower() in ("1", "true", "yes")


def env_list(name, default=""):
    raw = os.environ.get(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-insecure-key-change-me")
DEBUG = env_bool("DEBUG", True)
ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "localhost,127.0.0.1")

INSTALLED_APPS = [
    "daphne",  # must precede django.contrib.staticfiles so runserver speaks ASGI
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "channels",
    "users",
    "journal",
    "moods",
    "insights",
    # Subsystems that previously existed only as frontend UI.
    "social",
    "notifications",
    "messaging",
    "community",
    "sanctuary",
    "content",
    "achievements",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # WhiteNoise serves collected static files in production without needing
    # nginx in front of the app. Harmless in development.
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # Records last_seen for real presence ("Active now" in Whispers). This is
    # what replaced the hardcoded presence text in the UI — see
    # users/middleware.py for why it only writes once a minute.
    "users.middleware.LastSeenMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# --- Database (spec §60/§84) ------------------------------------------------
# DATABASE_URL takes precedence when present (that's what every managed host
# hands you); the individual DB_* variables remain the documented local path.
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("DB_NAME", "soullog_dev"),
        "USER": os.environ.get("DB_USER", "soullog"),
        "PASSWORD": os.environ.get("DB_PASSWORD", "soullog_dev_password"),
        "HOST": os.environ.get("DB_HOST", "localhost"),
        "PORT": os.environ.get("DB_PORT", "5432"),
        "CONN_MAX_AGE": int(os.environ.get("DB_CONN_MAX_AGE", "0")),
    }
}

_database_url = os.environ.get("DATABASE_URL", "").strip()
if _database_url:
    from urllib.parse import unquote, urlparse

    _parsed = urlparse(_database_url)
    DATABASES["default"].update({
        "ENGINE": "django.db.backends.postgresql",
        "NAME": _parsed.path.lstrip("/"),
        "USER": unquote(_parsed.username or ""),
        "PASSWORD": unquote(_parsed.password or ""),
        "HOST": _parsed.hostname or "",
        "PORT": str(_parsed.port or ""),
    })

AUTH_USER_MODEL = "users.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = os.environ.get("TIME_ZONE", "UTC")
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# --- Storage (spec §120's "architecture ready") -----------------------------
# Local disk by default — exactly what development wants and what the project
# has always done. Flipping USE_S3=True in the environment moves every upload
# (journal photos and voice notes, Sanctuary media, message attachments,
# avatars and covers) to an S3-compatible bucket without touching a single
# model, view or template: every one of them goes through Django's default
# storage, never a hardcoded path.
USE_S3 = env_bool("USE_S3", False)

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

if USE_S3:
    STORAGES["default"] = {"BACKEND": "storages.backends.s3.S3Storage"}
    AWS_ACCESS_KEY_ID = os.environ.get("AWS_ACCESS_KEY_ID", "")
    AWS_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY", "")
    AWS_STORAGE_BUCKET_NAME = os.environ.get("AWS_STORAGE_BUCKET_NAME", "")
    AWS_S3_REGION_NAME = os.environ.get("AWS_S3_REGION_NAME", "")
    # Set for Cloudflare R2, Backblaze B2, MinIO, DigitalOcean Spaces, etc.
    AWS_S3_ENDPOINT_URL = os.environ.get("AWS_S3_ENDPOINT_URL") or None
    AWS_S3_CUSTOM_DOMAIN = os.environ.get("AWS_S3_CUSTOM_DOMAIN") or None
    # Private by default: journal media is personal data, so objects are not
    # world-readable and URLs are signed and expiring.
    AWS_DEFAULT_ACL = None
    AWS_QUERYSTRING_AUTH = env_bool("AWS_QUERYSTRING_AUTH", True)
    AWS_QUERYSTRING_EXPIRE = int(os.environ.get("AWS_QUERYSTRING_EXPIRE", "3600"))
    AWS_S3_FILE_OVERWRITE = False

# Upload limits, enforced server-side in core/uploads.py rather than trusted
# from the client. Values are in megabytes.
MAX_IMAGE_UPLOAD_MB = int(os.environ.get("MAX_IMAGE_UPLOAD_MB", "10"))
MAX_AUDIO_UPLOAD_MB = int(os.environ.get("MAX_AUDIO_UPLOAD_MB", "25"))
MAX_VIDEO_UPLOAD_MB = int(os.environ.get("MAX_VIDEO_UPLOAD_MB", "200"))

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- DRF / JWT (spec §65 — token expiry, rotation) --------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
    # Throttling matters most on the endpoints that can be abused without an
    # account (login, registration, password reset). Scoped rates are applied
    # per-view; see users/views.py.
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.ScopedRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "auth": os.environ.get("THROTTLE_AUTH", "20/min"),
        "password_reset": os.environ.get("THROTTLE_PASSWORD_RESET", "5/min"),
        "upload": os.environ.get("THROTTLE_UPLOAD", "60/hour"),
        "search": os.environ.get("THROTTLE_SEARCH", "60/min"),
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=60),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=14),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": False,  # requires token_blacklist app if enabled later
}

# --- Channels / real-time ---------------------------------------------------
# Whispers and live notifications run over WebSockets. The channel layer is
# the only piece that needs shared state between processes:
#
#   * No REDIS_URL  -> in-memory layer. Correct for a single dev process, and
#                      it means `python manage.py runserver` still works with
#                      zero extra infrastructure.
#   * REDIS_URL set -> Redis layer. Required for more than one worker process,
#                      which is every real deployment.
#
# Nothing in the consumers knows which one is in use, so moving to production
# is an environment change, not a code change.
REDIS_URL = os.environ.get("REDIS_URL", "").strip()

if REDIS_URL:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {"hosts": [REDIS_URL]},
        }
    }
else:
    CHANNEL_LAYERS = {
        "default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}
    }

# How long after their last request a user is still considered "active now".
PRESENCE_ACTIVE_WINDOW_SECONDS = int(os.environ.get("PRESENCE_ACTIVE_WINDOW_SECONDS", "300"))

# --- Email (spec §88) -------------------------------------------------------
# Console backend in development (prints to the server log). Setting
# EMAIL_HOST switches to real SMTP delivery without any other change.
EMAIL_BACKEND = os.environ.get("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = os.environ.get("EMAIL_HOST", "")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "noreply@soullog.local")

if EMAIL_HOST and "console" in EMAIL_BACKEND:
    EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"

# Where the password-reset link in the email points. In development this is
# the Vite dev server; in production it's the deployed frontend.
FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "http://localhost:5173")

# --- CORS (spec §65) ---------------------------------------------------------
CORS_ALLOWED_ORIGINS = env_list(
    "CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
)
# Capacitor's native WebView serves the app from capacitor:// and
# http://localhost, neither of which is a normal http origin.
CORS_ALLOWED_ORIGIN_REGEXES = [r"^capacitor://.*$", r"^ionic://.*$"]
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", "") or CORS_ALLOWED_ORIGINS

# Behind an https tunnel in development (scripts/dev-phone.sh), trust the
# tunnel's X-Forwarded-Proto so links Django builds are https as well —
# otherwise a phone's browser blocks them as mixed content.
if env_bool("TRUST_X_FORWARDED_PROTO"):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# --- Security hardening (applied only when DEBUG is off) --------------------
# These are the settings `manage.py check --deploy` asks for. They are gated
# on DEBUG so local development over plain http keeps working unchanged.
if not DEBUG:
    SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", True)
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = int(os.environ.get("SECURE_HSTS_SECONDS", "31536000"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = "DENY"
    SECURE_REFERRER_POLICY = "same-origin"

    # Refuse to start rather than run insecurely. A weak SECRET_KEY
    # undermines session cookies, password-reset tokens and CSRF
    # protection all at once, and it is exactly the kind of thing that
    # gets noticed months later. Django's own `check --deploy` warns about
    # the same conditions; this makes it fatal, because a warning in a
    # deploy log is a warning nobody reads.
    if SECRET_KEY == "dev-only-insecure-key-change-me":
        raise RuntimeError(
            "SECRET_KEY is still the insecure development default. Set a real "
            "SECRET_KEY in the environment before running with DEBUG=False. "
            "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(64))\""
        )
    if len(SECRET_KEY) < 50 or len(set(SECRET_KEY)) < 5:
        raise RuntimeError(
            "SECRET_KEY is too short or too repetitive for production "
            "(needs 50+ characters and real variety). Generate one with: "
            "python -c \"import secrets; print(secrets.token_urlsafe(64))\""
        )

# --- Logging ----------------------------------------------------------------
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "standard": {"format": "[{levelname}] {asctime} {name}: {message}", "style": "{"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "standard"},
    },
    "root": {"handlers": ["console"], "level": os.environ.get("LOG_LEVEL", "INFO")},
    "loggers": {
        "django.db.backends": {"level": "WARNING", "handlers": ["console"], "propagate": False},
        "soullog": {"level": os.environ.get("LOG_LEVEL", "INFO"), "handlers": ["console"], "propagate": False},
    },
}

# --- Error tracking ---------------------------------------------------------
# Entirely opt-in: with no SENTRY_DSN in the environment nothing is imported,
# nothing is sent, and the dependency is inert.
SENTRY_DSN = os.environ.get("SENTRY_DSN", "").strip()
if SENTRY_DSN:
    import sentry_sdk
    from sentry_sdk.integrations.django import DjangoIntegration

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        integrations=[DjangoIntegration()],
        environment=os.environ.get("SENTRY_ENVIRONMENT", "production"),
        traces_sample_rate=float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
        # Journal entries are the most private data in this product. Never
        # attach request bodies or user PII to an error report.
        send_default_pii=False,
    )
