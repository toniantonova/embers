# ─────────────────────────────────────────────────────────────────────────────
# Network — VPC, Subnet, Firewall Rules
# ─────────────────────────────────────────────────────────────────────────────

locals {
  network_name = var.use_default_network ? "default" : google_compute_network.lumen[0].name
  subnet_name  = var.use_default_network ? "default" : google_compute_subnetwork.lumen[0].name
}

# ── VPC (skipped if using default network) ───────────────────────────────────

resource "google_compute_network" "lumen" {
  count = var.use_default_network ? 0 : 1

  name                    = "lumen-gce-vpc"
  auto_create_subnetworks = false
  project                 = var.project_id

  depends_on = [google_project_service.compute_api]
}

resource "google_compute_subnetwork" "lumen" {
  count = var.use_default_network ? 0 : 1

  name          = "lumen-gce-subnet"
  ip_cidr_range = "10.128.0.0/20"
  region        = var.region
  network       = google_compute_network.lumen[0].id
  project       = var.project_id
}

# ── Firewall: Allow TCP 8080 (API) ──────────────────────────────────────────

resource "google_compute_firewall" "allow_http_8080" {
  name    = "lumen-gce-allow-http-8080"
  network = local.network_name
  project = var.project_id

  allow {
    protocol = "tcp"
    ports    = ["8080"]
  }

  source_ranges = [var.allowed_http_cidr]
  target_tags   = ["lumen-gce-gpu"]

  depends_on = [google_project_service.compute_api]
}

# ── Firewall: Allow SSH via IAP ──────────────────────────────────────────────

resource "google_compute_firewall" "allow_iap_ssh" {
  name    = "lumen-gce-allow-iap-ssh"
  network = local.network_name
  project = var.project_id

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  # IAP's IP range for TCP tunneling
  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["lumen-gce-gpu"]

  depends_on = [google_project_service.compute_api]
}

# ── Firewall: Allow SSH from configurable CIDR (direct access) ───────────────

resource "google_compute_firewall" "allow_direct_ssh" {
  count = var.assign_public_ip ? 1 : 0

  name    = "lumen-gce-allow-direct-ssh"
  network = local.network_name
  project = var.project_id

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = [var.allowed_ssh_cidr]
  target_tags   = ["lumen-gce-gpu"]

  depends_on = [google_project_service.compute_api]
}
