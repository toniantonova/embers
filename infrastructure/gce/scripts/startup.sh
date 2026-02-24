#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Lumen Pipeline — GCE VM Startup Script
# ─────────────────────────────────────────────────────────────────────────────
# Runs on first boot and reboots. Installs NVIDIA drivers, Docker, pulls the
# container image, and starts the Lumen server with all four models.
#
# Template variables (injected by Terraform templatefile()):
#   ${image_uri}       — Container image URI
#   ${project_id}      — GCP project ID
#   ${cache_bucket}    — Shape cache GCS bucket name
#   ${weights_bucket}  — Model weights GCS bucket name
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

LOG_TAG="lumen-startup"
IMAGE="${image_uri}"

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [$LOG_TAG] $*"
  logger -t "$LOG_TAG" "$*"
}

# ── Guard: Only run driver/Docker install once ───────────────────────────────
# Uses a persistent path on the boot disk (NOT /var/run which is tmpfs).
SETUP_MARKER="/opt/lumen/.setup-complete"
mkdir -p /opt/lumen

if [ -f "$SETUP_MARKER" ]; then
  log "System setup already completed — ensuring container is running"

  # If the container exists, just start it
  if docker inspect lumen-server &>/dev/null; then
    docker start lumen-server 2>/dev/null || true
    log "Container restarted"
    exit 0
  fi

  # Container was removed (e.g. Docker update) — re-pull and re-run
  log "Container not found — re-pulling and re-running"
  gcloud auth configure-docker us-central1-docker.pkg.dev,us-west1-docker.pkg.dev --quiet
  docker pull "$IMAGE"

  API_KEY=$(gcloud secrets versions access latest --secret=lumen-api-key --project="${project_id}" --quiet)
  HF_TOKEN=$(gcloud secrets versions access latest --secret=lumen-hf-token --project="${project_id}" --quiet)

  docker run -d \
    --name lumen-server \
    --gpus all \
    --restart unless-stopped \
    -p 8080:8080 \
    -e CACHE_BUCKET="${cache_bucket}" \
    -e MODEL_CACHE_DIR=/home/appuser/models \
    -e MODEL_WEIGHTS_BUCKET="${weights_bucket}" \
    -e API_KEY="$API_KEY" \
    -e HF_TOKEN="$HF_TOKEN" \
    -e ALLOWED_ORIGINS="${allowed_origins}" \
    -e EAGER_LOAD_ALL=true \
    -e VRAM_OFFLOAD_THRESHOLD_GB=99 \
    -e LOG_JSON=true \
    "$IMAGE"

  log "Container re-created and started"
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Install NVIDIA GPU drivers
# ─────────────────────────────────────────────────────────────────────────────
log "Installing NVIDIA GPU drivers..."

apt-get update -qq
apt-get install -y -qq linux-headers-$(uname -r) software-properties-common

# Install NVIDIA driver 550 (server variant — headless)
add-apt-repository -y ppa:graphics-drivers/ppa
apt-get update -qq
apt-get install -y -qq nvidia-driver-550-server

# Verify driver
log "Verifying NVIDIA driver..."
nvidia-smi || {
  log "ERROR: nvidia-smi failed — driver not loaded. Rebooting..."
  reboot
  exit 1
}

# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Install Docker + NVIDIA Container Toolkit
# ─────────────────────────────────────────────────────────────────────────────
log "Installing Docker..."

apt-get install -y -qq ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin

# NVIDIA Container Toolkit
log "Installing NVIDIA Container Toolkit..."
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

distribution=$(. /etc/os-release; echo "$ID$VERSION_ID")
curl -fsSL "https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list" \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  > /etc/apt/sources.list.d/nvidia-container-toolkit.list

apt-get update -qq
apt-get install -y -qq nvidia-container-toolkit

nvidia-ctk runtime configure --runtime=docker
systemctl restart docker

log "Docker + NVIDIA Container Toolkit installed"

# ─────────────────────────────────────────────────────────────────────────────
# Step 3: Authenticate to Artifact Registry
# ─────────────────────────────────────────────────────────────────────────────
log "Authenticating to Artifact Registry..."
gcloud auth configure-docker us-central1-docker.pkg.dev,us-west1-docker.pkg.dev --quiet

# ─────────────────────────────────────────────────────────────────────────────
# Step 4: Pull the container image
# ─────────────────────────────────────────────────────────────────────────────
log "Pulling image: $IMAGE"
docker pull "$IMAGE"

# ─────────────────────────────────────────────────────────────────────────────
# Step 5: Fetch secrets from Secret Manager
# ─────────────────────────────────────────────────────────────────────────────
log "Fetching secrets..."
API_KEY=$(gcloud secrets versions access latest --secret=lumen-api-key --project="${project_id}" --quiet)
HF_TOKEN=$(gcloud secrets versions access latest --secret=lumen-hf-token --project="${project_id}" --quiet)

# ─────────────────────────────────────────────────────────────────────────────
# Step 6: Run the container
# ─────────────────────────────────────────────────────────────────────────────
log "Starting Lumen server container..."

docker stop lumen-server 2>/dev/null || true
docker rm lumen-server 2>/dev/null || true

docker run -d \
  --name lumen-server \
  --gpus all \
  --restart unless-stopped \
  -p 8080:8080 \
  -e CACHE_BUCKET="${cache_bucket}" \
  -e MODEL_CACHE_DIR=/home/appuser/models \
  -e MODEL_WEIGHTS_BUCKET="${weights_bucket}" \
  -e API_KEY="$API_KEY" \
  -e HF_TOKEN="$HF_TOKEN" \
  -e ALLOWED_ORIGINS="${allowed_origins}" \
  -e EAGER_LOAD_ALL=true \
  -e VRAM_OFFLOAD_THRESHOLD_GB=99 \
  -e LOG_JSON=true \
  "$IMAGE"

# ─────────────────────────────────────────────────────────────────────────────
# Step 7: Wait for readiness
# ─────────────────────────────────────────────────────────────────────────────
log "Waiting for /health/ready to return 200..."
for i in $(seq 1 120); do
  STATUS=$(curl -s -o /dev/null -w '%%{http_code}' http://localhost:8080/health/ready 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    log "Service is ready! (attempt $i)"
    break
  fi
  if [ "$i" = "120" ]; then
    log "WARNING: Service did not become ready within 600s"
    log "Container logs:"
    docker logs --tail 50 lumen-server
  fi
  sleep 5
done

# Mark system setup as complete (persistent across reboots)
touch "$SETUP_MARKER"
log "Startup script complete"
