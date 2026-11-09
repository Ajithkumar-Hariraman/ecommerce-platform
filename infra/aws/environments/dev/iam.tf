locals {
  task_trust = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole", Condition = { StringEquals = { "aws:SourceAccount" = "201943655840" }, ArnLike = { "aws:SourceArn" = "arn:aws:ecs:ap-south-1:201943655840:*" } } }] })
}
resource "aws_iam_role" "task" {
  for_each           = local.workloads
  name               = "ecommerce-dev-${each.key}-task"
  assume_role_policy = local.task_trust
}
resource "aws_iam_role" "execution" {
  for_each           = local.workloads
  name               = "ecommerce-dev-${each.key}-execution"
  assume_role_policy = local.task_trust
}
resource "aws_iam_role_policy" "execution" {
  for_each = local.workloads
  role     = aws_iam_role.execution[each.key].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
    { Effect = "Allow", Action = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"], Resource = [for repo in aws_ecr_repository.application : repo.arn] },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.task[each.key].arn}:*" }
  ] })
}
resource "aws_iam_role_policy" "api_storage" {
  role = aws_iam_role.task["api"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:PutObject", "s3:GetObject", "s3:GetObjectVersion"], Resource = ["${aws_s3_bucket.assets["products"].arn}/products/*", "${aws_s3_bucket.assets["documents"].arn}/orders/*"] }
  ] })
}
resource "aws_iam_role_policy" "relay_publish" {
  role = aws_iam_role.task["relay"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["sns:Publish"], Resource = aws_sns_topic.orders.arn }
  ] })
}
resource "aws_iam_role_policy" "worker" {
  role = aws_iam_role.task["worker"].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility", "sqs:GetQueueAttributes"], Resource = aws_sqs_queue.notifications.arn },
    { Effect = "Allow", Action = ["s3:PutObject", "s3:GetObject", "s3:GetObjectVersion"], Resource = "${aws_s3_bucket.assets["documents"].arn}/orders/*" }
  ] })
}
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}
resource "aws_iam_role" "github" {
  name = "ecommerce-dev-github-deploy"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect    = "Allow", Principal = { Federated = aws_iam_openid_connect_provider.github.arn }, Action = "sts:AssumeRoleWithWebIdentity",
    Condition = { StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com", "token.actions.githubusercontent.com:sub" = "repo:Ajithkumar-Hariraman/ecommerce-platform:ref:refs/heads/release/platform-readiness" } }
  }] })
}
resource "aws_iam_role_policy" "github" {
  role = aws_iam_role.github.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["ecr:GetAuthorizationToken", "ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition"], Resource = "*" },
    { Effect = "Allow", Action = ["ecr:BatchCheckLayerAvailability", "ecr:CompleteLayerUpload", "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart", "ecr:BatchGetImage"], Resource = [for repo in aws_ecr_repository.application : repo.arn] },
    { Effect = "Allow", Action = ["ecs:UpdateService", "ecs:DescribeServices"], Resource = "arn:aws:ecs:ap-south-1:201943655840:service/ecommerce-dev/ecommerce-*" },
    { Effect = "Allow", Action = ["ecs:RunTask"], Resource = "arn:aws:ecs:ap-south-1:201943655840:task-definition/ecommerce-dev-migration:*", Condition = { ArnEquals = { "ecs:cluster" = aws_ecs_cluster.main.arn } } },
    { Effect = "Allow", Action = ["ecs:DescribeTasks"], Resource = "arn:aws:ecs:ap-south-1:201943655840:task/ecommerce-dev/*" },
    { Effect = "Allow", Action = ["iam:PassRole"], Resource = concat([for role in aws_iam_role.task : role.arn], [for role in aws_iam_role.execution : role.arn]), Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } } }
  ] })
}
output "github_deploy_role_arn" { value = aws_iam_role.github.arn }
