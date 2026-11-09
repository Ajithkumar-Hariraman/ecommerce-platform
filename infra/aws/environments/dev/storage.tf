variable "storefront_origin" {
  type        = string
  default     = ""
  description = "Exact HTTPS origin; CORS remains disabled until configured."
  validation {
    condition     = var.storefront_origin == "" || can(regex("^https://[A-Za-z0-9.-]+$", var.storefront_origin))
    error_message = "Use an exact HTTPS origin without a path."
  }
}
resource "aws_s3_bucket" "assets" {
  for_each      = toset(["products", "documents"])
  bucket        = "ecommerce-dev-${each.key}-201943655840-ap-south-1"
  force_destroy = false
}
resource "aws_s3_bucket_public_access_block" "assets" {
  for_each                = aws_s3_bucket.assets
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_ownership_controls" "assets" {
  for_each = aws_s3_bucket.assets
  bucket   = each.value.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_versioning" "assets" {
  for_each = aws_s3_bucket.assets
  bucket   = each.value.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  for_each = aws_s3_bucket.assets
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_policy" "assets" {
  for_each = aws_s3_bucket.assets
  bucket   = each.value.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Sid      = "TLSOnly", Effect = "Deny", Principal = "*", Action = "s3:*",
    Resource = [each.value.arn, "${each.value.arn}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }, {
    Sid      = "CreateOnlyWrites", Effect = "Deny", Principal = "*", Action = "s3:PutObject",
    Resource = "${each.value.arn}/*", Condition = { Null = { "s3:if-none-match" = "true" } }
  }] })
}
resource "aws_s3_bucket_cors_configuration" "products" {
  count  = var.storefront_origin != "" || var.domain_name != "" ? 1 : 0
  bucket = aws_s3_bucket.assets["products"].id
  cors_rule {
    allowed_methods = ["PUT", "GET", "HEAD"]
    allowed_origins = [var.storefront_origin == "" ? local.public_origin : var.storefront_origin]
    allowed_headers = ["content-type", "content-length", "if-none-match", "x-amz-*"]
    expose_headers  = ["x-amz-version-id"]
    max_age_seconds = 300
  }
}
output "storage_buckets" { value = { for k, v in aws_s3_bucket.assets : k => v.id } }
