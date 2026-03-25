FROM python:3.12-slim

WORKDIR /app

# Install dependencies first for layer caching
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py ./

# Bake in a minimal default config; users can override via mounted file or
# RADIO_CAPTURE_IMPORTER_* environment variables.
RUN mkdir -p /config
COPY config.default.yaml /config/config.yaml

CMD ["python", "main.py", "--config", "/config/config.yaml"]
