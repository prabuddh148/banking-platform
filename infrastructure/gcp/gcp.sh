#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# gcp.sh - deploy and manage the banking platform on ONE Google Compute Engine VM.
#
# Needs the gcloud CLI, logged in (gcloud auth login) with a project that has
# billing (the $300 free trial is fine). Run from the repo root (Git Bash on
# Windows works):
#
#   bash infrastructure/gcp/gcp.sh up       # firewall + VM; VM installs everything itself
#   bash infrastructure/gcp/gcp.sh status   # VM state, IP, is the site up?
#   bash infrastructure/gcp/gcp.sh logs     # setup log on the VM
#   bash infrastructure/gcp/gcp.sh ps       # container status on the VM
#   bash infrastructure/gcp/gcp.sh update   # git pull + rebuild on the VM
#   bash infrastructure/gcp/gcp.sh myip     # allow your current IP again (if it changed)
#   bash infrastructure/gcp/gcp.sh stop     # stop the VM (no CPU/RAM charges)
#   bash infrastructure/gcp/gcp.sh start    # start it again
#   bash infrastructure/gcp/gcp.sh ssh      # open a shell on the VM
#   bash infrastructure/gcp/gcp.sh down     # delete the VM and firewall rules
#
# Settings (env vars): GCP_PROJECT (default: gcloud's current project),
#   GCP_ZONE (asia-south1-a = Mumbai), GCP_MACHINE (e2-medium), GCP_VM (banking-platform),
#   GCP_DISK_GB (30), BANKING_REPO, BANKING_BRANCH (main)
# -----------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Windows + Git Bash: find a winget/installer-installed SDK that isn't on PATH yet, and use the
# Python bundled with it (the bash "gcloud" wrapper can't see the Windows Store python alias).
if [ -n "${LOCALAPPDATA:-}" ]; then
  _sdk="$(cygpath -u "${LOCALAPPDATA}" 2>/dev/null || echo "${LOCALAPPDATA}")/Google/Cloud SDK/google-cloud-sdk"
  if [ -d "${_sdk}/bin" ]; then
    command -v gcloud >/dev/null 2>&1 || export PATH="${_sdk}/bin:${PATH}"
    [ -z "${CLOUDSDK_PYTHON:-}" ] && [ -f "${_sdk}/platform/bundledpython/python.exe" ] \
      && export CLOUDSDK_PYTHON="${_sdk}/platform/bundledpython/python.exe"
  fi
fi

PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
ZONE="${GCP_ZONE:-asia-south1-a}"
MACHINE="${GCP_MACHINE:-e2-medium}"
VM="${GCP_VM:-banking-platform}"
DISK_GB="${GCP_DISK_GB:-30}"
REPO="${BANKING_REPO:-https://github.com/prabuddh148/banking-platform.git}"
BRANCH="${BANKING_BRANCH:-main}"
TAG="banking-web"
FW_HTTP="banking-allow-http"
FW_SSH="banking-allow-ssh"
# Google's IAP range, so "gcloud compute ssh --tunnel-through-iap" also works
IAP_RANGE="35.235.240.0/20"

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33mWARN: %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

g() { gcloud --project "${PROJECT}" --quiet "$@"; }

require() {
  command -v gcloud >/dev/null 2>&1 || die "gcloud CLI not found. Install: winget install Google.CloudSDK"
  gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | grep -q . \
    || die "Not logged in. Run: gcloud auth login"
  [ -n "${PROJECT}" ] || die "No project. Run: gcloud config set project <PROJECT_ID>  (or set GCP_PROJECT)"
}

my_ip() {
  local ip
  ip=$(curl -fsS -m 5 https://checkip.amazonaws.com 2>/dev/null || curl -fsS -m 5 https://api.ipify.org 2>/dev/null || true)
  ip=$(echo "${ip}" | tr -d '[:space:]')
  [[ "${ip}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Could not detect your public IPv4 address"
  echo "${ip}"
}

vm_ip() {
  g compute instances describe "${VM}" --zone "${ZONE}" \
    --format='value(networkInterfaces[0].accessConfigs[0].natIP)' 2>/dev/null || true
}

vm_exists() {
  g compute instances describe "${VM}" --zone "${ZONE}" --format='value(name)' >/dev/null 2>&1
}

site_ready() {
  # 200 from the login endpoint = nginx + gateway + account path are up
  curl -fsS -m 5 -X POST "http://$1/api/v1/auth/login" -H 'Content-Type: application/json' \
    -d '{"username":"rahul","password":"password"}' >/dev/null 2>&1
}

upsert_firewall() {
  local name="$1" port="$2" ranges="$3"
  if g compute firewall-rules describe "${name}" >/dev/null 2>&1; then
    g compute firewall-rules update "${name}" --source-ranges="${ranges}" >/dev/null
  else
    g compute firewall-rules create "${name}" --network=default --direction=INGRESS \
      --action=allow --rules="tcp:${port}" --target-tags="${TAG}" --source-ranges="${ranges}" >/dev/null
  fi
  echo "  ${name}: tcp:${port} from ${ranges}"
}

allow_my_ip() {
  local ip; ip=$(my_ip)
  log "Allowing your IP ${ip} (HTTP 80 and SSH 22)"
  upsert_firewall "${FW_HTTP}" 80 "${ip}/32"
  upsert_firewall "${FW_SSH}" 22 "${ip}/32,${IAP_RANGE}"
}

wait_ready() {
  local ip; ip=$(vm_ip)
  [ -n "${ip}" ] || die "VM has no external IP"
  log "Waiting for http://${ip} (first boot builds everything: ~20-30 min)"
  for i in $(seq 1 120); do          # up to 60 minutes
    if site_ready "${ip}"; then
      log "Site is up: http://${ip}"
      echo "  Customer login: rahul / password     Admin login: admin / admin123"
      return 0
    fi
    sleep 30
    if (( i % 4 == 0 )); then echo "  ... still building (${i}/2 min). Progress: bash infrastructure/gcp/gcp.sh logs"; fi
  done
  warn "Not ready after 60 minutes. Check: bash infrastructure/gcp/gcp.sh logs"
  return 1
}

remote() {
  g compute ssh "${VM}" --zone "${ZONE}" --command "$1"
}

cmd_up() {
  require
  log "Project ${PROJECT}, zone ${ZONE}, machine ${MACHINE}"
  log "Enabling the Compute Engine API (first time can take a minute)"
  g services enable compute.googleapis.com
  allow_my_ip
  if vm_exists; then
    log "VM ${VM} already exists - skipping create"
  else
    log "Creating VM ${VM}"
    local startup="${SCRIPT_DIR}/startup.sh"
    # Git Bash on Windows: gcloud is a Windows program and needs a C:\... path
    if command -v cygpath >/dev/null 2>&1; then startup="$(cygpath -w "${startup}")"; fi
    g compute instances create "${VM}" \
      --zone "${ZONE}" \
      --machine-type "${MACHINE}" \
      --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud \
      --boot-disk-size "${DISK_GB}GB" --boot-disk-type pd-balanced \
      --tags "${TAG}" \
      --metadata "banking-repo=${REPO},banking-branch=${BRANCH}" \
      --metadata-from-file "startup-script=${startup}"
  fi
  wait_ready
}

cmd_status() {
  require
  if ! vm_exists; then echo "VM ${VM} does not exist."; return 0; fi
  local state ip
  state=$(g compute instances describe "${VM}" --zone "${ZONE}" --format='value(status)')
  ip=$(vm_ip)
  echo "VM:     ${VM} (${MACHINE}, ${ZONE})"
  echo "State:  ${state}"
  echo "IP:     ${ip:-none}"
  if [ -n "${ip}" ] && site_ready "${ip}"; then echo "Site:   UP   -> http://${ip}"; else echo "Site:   not ready (still building, stopped, or your IP is not allowed: run 'myip')"; fi
}

cmd_down() {
  require
  log "Deleting VM ${VM} (its disk is deleted too)"
  vm_exists && g compute instances delete "${VM}" --zone "${ZONE}" --delete-disks=all || echo "  VM not found"
  for fw in "${FW_HTTP}" "${FW_SSH}"; do
    g compute firewall-rules delete "${fw}" >/dev/null 2>&1 && echo "  deleted firewall rule ${fw}" || true
  done
  log "Done. Nothing from this script is left running."
}

case "${1:-}" in
  up)     cmd_up ;;
  status) cmd_status ;;
  logs)   require; remote "sudo tail -n 80 /var/log/banking-setup.log" ;;
  ps)     require; remote "cd /opt/banking-platform && sudo docker compose -f docker/docker-compose.prod.yml --env-file docker/.env.prod ps" ;;
  update) require; remote "cd /opt/banking-platform && sudo git pull --ff-only && sudo bash infrastructure/aws/setup-ec2.sh" ;;
  myip)   require; allow_my_ip ;;
  stop)   require; log "Stopping ${VM}"; g compute instances stop "${VM}" --zone "${ZONE}" ;;
  start)  require; log "Starting ${VM}"; g compute instances start "${VM}" --zone "${ZONE}"; allow_my_ip; wait_ready ;;
  ssh)    require; g compute ssh "${VM}" --zone "${ZONE}" ;;
  down)   require; cmd_down ;;
  *)      sed -n '2,24p' "$0"; exit 1 ;;
esac
