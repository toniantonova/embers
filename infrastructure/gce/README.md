# Lumen Pipeline — GCE GPU VM Deployment

Compute Engine GPU VM for eager-loading all four ML models (SDXL Turbo, PartCrafter, Hunyuan3D Turbo, Grounded SAM 2) on a larger GPU with sufficient VRAM headroom.

> [!IMPORTANT]
> This deployment is **completely isolated** from the existing Cloud Run infrastructure. It uses a separate Terraform state, separate service account, and separate compute resources. Tearing this down has zero effect on Cloud Run.

## Prerequisites

- **GCP Project:** `lumen-pipeline` with billing enabled
- **GPU Quota:** L40S (or A100) in `us-west1-b` — [request quota](https://console.cloud.google.com/iam-admin/quotas)
- **Terraform:** >= 1.5.0 installed
- **gcloud CLI:** Authenticated with `gcloud auth login`
- **Existing deployment:** Cloud Run must be deployed first (creates shared secrets, buckets, AR repo)

## Quick Start

### 1. Configure Variables

```bash
cd infrastructure/gce/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars — set project_id and adjust GPU/network settings
```

### 2. Provision Infrastructure

```bash
terraform init
terraform plan    # Review the changes
terraform apply   # Creates VM, SA, network, firewall rules
```

The startup script runs automatically on first boot (~5–10 min):
1. Installs NVIDIA drivers + Docker + NVIDIA Container Toolkit
2. Pulls the container image from Artifact Registry
3. Fetches secrets from Secret Manager
4. Starts the container with `EAGER_LOAD_ALL=true`

### 3. Verify

```bash
# SSH into the VM
$(terraform output -raw ssh_command)

# Check GPU
nvidia-smi

# Check container
docker ps
docker logs lumen-server

# Test health (from inside VM)
curl http://localhost:8080/health/ready
# Expected: {"status":"ready","models_loaded":["sdxl_turbo","partcrafter","hunyuan3d_turbo","grounded_sam2"],"cache_connected":true}
```

## Day-to-Day Operations

### Deploy New Code

```bash
# Full build + deploy
./infrastructure/gce/scripts/deploy.sh

# Skip build (just restart with existing image)
./infrastructure/gce/scripts/deploy.sh --skip-build
```

### Monitor

```bash
# Container logs
gcloud compute ssh lumen-gce-gpu --zone=us-west1-b --tunnel-through-iap --command="docker logs --tail 100 -f lumen-server"

# GPU/VRAM status
gcloud compute ssh lumen-gce-gpu --zone=us-west1-b --tunnel-through-iap --command="nvidia-smi"

# Detailed health + VRAM
gcloud compute ssh lumen-gce-gpu --zone=us-west1-b --tunnel-through-iap --command="curl -s -H 'X-API-Key: \$(gcloud secrets versions access latest --secret=lumen-api-key --quiet)' http://localhost:8080/health/detailed | python3 -m json.tool"
```

### Stop / Start (Save Costs)

```bash
# Stop the VM (saves GPU costs — ~$2.83/hr for L40S)
./infrastructure/gce/scripts/teardown.sh --stop-vm

# Restart the VM
gcloud compute instances start lumen-gce-gpu --zone=us-west1-b --project=lumen-pipeline
```

## Rollback to Cloud Run

The Cloud Run deployment is **always running** and unmodified. To roll back:

1. Point your client/DNS back to the Cloud Run service URL
2. Optionally tear down GCE:
   ```bash
   ./infrastructure/gce/scripts/teardown.sh --stop-vm
   # Or fully destroy:
   cd infrastructure/gce/terraform && terraform destroy
   ```

## Architecture Comparison

| | Cloud Run (current) | GCE VM (this) |
|---|---|---|
| **GPU** | 1× NVIDIA RTX Pro 6000 (96 GB) | 1× NVIDIA L40S (48 GB) |
| **Models loaded** | 4 (all, eager-loaded) | 4 (primary + fallback) |
| **Fallback latency** | ~2–4s (already loaded) | ~2–4s (already loaded) |
| **Scaling** | Auto (0–1 instances) | Fixed (1 VM) |
| **Monthly cost** | ~$1,500–1,800 | ~$2,050 on-demand / ~$615 CUD |

## File Layout

```
infrastructure/gce/
├── terraform/
│   ├── main.tf                  # Provider, backend (separate state prefix)
│   ├── vm.tf                    # Compute Engine instance + GPU
│   ├── network.tf               # VPC, subnet, firewall rules
│   ├── iam.tf                   # Service account + role bindings
│   ├── variables.tf             # Input variables
│   ├── outputs.tf               # SSH command, IP, health URL
│   └── terraform.tfvars.example # Example values
├── scripts/
│   ├── startup.sh               # VM first-boot script
│   ├── deploy.sh                # One-command redeploy
│   └── teardown.sh              # Stop container / VM
├── cloudbuild-gce.yaml          # Cloud Build config
└── README.md                    # This file
```

## Key Environment Variables (GCE-specific)

| Variable | Value | Purpose |
|---|---|---|
| `EAGER_LOAD_ALL` | `true` | Load all 4 models at startup |
| `VRAM_OFFLOAD_THRESHOLD_GB` | `99` | Disable VRAM offloading (models stay resident) |
| `LOG_JSON` | `true` | Structured JSON logs for Cloud Logging |
