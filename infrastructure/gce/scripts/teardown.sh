#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Lumen Pipeline — GCE Teardown Script
# ─────────────────────────────────────────────────────────────────────────────
# Stops the container and optionally stops the VM to save costs.
# Does NOT destroy infrastructure — use `terraform destroy` for that.
#
# Usage:
#   ./teardown.sh              # Stop container only
#   ./teardown.sh --stop-vm    # Stop container + stop the VM
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT="${PROJECT:-lumen-pipeline}"
ZONE="${ZONE:-us-west1-b}"
VM_NAME="${VM_NAME:-lumen-gce-gpu}"
STOP_VM=false

for arg in "$@"; do
  case $arg in
    --stop-vm) STOP_VM=true ;;
  esac
done

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Lumen Pipeline — GCE Teardown                             ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── Stop the container ───────────────────────────────────────────────────────
echo "==> Stopping lumen-server container..."
gcloud compute ssh "$VM_NAME" \
  --zone="$ZONE" \
  --project="$PROJECT" \
  --tunnel-through-iap \
  --command="
    docker stop lumen-server 2>/dev/null && echo 'Container stopped.' || echo 'Container was not running.'
    docker rm lumen-server 2>/dev/null || true
  "

# ── Optionally stop the VM ───────────────────────────────────────────────────
if [ "$STOP_VM" = "true" ]; then
  echo "==> Stopping VM $VM_NAME (saves GPU costs)..."
  gcloud compute instances stop "$VM_NAME" \
    --zone="$ZONE" \
    --project="$PROJECT" \
    --quiet
  echo "==> VM stopped. Restart with:"
  echo "    gcloud compute instances start $VM_NAME --zone=$ZONE --project=$PROJECT"
else
  echo ""
  echo "  Container stopped. VM is still running."
  echo "  To also stop the VM (saves GPU costs):"
  echo "    ./teardown.sh --stop-vm"
fi

echo ""
echo "  To fully destroy all GCE infrastructure:"
echo "    cd infrastructure/gce/terraform && terraform destroy"
echo ""
echo "  Cloud Run is unaffected by any of these operations."
