locals {
  generated_secrets = toset(["db-password", "migration-db-password", "keycloak-db-password", "keycloak-admin-password"])
}
resource "random_password" "application" {
  for_each = local.generated_secrets
  length   = 40
  special  = false
}
resource "aws_secretsmanager_secret" "application" {
  for_each                = local.generated_secrets
  name                    = "ecommerce/dev/${each.key}"
  recovery_window_in_days = 7
}
resource "aws_secretsmanager_secret_version" "application" {
  for_each      = local.generated_secrets
  secret_id     = aws_secretsmanager_secret.application[each.key].id
  secret_string = random_password.application[each.key].result
}
# Values are supplied out of band; no invented payment credentials.
resource "aws_secretsmanager_secret" "razorpay" {
  for_each                = toset(["razorpay-key-id", "razorpay-key-secret", "razorpay-webhook-secret"])
  name                    = "ecommerce/dev/${each.key}"
  recovery_window_in_days = 7
}
