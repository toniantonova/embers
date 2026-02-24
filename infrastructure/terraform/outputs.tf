# ─────────────────────────────────────────────────────────────────────────────
# Outputs — displayed after `terraform apply`
# ─────────────────────────────────────────────────────────────────────────────
# Note: Cloud Run URL is no longer a Terraform output. Retrieve it via:
#   gcloud run services describe lumen-pipeline --region=us-central1 --format='value(status.url)'
# ─────────────────────────────────────────────────────────────────────────────

output "artifact_registry_url" {
  description = "Docker repository URL for pushing images"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker_repo.repository_id}"
}

output "cache_bucket_name" {
  description = "Cloud Storage bucket for cached point clouds"
  value       = google_storage_bucket.shape_cache.name
}

output "service_account_email" {
  description = "Service account used by Cloud Run"
  value       = google_service_account.cloud_run_sa.email
}

output "full_image_uri" {
  description = "Full container image URI template for building & pushing"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker_repo.repository_id}/${var.service_name}:latest"
}
