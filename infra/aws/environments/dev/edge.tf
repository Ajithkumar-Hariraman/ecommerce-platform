resource "random_password" "origin" {
  length  = 40
  special = false
}
resource "aws_lb" "main" {
  name                       = "ecommerce-dev"
  load_balancer_type         = "application"
  internal                   = false
  security_groups            = [aws_security_group.alb.id]
  subnets                    = aws_subnet.public[*].id
  drop_invalid_header_fields = true
}
resource "aws_lb_target_group" "task" {
  for_each             = local.web_ports
  name                 = "ecommerce-dev-${each.key}"
  port                 = each.value
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 30
  health_check {
    path                = each.key == "api" ? "/ready" : each.key == "keycloak" ? "/auth/health/ready" : "/"
    port                = each.key == "keycloak" ? "9000" : "traffic-port"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = var.enable_https ? "redirect" : "fixed-response"
    dynamic "redirect" {
      for_each = var.enable_https ? [1] : []
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
    dynamic "fixed_response" {
      for_each = var.enable_https ? [] : [1]
      content {
        content_type = "text/plain"
        message_body = "Forbidden"
        status_code  = "403"
      }
    }
  }
}
resource "aws_lb_listener_rule" "route" {
  for_each     = var.enable_https ? {} : local.web_ports
  listener_arn = aws_lb_listener.http.arn
  priority     = each.key == "api" ? 10 : each.key == "keycloak" ? 20 : 100
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.task[each.key].arn
  }
  condition {
    http_header {
      http_header_name = "X-Ecommerce-Origin"
      values           = [random_password.origin.result]
    }
  }
  condition {
    path_pattern { values = each.key == "api" ? ["/api/*", "/health", "/ready"] : each.key == "keycloak" ? ["/auth/*"] : ["/*"] }
  }
}
# Optional future edge; application services never depend on its creation.
resource "aws_cloudfront_distribution" "main" {
  count       = var.enable_cloudfront ? 1 : 0
  enabled     = true
  comment     = "ecommerce-dev temporary HTTPS edge"
  price_class = "PriceClass_200"
  origin {
    domain_name = aws_lb.main.dns_name
    origin_id   = "ecommerce-alb"
    custom_header {
      name  = "X-Ecommerce-Origin"
      value = random_password.origin.result
    }
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }
  default_cache_behavior {
    target_origin_id         = "ecommerce-alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    compress                 = true
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate { cloudfront_default_certificate = true }
}
locals {
  public_origin = var.domain_name != "" ? "https://shop.${var.domain_name}" : ""
  api_origin    = var.domain_name != "" ? "https://api.${var.domain_name}" : ""
  auth_origin   = var.domain_name != "" ? "https://auth.${var.domain_name}" : ""
  # Existing AWS-owned ALB name is a closed bootstrap identity, not trusted public HTTPS.
  runtime_origin      = local.public_origin != "" ? local.public_origin : "https://${aws_lb.main.dns_name}"
  runtime_auth_origin = local.auth_origin != "" ? local.auth_origin : local.runtime_origin
}
output "storefront_url" { value = local.public_origin }
output "auth_url" { value = local.auth_origin == "" ? "" : "${local.auth_origin}/auth" }
output "api_url" { value = local.api_origin == "" ? "" : "${local.api_origin}/api/v1" }
