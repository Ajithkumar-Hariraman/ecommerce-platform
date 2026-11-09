data "aws_availability_zones" "available" { state = "available" }
resource "aws_vpc" "main" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = { Name = "ecommerce-dev" }
}
resource "aws_internet_gateway" "main" { vpc_id = aws_vpc.main.id }
resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = false
  tags                    = { Name = "ecommerce-dev-public-${count.index + 1}" }
}
resource "aws_subnet" "data" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index + 10)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags              = { Name = "ecommerce-dev-private-data-${count.index + 1}" }
}
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}
resource "aws_route_table" "data" { vpc_id = aws_vpc.main.id }
resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}
resource "aws_route_table_association" "data" {
  count          = 2
  subnet_id      = aws_subnet.data[count.index].id
  route_table_id = aws_route_table.data.id
}
resource "aws_security_group" "alb" {
  name   = "ecommerce-dev-alb"
  vpc_id = aws_vpc.main.id
}
resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}
resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}
locals {
  workloads = toset(["web", "api", "keycloak", "relay", "worker", "migration"])
  web_ports = { web = 8080, api = 3000, keycloak = 8080 }
}
resource "aws_security_group" "task" {
  for_each = local.workloads
  name     = "ecommerce-dev-${each.key}"
  vpc_id   = aws_vpc.main.id
}
resource "aws_vpc_security_group_ingress_rule" "task" {
  for_each                     = local.web_ports
  security_group_id            = aws_security_group.task[each.key].id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = each.value
  to_port                      = each.value
}
resource "aws_vpc_security_group_egress_rule" "alb" {
  for_each                     = local.web_ports
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.task[each.key].id
  ip_protocol                  = "tcp"
  from_port                    = each.value
  to_port                      = each.value
}
resource "aws_vpc_security_group_egress_rule" "task" {
  for_each          = local.workloads
  security_group_id = aws_security_group.task[each.key].id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
resource "aws_security_group" "database" {
  name   = "ecommerce-dev-database"
  vpc_id = aws_vpc.main.id
}
resource "aws_security_group" "cache" {
  name   = "ecommerce-dev-cache"
  vpc_id = aws_vpc.main.id
}
resource "aws_vpc_security_group_ingress_rule" "database" {
  for_each                     = toset(["api", "keycloak", "relay", "worker", "migration"])
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = aws_security_group.task[each.key].id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
resource "aws_vpc_security_group_ingress_rule" "cache" {
  security_group_id            = aws_security_group.cache.id
  referenced_security_group_id = aws_security_group.task["api"].id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
}
output "vpc_id" { value = aws_vpc.main.id }
output "public_subnets" { value = aws_subnet.public[*].id }
output "private_subnets" { value = aws_subnet.data[*].id }

# Keycloak management health is reachable only by the ALB, never the Internet.
resource "aws_vpc_security_group_ingress_rule" "keycloak_health" {
  security_group_id            = aws_security_group.task["keycloak"].id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 9000
  to_port                      = 9000
}
resource "aws_vpc_security_group_egress_rule" "keycloak_health" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.task["keycloak"].id
  ip_protocol                  = "tcp"
  from_port                    = 9000
  to_port                      = 9000
}
