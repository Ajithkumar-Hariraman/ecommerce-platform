variable "enable_cloudfront" {
  type    = bool
  default = false
}
variable "domain_name" {
  type        = string
  default     = ""
  description = "User-owned base domain; empty keeps public access closed."
  validation {
    condition     = var.domain_name == "" || can(regex("^[a-z0-9][a-z0-9.-]+\\.[a-z]{2,}$", var.domain_name))
    error_message = "Supply a user-owned DNS domain without scheme or path."
  }
}
variable "route53_zone_id" {
  type    = string
  default = ""
}
variable "enable_https" {
  type        = bool
  default     = false
  description = "Enable after ACM DNS validation is ISSUED; never bypass certificate validation."
}
resource "aws_acm_certificate" "application" {
  count                     = var.domain_name != "" ? 1 : 0
  domain_name               = "shop.${var.domain_name}"
  subject_alternative_names = ["api.${var.domain_name}", "auth.${var.domain_name}"]
  validation_method         = "DNS"
  lifecycle { create_before_destroy = true }
}
resource "aws_route53_record" "validation" {
  for_each = var.route53_zone_id == "" || var.domain_name == "" ? {} : {
    for option in aws_acm_certificate.application[0].domain_validation_options : option.domain_name => option
  }
  zone_id = var.route53_zone_id
  name    = each.value.resource_record_name
  type    = each.value.resource_record_type
  records = [each.value.resource_record_value]
  ttl     = 300
}
resource "aws_acm_certificate_validation" "application" {
  count                   = var.enable_https ? 1 : 0
  certificate_arn         = aws_acm_certificate.application[0].arn
  validation_record_fqdns = [for record in aws_route53_record.validation : record.fqdn]
}
resource "aws_lb_listener" "https" {
  count             = var.enable_https ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.application[0].certificate_arn
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Unknown hostname"
      status_code  = "404"
    }
  }
  lifecycle {
    precondition {
      condition     = var.domain_name != ""
      error_message = "HTTPS requires a user-owned domain and validated ACM certificate."
    }
  }
}
resource "aws_lb_listener_rule" "hostname" {
  for_each     = var.enable_https ? local.web_ports : {}
  listener_arn = aws_lb_listener.https[0].arn
  priority     = each.key == "api" ? 10 : each.key == "keycloak" ? 20 : 100
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.task[each.key].arn
  }
  condition {
    host_header { values = ["${each.key == "web" ? "shop" : each.key == "keycloak" ? "auth" : "api"}.${var.domain_name}"] }
  }
}
# Keep /api proxy compatibility for the existing same-origin SPA.
resource "aws_lb_listener_rule" "storefront_api" {
  count        = var.enable_https ? 1 : 0
  listener_arn = aws_lb_listener.https[0].arn
  priority     = 5
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.task["api"].arn
  }
  condition {
    host_header { values = ["shop.${var.domain_name}"] }
  }
  condition {
    path_pattern { values = ["/api/*"] }
  }
}
resource "aws_route53_record" "application" {
  for_each = var.domain_name != "" && var.route53_zone_id != "" ? toset(["shop", "api", "auth"]) : toset([])
  zone_id  = var.route53_zone_id
  name     = "${each.key}.${var.domain_name}"
  type     = "A"
  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}
output "acm_dns_validation" {
  value = var.domain_name == "" ? [] : [for option in aws_acm_certificate.application[0].domain_validation_options : {
    name = option.resource_record_name, type = option.resource_record_type, value = option.resource_record_value
  }]
}
output "public_https_status" {
  value = var.enable_https ? "Configured; live certification required" : "BLOCKED MANUAL ACTION — DOMAIN OR CLOUDFRONT ACCOUNT VERIFICATION REQUIRED"
}
