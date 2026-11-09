resource "aws_db_subnet_group" "main" {
  name       = "ecommerce-dev"
  subnet_ids = aws_subnet.data[*].id
}
resource "aws_db_parameter_group" "main" {
  name   = "ecommerce-dev-postgres16"
  family = "postgres16"
  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }
  parameter {
    name         = "max_connections"
    value        = "60"
    apply_method = "pending-reboot"
  }
}
resource "aws_db_instance" "main" {
  identifier                      = "ecommerce-dev"
  engine                          = "postgres"
  engine_version                  = "16.14"
  instance_class                  = "db.t4g.micro"
  allocated_storage               = 20
  max_allocated_storage           = 30
  storage_type                    = "gp3"
  storage_encrypted               = true
  db_name                         = "ecommerce_prod"
  username                        = "ecommerce_admin"
  manage_master_user_password     = true
  db_subnet_group_name            = aws_db_subnet_group.main.name
  vpc_security_group_ids          = [aws_security_group.database.id]
  parameter_group_name            = aws_db_parameter_group.main.name
  publicly_accessible             = false
  multi_az                        = false
  backup_retention_period         = 7
  backup_window                   = "19:00-20:00"
  maintenance_window              = "sun:20:00-sun:21:00"
  deletion_protection             = true
  skip_final_snapshot             = false
  final_snapshot_identifier       = "ecommerce-dev-final"
  auto_minor_version_upgrade      = true
  copy_tags_to_snapshot           = true
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
}
output "database_host" { value = aws_db_instance.main.address }
output "database_admin_secret_arn" { value = aws_db_instance.main.master_user_secret[0].secret_arn }
