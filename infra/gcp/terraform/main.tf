terraform {
  required_version = ">= 1.5"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 7.0" }
  }
}
variable "project_id" { default = "ecommerce-platform-510208" }
variable "region" { default = "asia-south1" }
provider "google" {
  project = var.project_id
  region  = var.region
}
# Imports adopt existing resources. Review a saved plan before any apply.

import {
  to = google_artifact_registry_repository.containers
  id = "projects/ecommerce-platform-510208/locations/asia-south1/repositories/ecommerce-containers"
}

import {
  to = google_compute_network.platform
  id = "projects/ecommerce-platform-510208/global/networks/ecommerce-vpc"
}

import {
  to = google_compute_subnetwork.serverless
  id = "projects/ecommerce-platform-510208/regions/asia-south1/subnetworks/ecommerce-serverless"
}

import {
  to = google_sql_database_instance.postgres
  id = "ecommerce-platform-510208/ecommerce-pg"
}

import {
  to = google_redis_instance.cache
  id = "projects/ecommerce-platform-510208/locations/asia-south1/instances/ecommerce-redis"
}

import {
  to = google_storage_bucket.assets
  id = "ecommerce-platform-510208-product-assets"
}

import {
  to = google_pubsub_topic.orders
  id = "projects/ecommerce-platform-510208/topics/ecommerce-order-events"
}

import {
  to = google_pubsub_topic.dlq
  id = "projects/ecommerce-platform-510208/topics/ecommerce-order-events-dlq"
}

import {
  to = google_pubsub_subscription.notifications
  id = "projects/ecommerce-platform-510208/subscriptions/ecommerce-order-notification-worker"
}

import {
  to = google_pubsub_subscription.dlq_inspect
  id = "projects/ecommerce-platform-510208/subscriptions/ecommerce-order-events-dlq-inspect"
}

import {
  to = google_service_account.runtime
  id = "projects/ecommerce-platform-510208/serviceAccounts/ecommerce-runtime@ecommerce-platform-510208.iam.gserviceaccount.com"
}

import {
  to = google_cloud_run_v2_service.api
  id = "projects/ecommerce-platform-510208/locations/asia-south1/services/ecommerce-api"
}

import {
  to = google_cloud_run_v2_service.web
  id = "projects/ecommerce-platform-510208/locations/asia-south1/services/ecommerce-web"
}

import {
  to = google_cloud_run_v2_service.keycloak
  id = "projects/ecommerce-platform-510208/locations/asia-south1/services/ecommerce-keycloak"
}

import {
  to = google_cloud_run_v2_worker_pool.relay
  id = "projects/ecommerce-platform-510208/locations/asia-south1/workerPools/ecommerce-outbox-relay"
}

import {
  to = google_cloud_run_v2_worker_pool.consumer
  id = "projects/ecommerce-platform-510208/locations/asia-south1/workerPools/ecommerce-order-notification-worker"
}

import {
  to = google_cloud_run_v2_job.migrations
  id = "projects/ecommerce-platform-510208/locations/asia-south1/jobs/ecommerce-db-migrate"
}

import {
  to = google_secret_manager_secret.db_password
  id = "projects/ecommerce-platform-510208/secrets/ecommerce-db-password"
}

import {
  to = google_secret_manager_secret.razorpay_key_id
  id = "projects/ecommerce-platform-510208/secrets/ecommerce-razorpay-key-id"
}

import {
  to = google_secret_manager_secret.razorpay_key_secret
  id = "projects/ecommerce-platform-510208/secrets/ecommerce-razorpay-key-secret"
}

import {
  to = google_secret_manager_secret.razorpay_webhook
  id = "projects/ecommerce-platform-510208/secrets/ecommerce-razorpay-webhook-secret"
}

import {
  to = google_secret_manager_secret.keycloak_password
  id = "projects/ecommerce-platform-510208/secrets/ecommerce-keycloak-admin-password"
}

import {
  to = google_secret_manager_secret.keycloak_db
  id = "projects/ecommerce-platform-510208/secrets/ecommerce-keycloak-db-password"
}

variable "sql_tier" { default = "db-f1-micro" }
variable "redis_memory_gb" { default = 1 }
