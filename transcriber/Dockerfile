FROM python:3.12-slim

WORKDIR /app

ENV HF_HOME=/app/hf-cache

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

# Mount a volume here to persist downloaded models across container restarts.
# e.g. -v hf-cache:/app/hf-cache
VOLUME /app/hf-cache

EXPOSE 8000

ENV PYTHONUNBUFFERED=1

CMD ["python", "app.py"]
