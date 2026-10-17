# __generated__ by Terraform
# Please review these resources and move them into your main configuration files.

# __generated__ by Terraform from "projects/ecommerce-platform-510208/locations/asia-south1/jobs/ecommerce-db-migrate"
resource "google_cloud_run_v2_job" "migrations" {
  lifecycle { prevent_destroy = true }
  annotations           = {}
  client                = "gcloud"
  client_version        = "587.0.0"
  deletion_policy       = "DELETE"
  deletion_protection   = true
  labels                = {}
  launch_stage          = "GA"
  location              = var.region
  name                  = "ecommerce-db-migrate"
  project               = var.project_id
  run_execution_token   = null
  start_execution_token = null
  tags                  = null
  template {
    annotations = {}
    labels      = {}
    parallelism = 0
    task_count  = 1
    template {
      encryption_key                = null
      execution_environment         = "EXECUTION_ENVIRONMENT_GEN2"
      gpu_zonal_redundancy_disabled = false
      max_retries                   = 0
      service_account               = "ecommerce-runtime@ecommerce-platform-510208.iam.gserviceaccount.com"
      timeout                       = "600s"
      containers {
        args        = ["dist/database/migrate.js"]
        command     = ["node"]
        depends_on  = []
        image       = "asia-south1-docker.pkg.dev/ecommerce-platform-510208/ecommerce-containers/ecommerce-api@sha256:91d81b237bb81777e4470572837926d3538b85e6473bef281e0e155fc45918b0"
        name        = null
        working_dir = null
        env {
          name  = "DB_HOST"
          value = "10.140.0.3"
        }
        env {
          name  = "DB_NAME"
          value = "ecommerce_prod"
        }
        env {
          name  = "DB_PASSWORD"
          value = null
          value_source {
            secret_key_ref {
              secret  = "ecommerce-db-password"
              version = "1"
            }
          }
        }
        env {
          name  = "DB_PORT"
          value = "5432"
        }
        env {
          name  = "DB_USER"
          value = "ecommerce_app"
        }
        env {
          name  = "NODE_ENV"
          value = "production"
        }
        resources {
          limits = {
            cpu    = "1000m"
            memory = "512Mi"
          }
        }
      }
      vpc_access {
        connector = null
        egress    = "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = "ecommerce-vpc"
          subnetwork = "ecommerce-serverless"
          tags       = []
        }
      }
    }
  }
}

# __generated__ by Terraform from "projects/ecommerce-platform-510208/locations/asia-south1/workerPools/ecommerce-order-notification-worker"
resource "google_cloud_run_v2_worker_pool" "consumer" {
  lifecycle { prevent_destroy = true }
  annotations         = {}
  client              = "gcloud"
  client_version      = "587.0.0"
  deletion_policy     = "DELETE"
  deletion_protection = true
  description         = null
  labels              = {}
  launch_stage        = "GA"
  location            = var.region
  name                = "ecommerce-order-notification-worker"
  project             = var.project_id
  instance_splits {
    percent  = 100
    revision = null
    type     = "INSTANCE_SPLIT_ALLOCATION_TYPE_LATEST"
  }
  scaling {
    manual_instance_count = 1
    max_instance_count    = 0
    min_instance_count    = 0
    scaling_mode          = null
  }
  template {
    annotations                      = {}
    client                           = "gcloud"
    client_version                   = "587.0.0"
    encryption_key                   = null
    encryption_key_revocation_action = null
    encryption_key_shutdown_duration = null
    gpu_zonal_redundancy_disabled    = false
    labels                           = {}
    revision                         = null
    service_account                  = "ecommerce-runtime@ecommerce-platform-510208.iam.gserviceaccount.com"
    containers {
      args        = ["--enable-source-maps", "dist/workers/order-event.worker.js"]
      command     = ["node"]
      depends_on  = []
      image       = "asia-south1-docker.pkg.dev/ecommerce-platform-510208/ecommerce-containers/ecommerce-api@sha256:13abaca554212d628918f2e8a21ac10bab6237f9464f30e2848b96a33ca397c8"
      name        = null
      working_dir = null
      env {
        name  = "BUSINESS_STORAGE"
        value = "postgres"
      }
      env {
        name  = "DB_HOST"
        value = "10.140.0.3"
      }
      env {
        name  = "DB_NAME"
        value = "ecommerce_prod"
      }
      env {
        name  = "DB_PASSWORD"
        value = null
        value_source {
          secret_key_ref {
            secret  = "ecommerce-db-password"
            version = "1"
          }
        }
      }
      env {
        name  = "DB_PORT"
        value = "5432"
      }
      env {
        name  = "DB_USER"
        value = "ecommerce_app"
      }
      env {
        name  = "EVENT_TRANSPORT"
        value = "pubsub"
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = "ecommerce-platform-510208"
      }
      env {
        name  = "GOOGLE_CLOUD_REGION"
        value = "asia-south1"
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "ORDER_DOCUMENT_BUCKET"
        value = "ecommerce-platform-510208-product-assets"
      }
      env {
        name  = "ORDER_STORAGE"
        value = "postgres"
      }
      env {
        name  = "PUBSUB_ORDER_SUBSCRIPTION"
        value = "ecommerce-order-notification-worker"
      }
      env {
        name  = "PUBSUB_ORDER_TOPIC"
        value = "ecommerce-order-events"
      }
      env {
        name  = "SMTP_ENABLED"
        value = "false"
      }
      env {
        name  = "SMTP_SECURE"
        value = "false"
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
    vpc_access {
      connector = null
      egress    = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = "ecommerce-vpc"
        subnetwork = "ecommerce-serverless"
        tags       = []
      }
    }
  }
}

# __generated__ by Terraform from "projects/ecommerce-platform-510208/secrets/ecommerce-keycloak-db-password"
resource "google_secret_manager_secret" "keycloak_db" {
  lifecycle { prevent_destroy = true }
  annotations         = {}
  deletion_policy     = "DELETE"
  deletion_protection = false
  labels              = {}
  project             = var.project_id
  secret_id           = "ecommerce-keycloak-db-password"
  tags                = null
  ttl                 = null
  version_aliases     = {}
  version_destroy_ttl = null
  replication {
    auto {
    }
  }
}

# __generated__ by Terraform from "projects/ecommerce-platform-510208/locations/asia-south1/services/ecommerce-web"
resource "google_cloud_run_v2_service" "web" {
  lifecycle { prevent_destroy = true }
  annotations          = {}
  client               = "gcloud"
  client_version       = "587.0.0"
  custom_audiences     = []
  default_uri_disabled = false
  deletion_policy      = "DELETE"
  deletion_protection  = true
  description          = null
  iap_enabled          = false
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = false
  labels               = {}
  launch_stage         = "GA"
  location             = var.region
  name                 = "ecommerce-web"
  project              = var.project_id
  tags                 = null
  scaling {
    manual_instance_count = 0
    max_instance_count    = 3
    min_instance_count    = 0
    scaling_mode          = null
  }
  template {
    annotations                      = {}
    encryption_key                   = null
    execution_environment            = null
    gpu_zonal_redundancy_disabled    = false
    health_check_disabled            = false
    labels                           = {}
    max_instance_request_concurrency = 80
    revision                         = null
    service_account                  = "ecommerce-runtime@ecommerce-platform-510208.iam.gserviceaccount.com"
    session_affinity                 = false
    timeout                          = "300s"
    containers {
      args             = []
      base_image_uri   = null
      command          = []
      depends_on       = []
      image            = "asia-south1-docker.pkg.dev/ecommerce-platform-510208/ecommerce-containers/ecommerce-web:63fcac8"
      name             = null
      sandbox_launcher = false
      working_dir      = null
      ports {
        container_port = 8080
        name           = "http1"
      }
      resources {
        cpu_idle = true
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        startup_cpu_boost = true
      }
      startup_probe {
        failure_threshold     = 1
        initial_delay_seconds = 0
        period_seconds        = 240
        timeout_seconds       = 240
        tcp_socket {
          port = 8080
        }
      }
    }
  }
  traffic {
    percent  = 100
    revision = null
    tag      = null
    type     = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
  }
}

# __generated__ by Terraform from "projects/ecommerce-platform-510208/secrets/ecommerce-razorpay-key-secret"
resource "google_secret_manager_secret" "razorpay_key_secret" {
  lifecycle { prevent_destroy = true }
  annotations         = {}
  deletion_policy     = "DELETE"
  deletion_protection = false
  labels              = {}
  project             = var.project_id
  secret_id           = "ecommerce-razorpay-key-secret"
  tags                = null
  ttl                 = null
  version_aliases     = {}
  version_destroy_ttl = null
  replication {
    auto {
    }
  }
}

# __generated__ by Terraform from "projects/ecommerce-platform-510208/locations/asia-south1/workerPools/ecommerce-outbox-relay"
resource "google_cloud_run_v2_worker_pool" "relay" {
  lifecycle { prevent_destroy = true }
  annotations         = {}
  client              = "gcloud"
  client_version      = "587.0.0"
  deletion_policy     = "DELETE"
  deletion_protection = true
  description         = null
  labels              = {}
  launch_stage        = "GA"
  location            = var.region
  name                = "ecommerce-outbox-relay"
  project             = var.project_id
  instance_splits {
    percent  = 100
    revision = null
    type     = "INSTANCE_SPLIT_ALLOCATION_TYPE_LATEST"
  }
  scaling {
    manual_instance_count = 1
    max_instance_count    = 0
    min_instance_count    = 0
    scaling_mode          = null
  }
  template {
    annotations                      = {}
    client                           = "gcloud"
    client_version                   = "587.0.0"
    encryption_key                   = null
    encryption_key_revocation_action = null
    encryption_key_shutdown_duration = null
    gpu_zonal_redundancy_disabled    = false
    labels                           = {}
    revision                         = null
    service_account                  = "ecommerce-runtime@ecommerce-platform-510208.iam.gserviceaccount.com"
    containers {
      args        = ["--enable-source-maps", "dist/workers/outbox-relay.worker.js"]
      command     = ["node"]
      depends_on  = []
      image       = "asia-south1-docker.pkg.dev/ecommerce-platform-510208/ecommerce-containers/ecommerce-api@sha256:13abaca554212d628918f2e8a21ac10bab6237f9464f30e2848b96a33ca397c8"
      name        = null
      working_dir = null
      env {
        name  = "BUSINESS_STORAGE"
        value = "postgres"
      }
      env {
        name  = "DB_HOST"
        value = "10.140.0.3"
      }
      env {
        name  = "DB_NAME"
        value = "ecommerce_prod"
      }
      env {
        name  = "DB_PASSWORD"
        value = null
        value_source {
          secret_key_ref {
            secret  = "ecommerce-db-password"
            version = "1"
          }
        }
      }
      env {
        name  = "DB_PORT"
        value = "5432"
      }
      env {
        name  = "DB_USER"
        value = "ecommerce_app"
      }
      env {
        name  = "EVENT_TRANSPORT"
        value = "pubsub"
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = "ecommerce-platform-510208"
      }
      env {
        name  = "GOOGLE_CLOUD_REGION"
        value = "asia-south1"
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "ORDER_DOCUMENT_BUCKET"
        value = "ecommerce-platform-510208-product-assets"
      }
      env {
        name  = "ORDER_STORAGE"
        value = "postgres"
      }
      env {
        name  = "PUBSUB_ORDER_SUBSCRIPTION"
        value = "ecommerce-order-notification-worker"
      }
      env {
        name  = "PUBSUB_ORDER_TOPIC"
        value = "ecommerce-order-events"
      }
      env {
        name  = "SMTP_ENABLED"
        value = "false"
      }
      env {
        name  = "SMTP_SECURE"
        value = "false"
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
    vpc_access {
      connector = null
      egress    = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = "ecommerce-vpc"
        subnetwork = "ecommerce-serverless"
        tags       = []
      }
    }
  }
}

# __generated__ by Terraform from "projects/ecommerce-platform-510208/locations/asia-south1/services/ecommerce-api"
resource "google_cloud_run_v2_service" "api" {
  lifecycle { prevent_destroy = true }
  annotations          = {}
  client               = "gcloud"
  client_version       = "587.0.0"
  custom_audiences     = []
  default_uri_disabled = false
  deletion_policy      = "DELETE"
  deletion_protection  = true
  description          = null
  iap_enabled          = false
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = false
  labels               = {}
  launch_stage         = "GA"
  location             = var.region
  name                 = "ecommerce-api"
  project              = var.project_id
  tags                 = null
  scaling {
    manual_instance_count = 0
    max_instance_count    = 3
    min_instance_count    = 0
    scaling_mode          = null
  }
  template {
    annotations                      = {}
    encryption_key                   = null
    execution_environment            = null
    gpu_zonal_redundancy_disabled    = false
    health_check_disabled            = false
    labels                           = {}
    max_instance_request_concurrency = 20
    revision                         = null
    service_account                  = "ecommerce-runtime@ecommerce-platform-510208.iam.gserviceaccount.com"
    session_affinity                 = false
    timeout                          = "300s"
    containers {
      args             = []
      base_image_uri   = null
      command          = []
      depends_on       = []
      image            = "asia-south1-docker.pkg.dev/ecommerce-platform-510208/ecommerce-containers/ecommerce-api@sha256:91d81b237bb81777e4470572837926d3538b85e6473bef281e0e155fc45918b0"
      name             = null
      sandbox_launcher = false
      working_dir      = null
      env {
        name  = "AUTH_ENABLED"
        value = "true"
      }
      env {
        name  = "BUSINESS_STORAGE"
        value = "postgres"
      }
      env {
        name  = "DB_HOST"
        value = "10.140.0.3"
      }
      env {
        name  = "DB_NAME"
        value = "ecommerce_prod"
      }
      env {
        name  = "DB_PASSWORD"
        value = null
        value_source {
          secret_key_ref {
            secret  = "ecommerce-db-password"
            version = "1"
          }
        }
      }
      env {
        name  = "DB_PORT"
        value = "5432"
      }
      env {
        name  = "DB_USER"
        value = "ecommerce_app"
      }
      env {
        name  = "EVENT_TRANSPORT"
        value = "pubsub"
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = "ecommerce-platform-510208"
      }
      env {
        name  = "GOOGLE_CLOUD_REGION"
        value = "asia-south1"
      }
      env {
        name  = "HOST"
        value = "0.0.0.0"
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "OIDC_ALLOW_HTTP"
        value = "false"
      }
      env {
        name  = "OIDC_AUDIENCE"
        value = "ecommerce-api"
      }
      env {
        name  = "OIDC_DISCOVERY_TIMEOUT_MS"
        value = "60000"
      }
      env {
        name  = "OIDC_ISSUER"
        value = "https://ecommerce-keycloak-eoiwssibea-el.a.run.app/realms/ecommerce"
      }
      env {
        name  = "ORDER_DOCUMENT_BUCKET"
        value = "ecommerce-platform-510208-product-assets"
      }
      env {
        name  = "ORDER_STORAGE"
        value = "postgres"
      }
      env {
        name  = "PAYMENT_PROVIDER"
        value = "razorpay"
      }
      env {
        name  = "PRODUCT_ASSET_BUCKET"
        value = "ecommerce-platform-510208-product-assets"
      }
      env {
        name  = "PRODUCT_ASSET_SIGNER_SERVICE_ACCOUNT"
        value = "ecommerce-runtime@ecommerce-platform-510208.iam.gserviceaccount.com"
      }
      env {
        name  = "PRODUCT_ASSET_URL_TTL_SECONDS"
        value = "300"
      }
      env {
        name  = "PUBSUB_ORDER_SUBSCRIPTION"
        value = "ecommerce-order-notification-worker"
      }
      env {
        name  = "PUBSUB_ORDER_TOPIC"
        value = "ecommerce-order-events"
      }
      env {
        name  = "RAZORPAY_CURRENCY"
        value = "INR"
      }
      env {
        name  = "RAZORPAY_KEY_ID"
        value = null
        value_source {
          secret_key_ref {
            secret  = "ecommerce-razorpay-key-id"
            version = "1"
          }
        }
      }
      env {
        name  = "RAZORPAY_KEY_SECRET"
        value = null
        value_source {
          secret_key_ref {
            secret  = "ecommerce-razorpay-key-secret"
            version = "1"
          }
        }
      }
      env {
        name  = "RAZORPAY_TIMEOUT_MS"
        value = "8000"
      }
      env {
        name  = "RAZORPAY_WEBHOOK_SECRET"
        value = null
        value_source {
          secret_key_ref {
            secret  = "ecommerce-razorpay-webhook-secret"
            version = "1"
          }
        }
      }
      env {
        name  = "REDIS_URL"
        value = "redis://10.140.103.115:6379"
      }
      ports {
        container_port = 8080
        name           = "http1"
      }
      resources {
        cpu_idle = true
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
        startup_cpu_boost = true
      }
      startup_probe {
        failure_threshold     = 24
        initial_delay_seconds = 0
        period_seconds        = 10
        timeout_seconds       = 1
        http_get {
          path = "/health"
          port = 8080
        }
      }
    }
    scaling {
      max_instance_count = 1
      min_instance_count = 0
    }
    vpc_access {
      connector = null
      egress    = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = "ecommerce-vpc"
        subnetwork = "ecommerce-serverless"
        tags       = []
      }
    }
  }
  traffic {
    percent  = 100
    revision = null
    tag      = null
    type     = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
  }
}

# __generated__ by Terraform from "projects/ecommerce-platform-510208/locations/asia-south1/services/ecommerce-keycloak"
resource "google_cloud_run_v2_service" "keycloak" {
  lifecycle { prevent_destroy = true }
  annotations          = {}
  client               = "gcloud"
  client_version       = "587.0.0"
  custom_audiences     = []
  default_uri_disabled = false
  deletion_policy      = "DELETE"
  deletion_protection  = true
  description          = null
  iap_enabled          = false
  ingress              = "INGRESS_TRAFFIC_ALL"
  invoker_iam_disabled = false
  labels               = {}
  launch_stage         = "GA"
  location             = var.region
  name                 = "ecommerce-keycloak"
  project              = var.project_id
  tags                 = null
  scaling {
    manual_instance_count = 0
    max_instance_count    = 1
    min_instance_count    = 0
    scaling_mode          = null
  }
  template {
    annotations                      = {}
    encryption_key                   = null
    execution_environment            = null
    gpu_zonal_redundancy_disabled    = false
    health_check_disabled            = false
    labels                           = {}
    max_instance_request_concurrency = 80
    revision                         = null
    service_account                  = "ecommerce-keycloak@ecommerce-platform-510208.iam.gserviceaccount.com"
    session_affinity                 = false
    timeout                          = "300s"
    containers {
      args             = ["start"]
      base_image_uri   = null
      command          = ["/opt/keycloak/bin/kc.sh"]
      depends_on       = []
      image            = "asia-south1-docker.pkg.dev/ecommerce-platform-510208/ecommerce-containers/keycloak:26.7.4"
      name             = null
      sandbox_launcher = false
      working_dir      = null
      env {
        name  = "KC_BOOTSTRAP_ADMIN_PASSWORD"
        value = null
        value_source {
          secret_key_ref {
            secret  = "ecommerce-keycloak-admin-password"
            version = "latest"
          }
        }
      }
      env {
        name  = "KC_BOOTSTRAP_ADMIN_USERNAME"
        value = "admin"
      }
      env {
        name  = "KC_DB"
        value = "postgres"
      }
      env {
        name  = "KC_DB_PASSWORD"
        value = null
        value_source {
          secret_key_ref {
            secret  = "ecommerce-keycloak-db-password"
            version = "latest"
          }
        }
      }
      env {
        name  = "KC_DB_POOL_MAX_SIZE"
        value = "5"
      }
      env {
        name  = "KC_DB_POOL_MIN_SIZE"
        value = "1"
      }
      env {
        name  = "KC_DB_POOL_INITIAL_SIZE"
        value = "1"
      }
      env {
        name  = "KC_DB_URL"
        value = "jdbc:postgresql://10.140.0.3:5432/keycloak_prod"
      }
      env {
        name  = "KC_DB_USERNAME"
        value = "keycloak_app"
      }
      env {
        name  = "KC_HEALTH_ENABLED"
        value = "true"
      }
      env {
        name  = "KC_HOSTNAME_STRICT"
        value = "false"
      }
      env {
        name  = "KC_HTTP_ENABLED"
        value = "true"
      }
      env {
        name  = "KC_PROXY_HEADERS"
        value = "xforwarded"
      }
      env {
        name  = "KC_SERVER_ASYNC_BOOTSTRAP"
        value = "false"
      }
      ports {
        container_port = 8080
        name           = "http1"
      }
      resources {
        cpu_idle = true
        limits = {
          cpu    = "1"
          memory = "2Gi"
        }
        startup_cpu_boost = true
      }
      startup_probe {
        failure_threshold     = 1
        initial_delay_seconds = 0
        period_seconds        = 240
        timeout_seconds       = 240
        tcp_socket {
          port = 8080
        }
      }
    }
    scaling {
      max_instance_count = 1
      min_instance_count = 0
    }
    vpc_access {
      connector = null
      egress    = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = "ecommerce-vpc"
        subnetwork = "ecommerce-serverless"
        tags       = []
      }
    }
  }
  traffic {
    percent  = 100
    revision = null
    tag      = null
    type     = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
  }
}

# __generated__ by Terraform from "projects/ecommerce-platform-510208/secrets/ecommerce-razorpay-key-id"
resource "google_secret_manager_secret" "razorpay_key_id" {
  lifecycle { prevent_destroy = true }
  annotations         = {}
  deletion_policy     = "DELETE"
  deletion_protection = false
  labels              = {}
  project             = var.project_id
  secret_id           = "ecommerce-razorpay-key-id"
  tags                = null
  ttl                 = null
  version_aliases     = {}
  version_destroy_ttl = null
  replication {
    auto {
    }
  }
}

# __generated__ by Terraform from "projects/ecommerce-platform-510208/secrets/ecommerce-db-password"
resource "google_secret_manager_secret" "db_password" {
  lifecycle { prevent_destroy = true }
  annotations         = {}
  deletion_policy     = "DELETE"
  deletion_protection = false
  labels              = {}
  project             = var.project_id
  secret_id           = "ecommerce-db-password"
  tags                = null
  ttl                 = null
  version_aliases     = {}
  version_destroy_ttl = null
  replication {
    auto {
    }
  }
}

# __generated__ by Terraform from "projects/ecommerce-platform-510208/secrets/ecommerce-razorpay-webhook-secret"
resource "google_secret_manager_secret" "razorpay_webhook" {
  lifecycle { prevent_destroy = true }
  annotations         = {}
  deletion_policy     = "DELETE"
  deletion_protection = false
  labels              = {}
  project             = var.project_id
  secret_id           = "ecommerce-razorpay-webhook-secret"
  tags                = null
  ttl                 = null
  version_aliases     = {}
  version_destroy_ttl = null
  replication {
    auto {
    }
  }
}

# __generated__ by Terraform from "projects/ecommerce-platform-510208/secrets/ecommerce-keycloak-admin-password"
resource "google_secret_manager_secret" "keycloak_password" {
  lifecycle { prevent_destroy = true }
  annotations         = {}
  deletion_policy     = "DELETE"
  deletion_protection = false
  labels              = {}
  project             = var.project_id
  secret_id           = "ecommerce-keycloak-admin-password"
  tags                = null
  ttl                 = null
  version_aliases     = {}
  version_destroy_ttl = null
  replication {
    auto {
    }
  }
}
