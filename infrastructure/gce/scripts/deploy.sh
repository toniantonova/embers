#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Lumen Pipeline — GCE Deploy Script
# ─────────────────────────────────────────────────────────────────────────────
# One-command redeploy: build image → push → SSH into VM → restart container.
# Usage: ./deploy.sh [--skip-build]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT="${PROJECT:-lumen-pipeline}"
REGION="${REGION:-us-west1}"
ZONE="${ZONE:-us-west1-b}"
VM_NAME="${VM_NAME:-lumen-gce-gpu}"
IMAGE_URI="${IMAGE_URI:-us-central1-docker.pkg.dev/$PROJECT/lumen-pipeline-docker/lumen-pipeline:latest}"
CACHE_BUCKET="${CACHE_BUCKET:-lumen-shape-cache-$PROJECT}"
WEIGHTS_BUCKET="${WEIGHTS_BUCKET:-lumen-model-weights-$PROJECT}"
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-}"
SKIP_BUILD=false

for arg in "$@"; do
  case $arg in
    --skip-build) SKIP_BUILD=true ;;
  esac
done

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Lumen Pipeline — GCE Deploy                               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Project:  $PROJECT"
echo "  VM:       $VM_NAME ($ZONE)"
echo "  Image:    $IMAGE_URI"
echo ""

# ── Step 1: Build and push image ─────────────────────────────────────────────
if [ "$SKIP_BUILD" = "false" ]; then
  echo "==> Building and pushing image via Cloud Build..."
  REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
  gcloud builds submit "$REPO_ROOT/server/" \
    --config="$(dirname "$0")/../cloudbuild-gce.yaml" \
    --project="$PROJECT" \
    --region="$REGION" \
    --substitutions="_IMAGE_URI=$IMAGE_URI"
else
  echo "==> Skipping build (--skip-build)"
fi

# ── Step 2: Restart container on VM ──────────────────────────────────────────
echo "==> Restarting container on $VM_NAME..."
gcloud compute ssh "$VM_NAME" \
  --zone="$ZONE" \
  --project="$PROJECT" \
  --tunnel-through-iap \
  --command="
    set -e
    echo 'Pulling latest image...'
    docker pull $IMAGE_URI

    echo 'Stopping existing container...'
    docker stop lumen-server 2>/dev/null || true
    docker rm lumen-server 2>/dev/null || true

    echo 'Fetching secrets...'
    API_KEY=\$(gcloud secrets versions access latest --secret=lumen-api-key --project=$PROJECT --quiet)
    HF_TOKEN=\$(gcloud secrets versions access latest --secret=lumen-hf-token --project=$PROJECT --quiet)

    echo 'Starting new container...'
    docker run -d \
      --name lumen-server \
      --gpus all \
      --restart unless-stopped \
      -p 8080:8080 \
      -e CACHE_BUCKET=$CACHE_BUCKET \
      -e MODEL_CACHE_DIR=/home/appuser/models \
      -e MODEL_WEIGHTS_BUCKET=$WEIGHTS_BUCKET \
      -e API_KEY=\"\$API_KEY\" \
      -e HF_TOKEN=\"\$HF_TOKEN\" \
      -e ALLOWED_ORIGINS='$ALLOWED_ORIGINS' \
      -e EAGER_LOAD_ALL=true \
      -e VRAM_OFFLOAD_THRESHOLD_GB=99 \
      -e LOG_JSON=true \
      $IMAGE_URI

    echo 'Container started.'
  "

# ── Step 3: Wait for health (single SSH session) ────────────────────────────
echo "==> Waiting for service to become healthy..."
gcloud compute ssh "$VM_NAME" \
  --zone="$ZONE" \
  --project="$PROJECT" \
  --tunnel-through-iap \
  --command="
    for i in \$(seq 1 60); do
      STATUS=\$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/health/ready 2>/dev/null || echo '000')
      if [ \"\$STATUS\" = '200' ]; then
        echo \"Healthy! (attempt \$i)\"
        exit 0
      fi
      echo \"Waiting... (attempt \$i/60, status=\$STATUS)\"
      sleep 10
    done
    echo 'WARNING: Service did not become ready within 600s'
    docker logs --tail 50 lumen-server
    exit 1
  "

echo ""
echo "  ✅ Deploy complete!"
echo ""
echo "  SSH:    gcloud compute ssh $VM_NAME --zone=$ZONE --project=$PROJECT --tunnel-through-iap"
echo "  Health: gcloud compute ssh $VM_NAME --zone=$ZONE --project=$PROJECT --tunnel-through-iap --command='curl -s http://localhost:8080/health/ready | python3 -m json.tool'"
echo ""
