# Transcription Sidecar Setup

This guide covers running a self-hosted OpenAI-compatible transcription server alongside the radio-capture-viewer.

## Using speaches.ai (recommended)

[speaches](https://github.com/speaches-ai/speaches) provides an OpenAI-compatible `/v1/audio/transcriptions` endpoint.

### docker-compose.yml addition

```yaml
services:
  speaches:
    image: ghcr.io/speaches-ai/speaches:latest-cpu
    # For GPU support:
    # image: ghcr.io/speaches-ai/speaches:latest-cuda
    ports:
      - "8000:8000"
    volumes:
      - hf-hub-cache:/home/ubuntu/.cache/huggingface/hub
    restart: unless-stopped

volumes:
  hf-hub-cache:
```

### Configuration

Update your `config.json` to point to the sidecar:

```json
{
  "whisper": {
    "enabled": true,
    "baseUrl": "http://speaches:8000",
    "apiKey": "not-needed",
    "model": "Systran/faster-whisper-base.en"
  }
}
```

Or via environment variables:

```bash
WHISPER_ENABLED=true
WHISPER_BASE_URL=http://speaches:8000
WHISPER_MODEL=Systran/faster-whisper-base.en
```

### Model selection

speaches uses Hugging Face model IDs. Common Faster Whisper models:

| Model | Size | Notes |
|-------|------|-------|
| `Systran/faster-whisper-tiny.en` | ~39MB | Fastest |
| `Systran/faster-whisper-base.en` | ~74MB | Good for radio |
| `Systran/faster-whisper-small.en` | ~244MB | Better accuracy |
| `Systran/faster-whisper-medium.en` | ~769MB | Best for noisy audio |

For radio scanner audio, `base.en` or `small.en` typically provides a good speed/accuracy tradeoff.

### GPU acceleration

For CUDA GPU support, use `latest-cuda` image and add to the service:

```yaml
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

## Using OpenAI's API

Alternatively, use OpenAI's hosted Whisper API:

```json
{
  "whisper": {
    "enabled": true,
    "baseUrl": "https://api.openai.com",
    "apiKey": "sk-...",
    "model": "whisper-1"
  }
}
```

Note: OpenAI Whisper API has a 25MB file size limit per request.
