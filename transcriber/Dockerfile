FROM python:3.12-slim

WORKDIR /app

ENV HF_HOME=/app/hf-cache \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app.py vad.py ./

# Run unprivileged; the model cache volume must be writable by this user.
RUN useradd --system --uid 10001 --home-dir /app app \
    && mkdir -p /app/hf-cache && chown -R app:app /app/hf-cache
USER app

# Mount a volume here to persist downloaded models across container restarts.
# e.g. -v hf-cache:/app/hf-cache
VOLUME /app/hf-cache

EXPOSE 8000

CMD ["python", "app.py"]
