# __generated__ by Terraform
# Please review these resources and move them into your main configuration files.

# __generated__ by Terraform from "projects/ecommerce-platform-510208/regions/asia-south1/subnetworks/ecommerce-serverless"
resource "google_compute_subnetwork" "serverless" {
  lifecycle { prevent_destroy = true }
  allow_subnet_cidr_routes_overlap = false
  deletion_policy                  = "DELETE"
  description                      = null
  ip_cidr_range                    = "10.20.0.0/24"
  ip_collection                    = null
  ipv6_access_type                 = null
  name                             = "ecommerce-serverless"
  network                          = "https://www.googleapis.com/compute/v1/projects/ecommerce-platform-510208/global/networks/ecommerce-vpc"
  private_ip_google_access         = false
  private_ipv6_google_access       = "DISABLE_GOOGLE_ACCESS"
  project                          = var.project_id
  purpose                          = "PRIVATE"
  region                           = var.region
  reserved_internal_range          = null
  resolve_subnet_mask              = null
  role                             = null
  send_secondary_ip_range_if_empty = null
  stack_type                       = "IPV4_ONLY"
}

# __generated__ by Terraform
resource "google_sql_database_instance" "postgres" {
  lifecycle { prevent_destroy = true }
  backupdr_backup                                  = null
  database_version                                 = "POSTGRES_16"
  deletion_policy                                  = "DELETE"
  deletion_protection                              = true
  enforce_new_sql_network_architecture             = true
  final_backup_description                         = null
  include_replicas_for_major_version_upgrade       = null
  instance_type                                    = "CLOUD_SQL_INSTANCE"
  maintenance_version                              = "POSTGRES_16_15.R20260712.01_31"
  name                                             = "ecommerce-pg"
  node_count                                       = 0
  project                                          = var.project_id
  region                                           = var.region
  replica_names                                    = []
  root_password                                    = null # sensitive
  root_password_wo                                 = null
  root_password_wo_version                         = null
  switch_transaction_logs_to_cloud_storage_enabled = null
  replication_cluster {
    failover_dr_replica_name = null
  }
  settings {
    activation_policy                = "ALWAYS"
    auto_upgrade_enabled             = false
    availability_type                = "ZONAL"
    collation                        = null
    connector_enforcement            = "NOT_REQUIRED"
    data_disk_provisioned_iops       = 0
    data_disk_provisioned_throughput = 0
    deletion_protection_enabled      = false
    disk_autoresize                  = true
    disk_autoresize_limit            = 0
    disk_size                        = 10
    disk_type                        = "PD_SSD"
    edition                          = "ENTERPRISE"
    enable_dataplex_integration      = true
    enable_google_ml_integration     = false
    pricing_plan                     = "PER_USE"
    replication_lag_max_seconds      = 31536000
    retain_backups_on_delete         = false
    tier                             = var.sql_tier
    time_zone                        = null
    user_labels                      = {}
    backup_configuration {
      binary_log_enabled             = false
      enabled                        = false
      location                       = null
      point_in_time_recovery_enabled = false
      start_time                     = "21:00"
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 7
        retention_unit   = "COUNT"
      }
    }
    data_cache_config {
      data_cache_enabled = false
    }
    ip_configuration {
      allocated_ip_range                            = null
      custom_subject_alternative_names              = []
      enable_private_path_for_google_cloud_services = false
      ipv4_enabled                                  = true
      private_network                               = "projects/ecommerce-platform-510208/global/networks/ecommerce-vpc"
      server_ca_mode                                = "GOOGLE_MANAGED_INTERNAL_CA"
      server_ca_pool                                = null
      ssl_mode                                      = "ALLOW_UNENCRYPTED_AND_ENCRYPTED"
    }
    location_preference {
      follow_gae_application = null
      secondary_zone         = null
      zone                   = "asia-south1-c"
    }

  }
}

# __generated__ by Terraform from "projects/ecommerce-platform-510208/topics/ecommerce-order-events"
resource "google_pubsub_topic" "orders" {
  lifecycle { prevent_destroy = true }
  deletion_policy            = "DELETE"
  kms_key_name               = null
  labels                     = {}
  message_retention_duration = null
  name                       = "ecommerce-order-events"
  project                    = var.project_id
  tags                       = null
}

# __generated__ by Terraform from "projects/ecommerce-platform-510208/global/networks/ecommerce-vpc"
resource "google_compute_network" "platform" {
  lifecycle { prevent_destroy = true }
  auto_create_subnetworks                   = false
  bgp_always_compare_med                    = false
  bgp_best_path_selection_mode              = "LEGACY"
  delete_bgp_always_compare_med             = false
  delete_default_routes_on_create           = false
  deletion_policy                           = "DELETE"
  description                               = null
  enable_ula_internal_ipv6                  = false
  mtu                                       = 0
  name                                      = "ecommerce-vpc"
  network_firewall_policy_enforcement_order = "AFTER_CLASSIC_FIREWALL"
  network_profile                           = null
  project                                   = var.project_id
  routing_mode                              = "REGIONAL"
}

# __generated__ by Terraform from "projects/ecommerce-platform-510208/locations/asia-south1/instances/ecommerce-redis"
resource "google_redis_instance" "cache" {
  lifecycle { prevent_destroy = true }
  auth_enabled            = false
  authorized_network      = "projects/ecommerce-platform-510208/global/networks/ecommerce-vpc"
  connect_mode            = "PRIVATE_SERVICE_ACCESS"
  customer_managed_key    = null
  deletion_policy         = "DELETE"
  deletion_protection     = null
  display_name            = null
  labels                  = {}
  location_id             = "asia-south1-c"
  maintenance_version     = "20260727_01_00"
  memory_size_gb          = var.redis_memory_gb
  name                    = "ecommerce-redis"
  project                 = var.project_id
  read_replicas_mode      = "READ_REPLICAS_DISABLED"
  redis_configs           = {}
  redis_version           = "REDIS_7_2"
  region                  = var.region
  replica_count           = 0
  tier                    = "BASIC"
  transit_encryption_mode = "DISABLED"
  persistence_config {
    persistence_mode    = "DISABLED"
    rdb_snapshot_period = null
  }
}

# __generated__ by Terraform from "ecommerce-platform-510208-product-assets"
resource "google_storage_bucket" "assets" {
  lifecycle { prevent_destroy = true }
  default_event_based_hold    = false
  deletion_policy             = "DELETE"
  enable_object_retention     = false
  force_destroy               = false
  labels                      = {}
  location                    = "ASIA-SOUTH1"
  name                        = "ecommerce-platform-510208-product-assets"
  project                     = var.project_id
  public_access_prevention    = "enforced"
  requester_pays              = false
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  hierarchical_namespace {
    enabled = false
  }
  soft_delete_policy {
    retention_duration_seconds = 604800
  }
}

# __generated__ by Terraform from "projects/ecommerce-platform-510208/locations/asia-south1/repositories/ecommerce-containers"
resource "google_artifact_registry_repository" "containers" {
  lifecycle { prevent_destroy = true }
  cleanup_policy_dry_run = false
  deletion_policy        = "DELETE"
  description            = "Commerce platform container images"
  format                 = "DOCKER"
  kms_key_name           = null
  labels                 = {}
  location               = var.region
  mode                   = "STANDARD_REPOSITORY"
  project                = var.project_id
  repository_id          = "ecommerce-containers"
  vulnerability_scanning_config {
    enablement_config = null
  }
}

# __generated__ by Terraform from "projects/ecommerce-platform-510208/serviceAccounts/ecommerce-runtime@ecommerce-platform-510208.iam.gserviceaccount.com"
resource "google_service_account" "runtime" {
  lifecycle { prevent_destroy = true }
  account_id                   = "ecommerce-runtime"
  create_ignore_already_exists = null
  deletion_policy              = "DELETE"
  description                  = "Runtime identity for ecommerce Cloud Run workloads"
  disabled                     = false
  display_name                 = "Ecommerce Runtime"
  project                      = var.project_id
}

# __generated__ by Terraform from "projects/ecommerce-platform-510208/topics/ecommerce-order-events-dlq"
resource "google_pubsub_topic" "dlq" {
  lifecycle { prevent_destroy = true }
  deletion_policy            = "DELETE"
  kms_key_name               = null
  labels                     = {}
  message_retention_duration = null
  name                       = "ecommerce-order-events-dlq"
  project                    = var.project_id
  tags                       = null
}

# __generated__ by Terraform from "projects/ecommerce-platform-510208/subscriptions/ecommerce-order-notification-worker"
resource "google_pubsub_subscription" "notifications" {
  lifecycle { prevent_destroy = true }
  ack_deadline_seconds         = 30
  deletion_policy              = "DELETE"
  enable_exactly_once_delivery = false
  enable_message_ordering      = false
  filter                       = null
  labels                       = {}
  message_retention_duration   = "604800s"
  name                         = "ecommerce-order-notification-worker"
  project                      = var.project_id
  retain_acked_messages        = false
  tags                         = null
  topic                        = "projects/ecommerce-platform-510208/topics/ecommerce-order-events"
  dead_letter_policy {
    dead_letter_topic     = "projects/ecommerce-platform-510208/topics/ecommerce-order-events-dlq"
    max_delivery_attempts = 5
  }
  expiration_policy {
    ttl = "2678400s"
  }
  retry_policy {
    maximum_backoff = "60s"
    minimum_backoff = "10s"
  }
}

# __generated__ by Terraform from "projects/ecommerce-platform-510208/subscriptions/ecommerce-order-events-dlq-inspect"
resource "google_pubsub_subscription" "dlq_inspect" {
  lifecycle { prevent_destroy = true }
  ack_deadline_seconds         = 30
  deletion_policy              = "DELETE"
  enable_exactly_once_delivery = false
  enable_message_ordering      = false
  filter                       = null
  labels                       = {}
  message_retention_duration   = "604800s"
  name                         = "ecommerce-order-events-dlq-inspect"
  project                      = var.project_id
  retain_acked_messages        = false
  tags                         = null
  topic                        = "projects/ecommerce-platform-510208/topics/ecommerce-order-events-dlq"
  expiration_policy {
    ttl = "2678400s"
  }
}
