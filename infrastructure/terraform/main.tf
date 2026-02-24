# Lumen Server Pipeline — Terraform Configuration
# Provisions GCP infrastructure: Cloud Run, Artifact Registry, Cloud Storage, IAM

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 7.0"
    }
  }

  # ── Remote backend ─────────────────────────────────────────────────────────
  # Stores tfstate in Cloud Storage for durability and CI/CD compatibility.
  # Create the bucket first: gsutil mb -p lumen-pipeline gs://lumen-pipeline-terraform-state
  backend "gcs" {
    bucket = "lumen-pipeline-terraform-state"
    prefix = "terraform/state"
  }
}

# ── Providers ────────────────────────────────────────────────────────────────

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# ── Enable Required APIs ────────────────────────────────────────────────────

resource "google_project_service" "required_apis" {
  for_each = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "storage.googleapis.com",
    "cloudbuild.googleapis.com",
    "iam.googleapis.com",
    "secretmanager.googleapis.com",
  ])

  project            = var.project_id
  service            = each.key
  disable_on_destroy = false
}
