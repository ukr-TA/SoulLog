# SoulLog backend.
#
# Two stages so the runtime image carries the installed packages but not
# the compiler toolchain needed to build them — it's a smaller image and a
# smaller attack surface.

# --- build -------------------------------------------------------------------
FROM python:3.12-slim AS build

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Build dependencies for psycopg2 and Pillow. Present here, absent from the
# runtime image below.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential libpq-dev libjpeg-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --prefix=/install -r requirements.txt

# --- runtime -----------------------------------------------------------------
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DJANGO_SETTINGS_MODULE=config.settings

# libpq and libjpeg only — the shared libraries, not the headers.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 libjpeg62-turbo curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /install /usr/local

WORKDIR /app
COPY . .

# Runs as a non-root user. A container process that doesn't need root
# shouldn't have it, and this one doesn't.
RUN useradd --create-home --uid 10001 soullog \
    && mkdir -p /app/staticfiles /app/media \
    && chown -R soullog:soullog /app
USER soullog

EXPOSE 8000

# The health endpoint checks the database, so an instance that can still
# serve HTTP but has lost its database is correctly marked unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/healthz || exit 1

# Uvicorn with Gunicorn as the process manager: ASGI (which Whispers and
# live notifications require) plus Gunicorn's worker supervision. A plain
# WSGI server would serve the REST API fine and silently drop every
# WebSocket, which is the kind of failure nobody notices until users do.
CMD ["gunicorn", "config.asgi:application", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--workers", "3", \
     "--bind", "0.0.0.0:8000", \
     "--access-logfile", "-", \
     "--error-logfile", "-", \
     "--timeout", "60"]
