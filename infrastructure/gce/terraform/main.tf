# ─────────────────────────────────────────────────────────────────────────────
# Lumen Pipeline — GCE GPU VM Infrastructure
# ─────────────────────────────────────────────────────────────────────────────
# Provisions a Compute Engine VM with a larger GPU (L40S 48 GB) for eager
# loading of all four ML models. Completely isolated from the Cloud Run
# deployment — separate state prefix, separate service account.
#
# Shared GCP resources (secrets, buckets, AR) are referenced as data sources
# — this module never creates, modifies, or destroys them.
# ─────────────────────────────────────────────────────────────────────────────

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }

  # Separate state — `terraform destroy` here cannot affect Cloud Run
  backend "gcs" {
    bucket = "lumen-pipeline-terraform-state"
    prefix = "terraform/gce-state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ── Enable Compute API ──────────────────────────────────────────────────────

resource "google_project_service" "compute_api" {
  project            = var.project_id
  service            = "compute.googleapis.com"
  disable_on_destroy = false
}

# ── Data sources — read-only references to shared resources ─────────────────

data "google_secret_manager_secret" "api_key" {
  secret_id = "lumen-api-key"
  project   = var.project_id
}

data "google_secret_manager_secret" "hf_token" {
  secret_id = "lumen-hf-token"
  project   = var.project_id
}

data "google_storage_bucket" "shape_cache" {
  name = "lumen-shape-cache-${var.project_id}"
}

data "google_storage_bucket" "model_weights" {
  name = "lumen-model-weights-${var.project_id}"
}

data "google_artifact_registry_repository" "docker_repo" {
  location      = var.region
  repository_id = "lumen-pipeline-docker"
  project       = var.project_id
}
