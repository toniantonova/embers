# ─────────────────────────────────────────────────────────────────────────────
# GCE Input Variables
# ─────────────────────────────────────────────────────────────────────────────

variable "project_id" {
  description = "GCP project ID"
  type        = string

  validation {
    condition     = length(var.project_id) > 0
    error_message = "project_id must be set."
  }
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-west1"
}

variable "zone" {
  description = "GCP zone for the VM (must have GPU quota)"
  type        = string
  default     = "us-west1-b"
}

variable "vm_name" {
  description = "Name of the Compute Engine instance"
  type        = string
  default     = "lumen-gce-gpu"
}

variable "machine_type" {
  description = "Machine type — g2-standard-8 (L40S, 8 vCPU, 32 GB RAM) or a2-highgpu-1g (A100 40GB)"
  type        = string
  default     = "g2-standard-8"
}

variable "gpu_type" {
  description = "GPU accelerator type — nvidia-l40s or nvidia-tesla-a100"
  type        = string
  default     = "nvidia-l40s"
}

variable "gpu_count" {
  description = "Number of GPUs to attach"
  type        = number
  default     = 1
}

variable "disk_size_gb" {
  description = "Boot disk size in GB (model weights + Docker layers need space)"
  type        = number
  default     = 200
}

variable "assign_public_ip" {
  description = "Assign an external IP for direct access. Set to false for IAP-only access."
  type        = bool
  default     = true
}

variable "allowed_ssh_cidr" {
  description = "CIDR range allowed to SSH (ignored if using IAP only)"
  type        = string
  default     = "0.0.0.0/0"
}

variable "allowed_http_cidr" {
  description = "CIDR range allowed to access port 8080"
  type        = string
  default     = "0.0.0.0/0"
}

variable "use_default_network" {
  description = "Use the default VPC network instead of creating a new one"
  type        = bool
  default     = false
}

variable "container_image" {
  description = "Container image URI. Leave empty to use the standard latest image."
  type        = string
  default     = ""
}

variable "service_name" {
  description = "Service name (used for resource naming consistency)"
  type        = string
  default     = "lumen-pipeline"
}

variable "allowed_origins" {
  description = "Comma-separated CORS origins (e.g. 'https://app.example.com'). Empty = deny all."
  type        = string
  default     = ""
}
