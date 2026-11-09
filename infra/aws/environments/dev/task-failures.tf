resource "aws_cloudwatch_log_group" "task_events" {
  name              = "/ecommerce/dev/task-events"
  retention_in_days = 7
}
resource "aws_cloudwatch_event_rule" "task_failures" {
  name          = "ecommerce-dev-stopped-tasks"
  description   = "Capture stopped tasks in the dedicated ecommerce cluster"
  event_pattern = jsonencode({ source = ["aws.ecs"], "detail-type" = ["ECS Task State Change"], detail = { clusterArn = [aws_ecs_cluster.main.arn], lastStatus = ["STOPPED"] } })
}
resource "aws_cloudwatch_log_resource_policy" "task_events" {
  policy_name     = "ecommerce-dev-task-events"
  policy_document = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = ["events.amazonaws.com", "delivery.logs.amazonaws.com"] }, Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.task_events.arn}:*", Condition = { ArnEquals = { "aws:SourceArn" = aws_cloudwatch_event_rule.task_failures.arn } } }] })
}
resource "aws_cloudwatch_event_target" "task_events" {
  rule       = aws_cloudwatch_event_rule.task_failures.name
  arn        = aws_cloudwatch_log_group.task_events.arn
  depends_on = [aws_cloudwatch_log_resource_policy.task_events]
}
resource "aws_cloudwatch_log_metric_filter" "task_failures" {
  name           = "ecommerce-dev-nonzero-task-exit"
  log_group_name = aws_cloudwatch_log_group.task_events.name
  pattern        = "{ ($.detail.stopCode = \"EssentialContainerExited\") && ($.detail.containers[0].exitCode > 0) }"
  metric_transformation {
    name          = "FailedTaskExits"
    namespace     = "Ecommerce/Dev"
    value         = "1"
    default_value = 0
  }
}
resource "aws_cloudwatch_metric_alarm" "task_failures" {
  alarm_name          = "ecommerce-dev-task-failures"
  alarm_description   = "Nonzero essential-container exits; normal zero-exit migrations/deployments excluded. Console only."
  namespace           = "Ecommerce/Dev"
  metric_name         = "FailedTaskExits"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}
