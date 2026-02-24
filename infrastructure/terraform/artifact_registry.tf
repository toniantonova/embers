# ─────────────────────────────────────────────────────────────────────────────
# Artifact Registry — Docker Repository
# ─────────────────────────────────────────────────────────────────────────────

resource "google_artifact_registry_repository" "docker_repo" {
  location      = var.region
  repository_id = "${var.service_name}-docker"
  description   = "Docker images for the Lumen ML pipeline server"
  format        = "DOCKER"

  cleanup_policy_dry_run = false

  # Auto-delete untagged images older than 30 days to save storage
  cleanup_policies {
    id     = "delete-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "2592000s" # 30 days
    }
  }

  depends_on = [google_project_service.required_apis]
}
