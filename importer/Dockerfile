FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# The upload path needs only the small base requirements. faster-whisper (ctranslate2,
# onnxruntime, ...) is several hundred MB and only used when the importer transcribes
# locally, so it is opt-in: --build-arg INSTALL_TRANSCRIBE=true
ARG INSTALL_TRANSCRIBE=false
COPY requirements.txt requirements-transcribe.txt ./
RUN pip install -r requirements.txt \
    && if [ "$INSTALL_TRANSCRIBE" = "true" ]; then pip install -r requirements-transcribe.txt; fi

# Bake in a minimal default config; users can override via mounted file or
# RADIO_CAPTURE_IMPORTER_* environment variables.
COPY config.default.yaml /config/config.yaml
COPY *.py ./

CMD ["python", "main.py", "--config", "/config/config.yaml"]
