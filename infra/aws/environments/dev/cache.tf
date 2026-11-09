resource "random_password" "valkey" {
  length  = 40
  special = false
}
resource "aws_secretsmanager_secret" "valkey" {
  name                    = "ecommerce/dev/valkey-password"
  recovery_window_in_days = 7
}
resource "aws_secretsmanager_secret_version" "valkey" {
  secret_id     = aws_secretsmanager_secret.valkey.id
  secret_string = random_password.valkey.result
}
resource "aws_elasticache_subnet_group" "main" {
  name       = "ecommerce-dev"
  subnet_ids = aws_subnet.data[*].id
}
resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = "ecommerce-dev"
  description                = "Private development Valkey; TLS and authentication required"
  engine                     = "valkey"
  engine_version             = "8.2"
  node_type                  = "cache.t4g.micro"
  num_cache_clusters         = 1
  automatic_failover_enabled = false
  multi_az_enabled           = false
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.cache.id]
  port                       = 6379
  transit_encryption_enabled = true
  transit_encryption_mode    = "required"
  at_rest_encryption_enabled = true
  auth_token                 = random_password.valkey.result
  auth_token_update_strategy = "SET"
  snapshot_retention_limit   = 1
  maintenance_window         = "sun:21:00-sun:22:00"
}
output "cache_host" { value = aws_elasticache_replication_group.main.primary_endpoint_address }
