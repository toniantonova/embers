# ─────────────────────────────────────────────────────────────────────────────
# IAM — Service Accounts & Role Bindings
# ─────────────────────────────────────────────────────────────────────────────

# ── Cloud Run Service Account ────────────────────────────────────────────────

resource "google_service_account" "cloud_run_sa" {
  account_id   = "${var.service_name}-sa"
  display_name = "Lumen Pipeline Cloud Run Service Account"
  description  = "Least-privilege SA for the Lumen ML pipeline on Cloud Run"

  depends_on = [google_project_service.required_apis]
}

# ── Storage: read/write cached shapes ────────────────────────────────────────

resource "google_storage_bucket_iam_member" "cache_bucket_admin" {
  bucket = google_storage_bucket.shape_cache.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

# ── Storage: read-only access to pre-downloaded model weights ──────────────

resource "google_storage_bucket_iam_member" "model_weights_viewer" {
  bucket = google_storage_bucket.model_weights.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

# ── Artifact Registry: pull container images ─────────────────────────────────

resource "google_artifact_registry_repository_iam_member" "docker_reader" {
  location   = google_artifact_registry_repository.docker_repo.location
  repository = google_artifact_registry_repository.docker_repo.repository_id
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

# ── Secret Manager: read API key at container startup ────────────────────────

resource "google_secret_manager_secret_iam_member" "api_key_accessor" {
  secret_id = google_secret_manager_secret.api_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}

# ── Secret Manager: read HuggingFace token at container startup ──────────

resource "google_secret_manager_secret_iam_member" "hf_token_accessor" {
  secret_id = google_secret_manager_secret.hf_token.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run_sa.email}"
}
