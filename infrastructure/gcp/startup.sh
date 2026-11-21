#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# startup.sh - GCP Compute Engine startup script (runs as root on EVERY boot).
#
# Passed to the VM by infrastructure/gcp/gcp.sh (metadata "startup-script").
#   - First boot: install git, clone the repo to /opt/banking-platform and run
#     infrastructure/aws/setup-ec2.sh (Docker, swap, secrets, build, start).
#   - Later boots: nothing to do, Docker restarts the containers by itself
#     (restart: unless-stopped).
#
# Progress log on the VM:  sudo tail -f /var/log/banking-setup.log
# The repo URL/branch come from VM metadata keys "banking-repo" / "banking-branch".
# -----------------------------------------------------------------------------
set -euo pipefail

LOG=/var/log/banking-setup.log
DONE_MARKER=/var/lib/banking-setup.done
APP_DIR=/opt/banking-platform

exec >>"${LOG}" 2>&1
echo "===== startup.sh $(date -u +%Y-%m-%dT%H:%M:%SZ) ====="

if [ -f "${DONE_MARKER}" ]; then
  echo "Setup already done on an earlier boot - nothing to do."
  exit 0
fi

meta() {
  curl -fsS -m 3 -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1" 2>/dev/null || true
}
REPO="$(meta banking-repo)"
REPO="${REPO:-https://github.com/prabuddh148/banking-platform.git}"
BRANCH="$(meta banking-branch)"
BRANCH="${BRANCH:-main}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q git curl openssl

if [ ! -d "${APP_DIR}/.git" ]; then
  echo "Cloning ${REPO} (${BRANCH}) into ${APP_DIR}"
  git clone --depth 1 --branch "${BRANCH}" "${REPO}" "${APP_DIR}"
fi

cd "${APP_DIR}"
bash infrastructure/aws/setup-ec2.sh

touch "${DONE_MARKER}"
echo "===== setup finished $(date -u +%Y-%m-%dT%H:%M:%SZ) ====="
