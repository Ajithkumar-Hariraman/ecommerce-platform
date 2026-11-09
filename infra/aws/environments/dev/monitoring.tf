locals {
  alarms = {
    rds_cpu         = { namespace = "AWS/RDS", metric = "CPUUtilization", statistic = "Average", threshold = 80, comparison = "GreaterThanThreshold", dimensions = { DBInstanceIdentifier = aws_db_instance.main.identifier } }
    rds_connections = { namespace = "AWS/RDS", metric = "DatabaseConnections", statistic = "Maximum", threshold = 50, comparison = "GreaterThanThreshold", dimensions = { DBInstanceIdentifier = aws_db_instance.main.identifier } }
    rds_storage     = { namespace = "AWS/RDS", metric = "FreeStorageSpace", statistic = "Minimum", threshold = 5368709120, comparison = "LessThanThreshold", dimensions = { DBInstanceIdentifier = aws_db_instance.main.identifier } }
    cache_memory    = { namespace = "AWS/ElastiCache", metric = "DatabaseMemoryUsagePercentage", statistic = "Maximum", threshold = 80, comparison = "GreaterThanThreshold", dimensions = { CacheClusterId = "ecommerce-dev-001", CacheNodeId = "0001" } }
    cache_evictions = { namespace = "AWS/ElastiCache", metric = "Evictions", statistic = "Sum", threshold = 10, comparison = "GreaterThanThreshold", dimensions = { CacheClusterId = "ecommerce-dev-001", CacheNodeId = "0001" } }
    queue_age       = { namespace = "AWS/SQS", metric = "ApproximateAgeOfOldestMessage", statistic = "Maximum", threshold = 300, comparison = "GreaterThanThreshold", dimensions = { QueueName = aws_sqs_queue.notifications.name } }
    dlq             = { namespace = "AWS/SQS", metric = "ApproximateNumberOfMessagesVisible", statistic = "Maximum", threshold = 0, comparison = "GreaterThanThreshold", dimensions = { QueueName = aws_sqs_queue.dead_letter.name } }
    alb_errors      = { namespace = "AWS/ApplicationELB", metric = "HTTPCode_Target_5XX_Count", statistic = "Sum", threshold = 5, comparison = "GreaterThanThreshold", dimensions = { LoadBalancer = aws_lb.main.arn_suffix } }
  }
}
resource "aws_cloudwatch_metric_alarm" "main" {
  for_each            = local.alarms
  alarm_name          = "ecommerce-dev-${each.key}"
  alarm_description   = "Development console alarm; no external notification recipient configured. See docs/aws-deployment.md."
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  statistic           = each.value.statistic
  dimensions          = each.value.dimensions
  period              = 300
  evaluation_periods  = each.key == "dlq" ? 1 : 3
  threshold           = each.value.threshold
  comparison_operator = each.value.comparison
  treat_missing_data  = "notBreaching"
}
resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "ecommerce-dev"
  dashboard_body = jsonencode({ widgets = concat(
    [for index, name in sort(keys(local.alarms)) : {
      type = "metric", x = (index % 3) * 8, y = floor(index / 3) * 6, width = 8, height = 6,
      properties = { title = name, region = "ap-south-1", period = 300, stat = local.alarms[name].statistic,
      metrics = [concat([local.alarms[name].namespace, local.alarms[name].metric], flatten([for k, v in local.alarms[name].dimensions : [k, v]]))] }
    }],
    [{ type = "metric", x = 0, y = 18, width = 12, height = 6, properties = { title = "ALB requests / 4xx / latency", region = "ap-south-1", metrics = [for name in ["RequestCount", "HTTPCode_Target_4XX_Count", "TargetResponseTime"] : ["AWS/ApplicationELB", name, "LoadBalancer", aws_lb.main.arn_suffix]] } },
      { type = "metric", x = 12, y = 18, width = 12, height = 6, properties = { title = "Valkey connections", region = "ap-south-1", metrics = [["AWS/ElastiCache", "CurrConnections", "CacheClusterId", "ecommerce-dev-001", "CacheNodeId", "0001"]] } },
      { type = "metric", x = 0, y = 24, width = 12, height = 6, properties = { title = "Queue depth", region = "ap-south-1", metrics = [["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", aws_sqs_queue.notifications.name]] } },
      { type = "metric", x = 12, y = 24, width = 12, height = 6, properties = { title = "ECS running / desired", region = "ap-south-1", metrics = concat([for name in ["web", "api", "keycloak", "relay", "worker"] : [for metric in ["RunningTaskCount", "DesiredTaskCount"] : ["ECS/ContainerInsights", metric, "ClusterName", aws_ecs_cluster.main.name, "ServiceName", "ecommerce-${name}"]]]...) } }
    ]
  ) })
}
