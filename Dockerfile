# Stage 1: build server + client, then drop devDependencies in place so the runtime
# stage can reuse this node_modules (one native better-sqlite3 build instead of two).
FROM node:20-alpine AS builder
WORKDIR /app

# Fallback toolchain for better-sqlite3 when no prebuilt musl binary matches.
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig*.json webpack.config.ts postcss.config.js tailwind.config.js ./
COPY src/ ./src/
# __dirname inside dist/server/server/db/index.js resolves migrations relative to itself,
# so SQL migrations must sit next to the compiled output.
RUN npm run build \
    && cp -r src/server/db/migrations dist/server/server/db/migrations \
    && npm prune --omit=dev --no-audit --no-fund \
    && npm cache clean --force


# Stage 2: runtime
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# ffprobe (from ffmpeg) is used by the analyze_file task to read durations.
RUN apk add --no-cache ffmpeg \
    # Convenience alias: docker exec <container> rcv-seed <command> [args...]
    && printf '#!/bin/sh\nexec node /app/dist/server/server/scripts/seed.js "$@"\n' \
        > /usr/local/bin/rcv-seed \
    && chmod +x /usr/local/bin/rcv-seed

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Run unprivileged. /app/data is the default volume mount point; an existing bind-mounted
# ./data directory must be writable by uid 1000 (chown -R 1000:1000 ./data).
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 3000

CMD ["node", "dist/server/server/index.js"]
