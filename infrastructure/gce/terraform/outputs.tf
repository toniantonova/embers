# ─────────────────────────────────────────────────────────────────────────────
# Outputs
# ─────────────────────────────────────────────────────────────────────────────

output "instance_name" {
  description = "Name of the GCE GPU instance"
  value       = google_compute_instance.lumen_gpu.name
}

output "instance_zone" {
  description = "Zone of the GCE GPU instance"
  value       = google_compute_instance.lumen_gpu.zone
}

output "external_ip" {
  description = "External IP address (empty if assign_public_ip=false)"
  value       = var.assign_public_ip ? google_compute_instance.lumen_gpu.network_interface[0].access_config[0].nat_ip : "N/A (IAP only)"
}

output "ssh_command" {
  description = "Command to SSH into the VM"
  value       = "gcloud compute ssh ${google_compute_instance.lumen_gpu.name} --zone=${google_compute_instance.lumen_gpu.zone} --project=${var.project_id}"
}

output "health_url" {
  description = "Health check URL (requires SSH tunnel if no public IP)"
  value       = var.assign_public_ip ? "http://${google_compute_instance.lumen_gpu.network_interface[0].access_config[0].nat_ip}:8080/health" : "http://localhost:8080/health (via SSH tunnel)"
}

output "service_account_email" {
  description = "GCE service account email"
  value       = google_service_account.gce_sa.email
}
