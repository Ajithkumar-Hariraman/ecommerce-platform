variable "start_background" { default = false }
resource "aws_ecs_task_definition" "background" {
  for_each                 = var.release_tag == "" ? {} : { for k, v in local.runtime : k => v if contains(["relay", "worker"], k) }
  family                   = "ecommerce-dev-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution[each.key].arn
  task_role_arn            = aws_iam_role.task[each.key].arn
  container_definitions = jsonencode([{
    name             = each.key, image = "${aws_ecr_repository.application["api"].repository_url}:${var.release_tag}", essential = true,
    command          = each.value.command,
    environment      = [for name, value in local.db_env : { name = name, value = value }],
    secrets          = [for name, arn in local.secrets[each.key] : { name = name, valueFrom = arn }],
    stopTimeout      = 30,
    logConfiguration = { logDriver = "awslogs", options = { "awslogs-region" = "ap-south-1", "awslogs-group" = aws_cloudwatch_log_group.task[each.key].name, "awslogs-stream-prefix" = "ecs" } }
  }])
}
resource "aws_ecs_service" "background" {
  for_each                           = aws_ecs_task_definition.background
  name                               = "ecommerce-${each.key}"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = each.value.arn
  desired_count                      = var.start_background ? 1 : 0
  launch_type                        = "FARGATE"
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.task[each.key].id]
    assign_public_ip = true
  }
}
