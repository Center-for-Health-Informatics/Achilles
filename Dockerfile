# Dependencies are pure JavaScript, so they're installed once on the build
# platform and copied into each architecture's image: no step runs under
# emulation.
#
# The runtime is distroless (glibc + libstdc++, no shell, no package manager)
# with only the node binary copied from the official image: npm, which the
# official image bundles and which carries its own vulnerabilities, isn't
# needed to run the tool. Every base is pinned by digest.
ARG NODE_IMAGE=docker.io/library/node:24-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Per target platform, for that architecture's node binary.
FROM ${NODE_IMAGE} AS node

FROM gcr.io/distroless/cc-debian13:nonroot@sha256:08476c244888bfb425bae1ae4dd7c17f093e972aab8426883d97f3c6f280f7c1
ARG VERSION=dev
ARG REVISION=unknown
ARG CREATED
LABEL org.opencontainers.image.title="Achilles (CHI)" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}" \
      org.opencontainers.image.source="https://github.com/Center-for-Health-Informatics/Achilles"

COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json index.js compare.js ./
COPY src ./src
COPY sql ./sql

# nonroot (65532) is the base image's default user.
ENTRYPOINT ["/usr/local/bin/node", "index.js"]
