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
    # Used to zip the billing kill-switch function source for deploy
    # (see billing-killswitch.tf).
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region

  # Required so the billingbudgets API (and other user-project-quota APIs)
  # bill/quota against this project instead of the ADC default project.
  # Without this, google_billing_budget creation fails with a 403
  # "quota project not set" / SERVICE_DISABLED on project 764086051850.
  user_project_override = true
  billing_project       = var.project_id
}

provider "google-beta" {
  project = var.project_id
  region  = var.region

  user_project_override = true
  billing_project       = var.project_id
}
