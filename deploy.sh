#!/usr/bin/env bash
# Package ./dist and deploy it to the base_150 server as the `current` release.
set -euo pipefail

HOST="base_150"
REMOTE_DIR="/opt/services/sites/webrtc.thebase.vn"
TAR_NAME="dist.tar"

cd "$(dirname "$0")"

[ -d dist ] || { echo "dist/ folder not found" >&2; exit 1; }

LOCAL_TAR="$(mktemp -d)/${TAR_NAME}"
trap 'rm -rf "$(dirname "$LOCAL_TAR")"' EXIT

echo "==> 1. Creating ${TAR_NAME}"
tar -cf "$LOCAL_TAR" dist

echo "==> 2. Uploading to ${HOST}:${REMOTE_DIR}"
scp "$LOCAL_TAR" "${HOST}:${REMOTE_DIR}/${TAR_NAME}"

echo "==> 3-5. Extracting on ${HOST}"
ssh "$HOST" bash -s <<REMOTE
set -euo pipefail
cd "${REMOTE_DIR}"
rm -rf current dist
tar -xf "${TAR_NAME}"
mv dist current
rm -f "${TAR_NAME}"
REMOTE

echo "Deployed to ${HOST}:${REMOTE_DIR}/current"
