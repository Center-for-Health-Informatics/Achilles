# Dependencies are pure JavaScript, so they're installed once on the build
# platform and copied into each architecture's image: no step runs under
# emulation. Base images are pinned by digest (node:24-slim, 24.22.2).
FROM --platform=$BUILDPLATFORM docker.io/library/node:24-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM docker.io/library/node:24-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9
ARG VERSION=dev
ARG REVISION=unknown
ARG CREATED
LABEL org.opencontainers.image.title="Achilles (CHI)" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}" \
      org.opencontainers.image.source="https://github.com/Center-for-Health-Informatics/Achilles"

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json index.js compare.js ./
COPY src ./src
COPY sql ./sql

USER node
ENTRYPOINT ["node", "index.js"]
