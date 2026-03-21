# Stage 1: Build server + client
FROM node:20-alpine AS builder
WORKDIR /app

# Native build tools required for better-sqlite3
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json webpack.config.ts postcss.config.js tailwind.config.js ./
COPY src/ ./src/
RUN npm run build

# Copy SQL migrations alongside compiled server output.
# __dirname inside dist/server/server/db/index.js resolves migrations relative to itself.
RUN cp -r src/server/db/migrations dist/server/server/db/migrations


# Stage 2: Production dependencies only (native addons built for runtime image)
FROM node:20-alpine AS prod-deps
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev


# Stage 3: Runtime image
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache ffmpeg

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/server/server/index.js"]
