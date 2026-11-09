variable "enable_database_bootstrap" { default = false }
resource "aws_iam_role_policy" "database_bootstrap" {
  count  = var.enable_database_bootstrap ? 1 : 0
  role   = aws_iam_role.execution["migration"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = concat([aws_db_instance.main.master_user_secret[0].secret_arn], [for secret in aws_secretsmanager_secret.application : secret.arn]) }] })
}
resource "aws_ecs_task_definition" "database_bootstrap" {
  count                    = var.enable_database_bootstrap && var.release_tag != "" ? 1 : 0
  family                   = "ecommerce-dev-database-bootstrap"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution["migration"].arn
  task_role_arn            = aws_iam_role.task["migration"].arn
  container_definitions = jsonencode([{
    name        = "migration", image = "${aws_ecr_repository.application["api"].repository_url}:${var.release_tag}", essential = true,
    command     = ["node", "dist/database/bootstrap-aws.js"],
    environment = [for name, value in merge(local.db_env, { DB_USER = "ecommerce_admin" }) : { name = name, value = value }],
    secrets = [
      { name = "DB_PASSWORD", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::" },
      { name = "RUNTIME_DB_PASSWORD", valueFrom = aws_secretsmanager_secret.application["db-password"].arn },
      { name = "MIGRATION_DB_PASSWORD", valueFrom = aws_secretsmanager_secret.application["migration-db-password"].arn },
      { name = "KEYCLOAK_DB_PASSWORD", valueFrom = aws_secretsmanager_secret.application["keycloak-db-password"].arn }
    ],
    logConfiguration = { logDriver = "awslogs", options = { "awslogs-region" = "ap-south-1", "awslogs-group" = aws_cloudwatch_log_group.task["migration"].name, "awslogs-stream-prefix" = "bootstrap" } }
  }])
}
resource "aws_ecs_task_definition" "migration" {
  count                    = var.release_tag == "" ? 0 : 1
  family                   = "ecommerce-dev-migration"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution["migration"].arn
  task_role_arn            = aws_iam_role.task["migration"].arn
  container_definitions = jsonencode([{
    name             = "migration", image = "${aws_ecr_repository.application["api"].repository_url}:${var.release_tag}", essential = true,
    command          = ["node", "dist/database/deploy-aws.js"],
    environment      = [for name, value in merge(local.db_env, { DB_USER = "ecommerce_migration" }) : { name = name, value = value }],
    secrets          = [{ name = "DB_PASSWORD", valueFrom = aws_secretsmanager_secret.application["migration-db-password"].arn }],
    logConfiguration = { logDriver = "awslogs", options = { "awslogs-region" = "ap-south-1", "awslogs-group" = aws_cloudwatch_log_group.task["migration"].name, "awslogs-stream-prefix" = "ecs" } }
  }])
}
