/**
 * Terraform + provider version pins.
 *
 * Provider versions are pinned with a `~>` constraint so minor updates
 * are picked up by `terraform init -upgrade` while major bumps require
 * an intentional change. The committed `.terraform.lock.hcl` records
 * the exact versions resolved by `terraform init` and is the source
 * of truth across machines and CI.
 */

terraform {
  required_version = ">= 1.6.0, < 2.0.0"

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
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}
