# ─────────────────────────────────────────────────────────────────────────────
# IAM — GCE Service Account & Role Bindings
# ─────────────────────────────────────────────────────────────────────────────
# Separate SA from Cloud Run. Same roles — access to cache bucket, model
# weights bucket, secrets, and Artifact Registry.
# ─────────────────────────────────────────────────────────────────────────────

resource "google_service_account" "gce_sa" {
  account_id   = "lumen-gce-sa"
  display_name = "Lumen Pipeline GCE Service Account"
  description  = "SA for the Lumen ML pipeline on Compute Engine (GPU VM)"

  depends_on = [google_project_service.compute_api]
}

# ── Storage: read/write cached shapes ────────────────────────────────────────

resource "google_storage_bucket_iam_member" "gce_cache_admin" {
  bucket = data.google_storage_bucket.shape_cache.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.gce_sa.email}"
}

# ── Storage: read-only access to model weights ───────────────────────────────

resource "google_storage_bucket_iam_member" "gce_weights_viewer" {
  bucket = data.google_storage_bucket.model_weights.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.gce_sa.email}"
}

# ── Artifact Registry: pull container images ─────────────────────────────────

resource "google_artifact_registry_repository_iam_member" "gce_docker_reader" {
  location   = data.google_artifact_registry_repository.docker_repo.location
  repository = data.google_artifact_registry_repository.docker_repo.repository_id
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.gce_sa.email}"
}

# ── Secret Manager: read API key ─────────────────────────────────────────────

resource "google_secret_manager_secret_iam_member" "gce_api_key_accessor" {
  secret_id = data.google_secret_manager_secret.api_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.gce_sa.email}"
}

# ── Secret Manager: read HuggingFace token ───────────────────────────────────

resource "google_secret_manager_secret_iam_member" "gce_hf_token_accessor" {
  secret_id = data.google_secret_manager_secret.hf_token.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.gce_sa.email}"
}

# ── Allow the SA to log to Cloud Logging ─────────────────────────────────────

resource "google_project_iam_member" "gce_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.gce_sa.email}"
}

resource "google_project_iam_member" "gce_metric_writer" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.gce_sa.email}"
}
