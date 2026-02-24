# ─────────────────────────────────────────────────────────────────────────────
# Compute Engine Instance — GPU VM for ML Inference
# ─────────────────────────────────────────────────────────────────────────────
# Runs the exact same container image as Cloud Run, but on a larger GPU
# (L40S 48 GB) so all four models can be eagerly loaded at startup.
# ─────────────────────────────────────────────────────────────────────────────

locals {
  image_uri = var.container_image != "" ? var.container_image : "${var.region}-docker.pkg.dev/${var.project_id}/lumen-pipeline-docker/${var.service_name}:latest"
}

resource "google_compute_instance" "lumen_gpu" {
  name         = var.vm_name
  machine_type = var.machine_type
  zone         = var.zone
  project      = var.project_id

  tags = ["lumen-gce-gpu"]

  labels = {
    env     = "staging"
    service = var.service_name
    infra   = "gce"
  }

  boot_disk {
    initialize_params {
      image = "projects/ubuntu-os-cloud/global/images/family/ubuntu-2204-lts"
      size  = var.disk_size_gb
      type  = "pd-ssd"
    }
  }

  guest_accelerator {
    type  = var.gpu_type
    count = var.gpu_count
  }

  # GPU instances require on_host_maintenance = "TERMINATE"
  scheduling {
    on_host_maintenance = "TERMINATE"
    automatic_restart   = true
  }

  network_interface {
    network    = local.network_name
    subnetwork = var.use_default_network ? null : local.subnet_name

    dynamic "access_config" {
      for_each = var.assign_public_ip ? [1] : []
      content {
        # Ephemeral external IP
      }
    }
  }

  service_account {
    email  = google_service_account.gce_sa.email
    scopes = ["cloud-platform"]
  }

  metadata = {
    startup-script = templatefile("${path.module}/../scripts/startup.sh", {
      image_uri       = local.image_uri
      project_id      = var.project_id
      cache_bucket    = data.google_storage_bucket.shape_cache.name
      weights_bucket  = data.google_storage_bucket.model_weights.name
      allowed_origins = var.allowed_origins
    })
  }

  depends_on = [
    google_project_service.compute_api,
    google_service_account.gce_sa,
  ]

  lifecycle {
    # Don't recreate the VM just because the startup script changed —
    # use deploy.sh to restart the container instead.
    ignore_changes = [metadata["startup-script"]]
  }
}
