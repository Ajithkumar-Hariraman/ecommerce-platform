resource "aws_sns_topic" "orders" {
  name = "ecommerce-dev-order-events"
}
resource "aws_sqs_queue" "dead_letter" {
  name                      = "ecommerce-dev-order-notification-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}
resource "aws_sqs_queue" "notifications" {
  name                       = "ecommerce-dev-order-notifications"
  receive_wait_time_seconds  = 20
  visibility_timeout_seconds = 60
  message_retention_seconds  = 604800
  sqs_managed_sse_enabled    = true
  redrive_policy             = jsonencode({ deadLetterTargetArn = aws_sqs_queue.dead_letter.arn, maxReceiveCount = 5 })
}
resource "aws_sqs_queue_redrive_allow_policy" "dead_letter" {
  queue_url            = aws_sqs_queue.dead_letter.id
  redrive_allow_policy = jsonencode({ redrivePermission = "byQueue", sourceQueueArns = [aws_sqs_queue.notifications.arn] })
}
resource "aws_sqs_queue_policy" "notifications" {
  queue_url = aws_sqs_queue.notifications.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "TopicOnly", Effect = "Allow", Principal = { Service = "sns.amazonaws.com" }, Action = "sqs:SendMessage",
    Resource = aws_sqs_queue.notifications.arn, Condition = { ArnEquals = { "aws:SourceArn" = aws_sns_topic.orders.arn }, StringEquals = { "aws:SourceAccount" = "201943655840" } } },
    { Sid = "TLSOnly", Effect = "Deny", Principal = "*", Action = "sqs:*", Resource = aws_sqs_queue.notifications.arn,
    Condition = { Bool = { "aws:SecureTransport" = "false" } } }
  ] })
}
resource "aws_sns_topic_subscription" "notifications" {
  topic_arn            = aws_sns_topic.orders.arn
  protocol             = "sqs"
  endpoint             = aws_sqs_queue.notifications.arn
  raw_message_delivery = true
  depends_on           = [aws_sqs_queue_policy.notifications]
}
output "order_topic_arn" { value = aws_sns_topic.orders.arn }
output "notification_queue_url" { value = aws_sqs_queue.notifications.url }
output "notification_dlq_url" { value = aws_sqs_queue.dead_letter.url }
