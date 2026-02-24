# Lumen Server Pipeline — Infrastructure

This directory contains the GCP infrastructure-as-code for the Lumen ML pipeline server.

## Architecture

```
Client (React + Three.js)
  │
  │  POST /generate { text: "horse", verb: "galloping" }
  │
  ▼
Cloud Run (NVIDIA RTX Pro 6000 96GB, us-central1)
  ├── SDXL Turbo       → image    (~1s,  3GB VRAM)
  ├── PartCrafter      → meshes   (~0.5s, 4GB VRAM)  [PRIMARY]
  │   └── Fallback → Hunyuan3D-2 Turbo + Grounded SAM 2
  ├── Poisson Sampling → 2,048 labeled points
  └── Cache (Memory LRU + Cloud Storage)
  │
  │  Response: ~27KB { positions, partIds, partNames }
  ▼
Client renders particles
```

## Prerequisites

1. **Google Cloud SDK** — [Install gcloud](https://cloud.google.com/sdk/docs/install)
2. **Terraform** ≥ 1.5 — [Install Terraform](https://developer.hashicorp.com/terraform/downloads)
3. A GCP project with billing enabled
4. GPU quota for Cloud Run in `us-central1` (request if needed)

## Setup

### 1. Authenticate

```bash
# Login to GCP
gcloud auth login
gcloud auth application-default login

# Set your project
gcloud config set project YOUR_PROJECT_ID
```

### 2. Configure Variables

```bash
cd infrastructure/terraform

# Copy the example and fill in your project ID
cp terraform.tfvars.example terraform.tfvars

# Edit terraform.tfvars — at minimum set project_id
```

### 3. Initialize Terraform

```bash
terraform init
```

### 4. Preview Changes

```bash
terraform plan
```

### 5. Apply Infrastructure

```bash
terraform apply
```

After a successful apply, you'll see:

| Output | Description |
|--------|-------------|
| `cloud_run_url` | Service URL for `POST /generate` requests |
| `artifact_registry_url` | Docker repo for `docker push` |
| `cache_bucket_name` | Cloud Storage bucket for cached shapes |
| `service_account_email` | Cloud Run service account |
| `full_image_uri` | Full image URI template for builds |

## Building & Deploying the Server

### Option A: Cloud Build (recommended)

```bash
# From repo root
gcloud builds submit \
  --config infrastructure/cloudbuild.yaml \
  --substitutions=_REGION=us-central1,_SERVICE_NAME=lumen-pipeline \
  .
```

### Option B: Manual Docker Build + Deploy

```bash
# Build locally
docker build -t lumen-pipeline:latest -f server/Dockerfile server/

# Tag for Artifact Registry (use the output from terraform apply)
docker tag lumen-pipeline:latest \
  us-central1-docker.pkg.dev/YOUR_PROJECT/lumen-pipeline-docker/lumen-pipeline:latest

# Push
docker push \
  us-central1-docker.pkg.dev/YOUR_PROJECT/lumen-pipeline-docker/lumen-pipeline:latest

# Deploy
gcloud run deploy lumen-pipeline \
  --image us-central1-docker.pkg.dev/YOUR_PROJECT/lumen-pipeline-docker/lumen-pipeline:latest \
  --region us-central1
```

## Cost Estimates

| Usage Level | Monthly Cost |
|------------|-------------|
| Development (solo) | $10–30 (scales to zero) |
| Soft Launch (100 users) | $30–50 |
| Growth (1,000 users) | $50–100 |
| Scale (10,000 users) | $100–300 |

## Tearing Down

```bash
cd infrastructure/terraform
terraform destroy
```

> **Note:** The Cloud Storage bucket has `force_destroy = false` to protect cached data. Empty it first or set `force_destroy = true` in `storage.tf` before destroying.

## File Structure

```
infrastructure/
├── terraform/
│   ├── main.tf                    # Provider, backend, API enablement
│   ├── variables.tf               # Input variables
│   ├── outputs.tf                 # Post-apply outputs
│   ├── cloud_run.tf               # Cloud Run v2 GPU service + IAM
│   ├── artifact_registry.tf       # Docker repository
│   ├── storage.tf                 # Cache bucket + lifecycle rules
│   ├── iam.tf                     # Service accounts + role bindings
│   └── terraform.tfvars.example   # Example config
├── cloudbuild.yaml                # Build + deploy pipeline
└── README.md                     # This file
```
