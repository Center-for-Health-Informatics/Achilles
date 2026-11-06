#!/usr/bin/env bash
#
# Build the Achilles image (linux/amd64 + linux/arm64) with Apple's `container`
# tool and, with PUSH=1, push it to the CHI registry.
#
#   ./build.sh              build only
#   PUSH=1 ./build.sh       build, scan, and push to $REGISTRY
#
# The tag is package.json's version; bump it for every image you push, since
# tags are never reused. Pushing needs `container registry login` and
# `skopeo login` for the registry, plus trivy and syft.
#
# Environment overrides: REGISTRY (default chi-tools.uc.edu), PLATFORMS,
# PUSH, FORCE (allow pushing from a dirty tree).
set -euo pipefail
cd "$(dirname "$0")"

REGISTRY=${REGISTRY:-chi-tools.uc.edu}
PLATFORMS=${PLATFORMS:-linux/amd64,linux/arm64}
NAME=achilles
PUSH=${PUSH:-0}
die() { echo "build.sh: $*" >&2; exit 1; }

VERSION=$(node -p 'require("./package.json").version')
REVISION=$(git rev-parse --short HEAD)
[[ -z $(git status --porcelain) ]] || REVISION="${REVISION}-dirty"
IMAGE="${REGISTRY}/${NAME}"
TAGS=("${VERSION}" "${VERSION}-g${REVISION%-dirty}" latest)

command -v container >/dev/null 2>&1 || die "Apple's container tool is required"
container system status >/dev/null 2>&1 || die "container system is not running (container system start)"

if [[ $PUSH == 1 ]]; then
  [[ "$REVISION" != *-dirty || ${FORCE:-0} == 1 ]] || die "refusing to push from a dirty working tree. Commit first, or set FORCE=1."
  for t in trivy syft skopeo; do command -v $t >/dev/null 2>&1 || die "$t is required to push"; done
  if out=$(skopeo inspect --raw "docker://${IMAGE}:${VERSION}" 2>&1); then
    die "${IMAGE}:${VERSION} already exists in the registry. Bump the version in package.json."
  elif ! grep -qiE 'manifest unknown|not found' <<<"$out"; then
    die "could not check ${IMAGE}:${VERSION} in the registry: ${out}"
  fi
fi

PLATFORM_ARGS=()
IFS=, read -ra PLATFORM_LIST <<<"$PLATFORMS"
for p in "${PLATFORM_LIST[@]}"; do PLATFORM_ARGS+=(--platform "$p"); done

container build "${PLATFORM_ARGS[@]}" -t "${IMAGE}:${VERSION}" \
  --build-arg VERSION="$VERSION" --build-arg REVISION="$REVISION" \
  --build-arg CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)" .
for TAG in "${TAGS[@]:1}"; do container image tag "${IMAGE}:${VERSION}" "${IMAGE}:${TAG}"; done
echo; for TAG in "${TAGS[@]}"; do echo "built ${IMAGE}:${TAG}"; done

if [[ $PUSH != 1 ]]; then echo; echo "not pushed (set PUSH=1 to push to ${REGISTRY})"; exit 0; fi

mkdir -p build
ARCHIVE="build/${NAME}-${VERSION}-amd64.tar"
LAYOUT="build/${NAME}-${VERSION}-amd64"
rm -rf "$ARCHIVE" "$LAYOUT"
container image save --platform linux/amd64 -o "$ARCHIVE" "${IMAGE}:${VERSION}"
mkdir "$LAYOUT" && tar -xf "$ARCHIVE" -C "$LAYOUT"

echo "scanning (fails on fixable HIGH/CRITICAL; accepted findings live in .trivyignore)"
trivy image --quiet --input "$LAYOUT" --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1
syft -q "oci-dir:${LAYOUT}" -o "spdx-json=build/${NAME}-${VERSION}.spdx.json"

for TAG in "${TAGS[@]}"; do echo "pushing ${IMAGE}:${TAG}"; container image push "${IMAGE}:${TAG}"; done
echo; echo "SBOM: build/${NAME}-${VERSION}.spdx.json"
