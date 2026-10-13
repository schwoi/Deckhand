# Deckhand with the docker-agent CLI baked in. One container = one environment.
# HOST is 0.0.0.0 inside the container, so the server refuses to start without DECKHAND_TOKEN.
#
# Prebuilt images (linux/amd64, linux/arm64) are published to ghcr.io/schwoi/deckhand,
# tagged yyyy.MM.dd.Rev and latest. Build this file only to run from source:
#
#   docker build -t deckhand .
#   docker run -d -p 4800:4800 -v deckhand:/data -e DECKHAND_TOKEN=... -e ANTHROPIC_API_KEY=... deckhand
#
# compose.yaml runs the published image; compose.dev.yaml builds this file.

ARG DOCKER_AGENT_VERSION=v1.150.0

# The build output is platform-independent JS, so build natively instead of under emulation.
FROM --platform=$BUILDPLATFORM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1-slim
ARG DOCKER_AGENT_VERSION
ARG TARGETARCH
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL -o /usr/local/bin/docker-agent \
    "https://github.com/docker/docker-agent/releases/download/${DOCKER_AGENT_VERSION}/docker-agent-linux-${TARGETARCH}" \
  && chmod +x /usr/local/bin/docker-agent

WORKDIR /app
COPY --from=build /app/package.json /app/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4800 \
    DECKHAND_HOME=/data \
    DOCKER_AGENT_BIN=/usr/local/bin/docker-agent \
    DOCKER_AGENT_HIDE_TELEMETRY_BANNER=1
VOLUME /data
EXPOSE 4800
CMD ["bun", "server/index.ts"]
