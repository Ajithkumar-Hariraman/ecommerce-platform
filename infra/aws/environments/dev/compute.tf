resource "aws_ecs_cluster" "main" {
  name = "ecommerce-dev"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}
resource "aws_cloudwatch_log_group" "task" {
  for_each          = local.workloads
  name              = "/ecommerce/dev/${each.key}"
  retention_in_days = 7
}
output "cluster_name" { value = aws_ecs_cluster.main.name }
