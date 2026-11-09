variable "release_tag" {
  type    = string
  default = ""
  validation {
    condition     = var.release_tag == "" || can(regex("^[a-f0-9]{12,40}(-[a-f0-9]{8,16})?$", var.release_tag))
    error_message = "Use Git SHA, optionally suffixed by a source digest for uncommitted builds."
  }
}
variable "start_services" { default = false }
locals {
  runtime = {
    web       = { cpu = 256, memory = 512, port = 8080, image = "web", command = [] }
    api       = { cpu = 512, memory = 1024, port = 3000, image = "api", command = [] }
    keycloak  = { cpu = 1024, memory = 2048, port = 8080, image = "keycloak", command = [] }
    relay     = { cpu = 256, memory = 512, port = 0, image = "api", command = ["node", "--enable-source-maps", "dist/workers/outbox-relay.worker.js"] }
    worker    = { cpu = 256, memory = 512, port = 0, image = "api", command = ["node", "--enable-source-maps", "dist/workers/order-event.worker.js"] }
    migration = { cpu = 256, memory = 512, port = 0, image = "api", command = ["node", "--enable-source-maps", "dist/database/deploy-aws.js"] }
  }
  db_env = {
    NODE_ENV              = "production", BUSINESS_STORAGE = "postgres",
    DB_HOST               = aws_db_instance.main.address, DB_PORT = "5432", DB_NAME = "ecommerce_prod", DB_USER = "ecommerce_runtime",
    DB_TLS                = "true", DB_TLS_CA_FILE = "/app/certs/rds-ap-south-1-bundle.pem",
    CLOUD_PROVIDER        = "aws", AWS_REGION = "ap-south-1", SMTP_ENABLED = "false",
    EVENT_TRANSPORT       = "sns-sqs", SNS_ORDER_TOPIC_ARN = aws_sns_topic.orders.arn, SQS_ORDER_QUEUE_URL = aws_sqs_queue.notifications.url,
    ORDER_DOCUMENT_BUCKET = aws_s3_bucket.assets["documents"].id
  }
  common_env = {
    NODE_ENV             = "production", HOST = "0.0.0.0", PORT = "3000", BUSINESS_STORAGE = "postgres",
    DB_HOST              = aws_db_instance.main.address, DB_PORT = "5432", DB_NAME = "ecommerce_prod", DB_USER = "ecommerce_runtime",
    DB_TLS               = "true", DB_TLS_CA_FILE = "/app/certs/rds-ap-south-1-bundle.pem",
    CLOUD_PROVIDER       = "aws", AWS_REGION = "ap-south-1", EVENT_TRANSPORT = "sns-sqs",
    SNS_ORDER_TOPIC_ARN  = aws_sns_topic.orders.arn, SQS_ORDER_QUEUE_URL = aws_sqs_queue.notifications.url,
    AUTH_ENABLED         = "true", OIDC_ISSUER = "${local.runtime_auth_origin}/auth/realms/ecommerce", OIDC_AUDIENCE = "ecommerce-api",
    PAYMENT_PROVIDER     = "razorpay", SMTP_ENABLED = "false", DOCS_ENABLED = "false",
    PRODUCT_ASSET_BUCKET = aws_s3_bucket.assets["products"].id, ORDER_DOCUMENT_BUCKET = aws_s3_bucket.assets["documents"].id
  }
  keycloak_env = {
    KC_DB                       = "postgres", KC_DB_URL = "jdbc:postgresql://${aws_db_instance.main.address}:5432/keycloak_prod?sslmode=verify-full&sslrootcert=/opt/keycloak/conf/rds-ca.pem",
    KC_DB_USERNAME              = "ecommerce_keycloak", KC_PROXY_HEADERS = "xforwarded", KC_HTTP_ENABLED = "true",
    KC_HOSTNAME                 = "${local.runtime_auth_origin}/auth", KC_HOSTNAME_STRICT = "true", KC_HTTP_RELATIVE_PATH = "/auth",
    KC_HEALTH_ENABLED           = "true", KC_DB_POOL_INITIAL_SIZE = "1", KC_DB_POOL_MIN_SIZE = "1", KC_DB_POOL_MAX_SIZE = "5",
    KC_BOOTSTRAP_ADMIN_USERNAME = "ecommerce-admin", WEB_ORIGIN = local.runtime_origin
  }
  secrets = {
    web       = {}
    keycloak  = { KC_DB_PASSWORD = aws_secretsmanager_secret.application["keycloak-db-password"].arn, KC_BOOTSTRAP_ADMIN_PASSWORD = aws_secretsmanager_secret.application["keycloak-admin-password"].arn }
    migration = { DB_PASSWORD = aws_secretsmanager_secret.application["migration-db-password"].arn }
    relay     = { DB_PASSWORD = aws_secretsmanager_secret.application["db-password"].arn }
    worker    = { DB_PASSWORD = aws_secretsmanager_secret.application["db-password"].arn }
    api       = merge({ DB_PASSWORD = aws_secretsmanager_secret.application["db-password"].arn, REDIS_URL = aws_secretsmanager_secret.redis_url.arn }, { for name, secret in aws_secretsmanager_secret.razorpay : upper(replace(name, "-", "_")) => secret.arn })
  }
}
resource "aws_secretsmanager_secret" "redis_url" {
  name                    = "ecommerce/dev/redis-url"
  recovery_window_in_days = 7
}
resource "aws_secretsmanager_secret_version" "redis_url" {
  secret_id     = aws_secretsmanager_secret.redis_url.id
  secret_string = "rediss://:${random_password.valkey.result}@${aws_elasticache_replication_group.main.primary_endpoint_address}:6379"
}
resource "aws_iam_role_policy" "execution_secrets" {
  for_each = { for name, secrets in local.secrets : name => secrets if name != "web" }
  role     = aws_iam_role.execution[each.key].id
  policy   = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = values(each.value) }] })
}
resource "aws_ecs_task_definition" "task" {
  for_each                 = var.release_tag == "" ? {} : { for k, v in local.runtime : k => v if contains(["web", "api", "keycloak"], k) }
  family                   = "ecommerce-dev-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.execution[each.key].arn
  task_role_arn            = aws_iam_role.task[each.key].arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([merge({
    name             = each.key, image = "${aws_ecr_repository.application[each.value.image].repository_url}:${var.release_tag}", essential = true,
    environment      = [for name, value in(each.key == "keycloak" ? local.keycloak_env : each.key == "web" ? tomap({}) : each.key == "api" ? local.common_env : merge(local.db_env, each.key == "migration" ? { DB_USER = "ecommerce_migration" } : {})) : { name = name, value = value }],
    secrets          = [for name, arn in local.secrets[each.key] : { name = name, valueFrom = arn }],
    portMappings     = each.value.port == 0 ? [] : [{ containerPort = each.value.port, protocol = "tcp" }],
    logConfiguration = { logDriver = "awslogs", options = { "awslogs-region" = "ap-south-1", "awslogs-group" = aws_cloudwatch_log_group.task[each.key].name, "awslogs-stream-prefix" = "ecs" } },
    stopTimeout      = 30
  }, length(each.value.command) == 0 ? {} : { command = each.value.command })])
}
resource "aws_ecs_service" "task" {
  for_each                           = var.release_tag == "" ? {} : { for k, v in local.runtime : k => v if contains(["web", "api", "keycloak"], k) }
  name                               = "ecommerce-${each.key}"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.task[each.key].arn
  desired_count                      = var.start_services ? 1 : 0
  launch_type                        = "FARGATE"
  enable_execute_command             = false
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = contains(keys(local.web_ports), each.key) ? 180 : null
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.task[each.key].id]
    assign_public_ip = true
  }
  dynamic "load_balancer" {
    for_each = contains(keys(local.web_ports), each.key) ? [1] : []
    content {
      target_group_arn = aws_lb_target_group.task[each.key].arn
      container_name   = each.key
      container_port   = each.value.port
    }
  }
  depends_on = [aws_lb_listener_rule.route]
}
