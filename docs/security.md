# Security & secret rotation

Container names below are placeholders: find yours with `docker ps`
(compose names them like `<project>-app-1`, `<project>-importer-1`).

## Secrets in this project

| Secret | Protects | Where it lives |
|---|---|---|
| Importer API key (`rcv_…`) | `/api/admin/*` (uploads) | Hashed in the DB; plaintext only in the importer's env/config |
| `FRONTEND_PASSWORD` | Viewer UI, audio, WebSocket | App env |
| Transcriber `API_KEY` = app `WHISPER_API_KEY` / `VAD_API_KEY` | Transcriber sidecar | Both containers' env |
| S3 / OpenAI credentials | Storage / transcription | App env |

Never commit these. `importer/config.yaml` is git-ignored; use env vars or a mounted file.
CI (`secret-scan.yml`) scans the full git history with gitleaks on every push/PR and weekly.

## Rotate the importer API key

```sh
# 1. Find the system id and the old key id
docker exec <app_container> rcv-seed list
docker exec <app_container> rcv-seed list-api-keys

# 2. Create a new key (printed once — copy it now)
docker exec <app_container> rcv-seed create-api-key --system-id <system-id> --name importer

# 3. Put the new key in the importer (RADIO_CAPTURE_IMPORTER_API_KEY or config.yaml) and restart it
docker restart <importer_container>

# 4. Revoke the old key
docker exec <app_container> rcv-seed revoke-api-key --id <old-key-id>
```

## Generate the other secrets

These are random strings, not stored by the app — generate on the host and set them in your `.env`:

```sh
openssl rand -hex 32   # TRANSCRIBER_API_KEY (also WHISPER_API_KEY / VAD_API_KEY on the app)
openssl rand -hex 24   # FRONTEND_PASSWORD
```

Or generate one from inside a running container:

```sh
docker exec <app_container> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then recreate the affected containers so they pick up the new env:
`docker compose up -d app transcriber`. Rotate S3/OpenAI credentials in their own consoles.

## Hardening notes

- Set `FRONTEND_PASSWORD`; without it the app logs a warning and the viewer is open.
- Run behind TLS (Basic auth is plaintext over HTTP). Set `TRUST_PROXY=true` only behind a proxy you control.
- The app image runs as uid 1000 (`node`). For an existing bind-mounted data dir: `chown -R 1000:1000 ./data`.
- The importer image runs as uid 10001; override with `user:` in compose (`IMPORTER_UID`/`IMPORTER_GID`) to match the recordings directory owner.
- The transcriber image runs as uid 10001; if you bind-mount the HF cache, chown it accordingly.
- `MAX_UPLOAD_BYTES` (default 100 MiB) bounds uploads; failed admin auth is throttled to 10/min per IP.
