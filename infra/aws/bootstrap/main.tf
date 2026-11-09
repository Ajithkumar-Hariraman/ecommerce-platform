terraform {
  required_version = ">= 1.10, < 2.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}
provider "aws" {
  region              = "ap-south-1"
  profile             = "cloudops"
  allowed_account_ids = ["201943655840"]
  default_tags { tags = { Project = "ecommerce", Environment = "dev", ManagedBy = "terraform" } }
}
resource "aws_s3_bucket" "state" {
  bucket = "ecommerce-tfstate-201943655840-ap-south-1"
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Sid       = "DenyInsecureTransport", Effect = "Deny", Principal = "*", Action = "s3:*",
    Resource  = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"],
    Condition = { Bool = { "aws:SecureTransport" = "false" } }
  }] })
}
# Attach only to the infrastructure operator, never runtime or application deploy roles.
data "aws_iam_policy_document" "state_access" {
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.state.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["bootstrap/*", "dev/*"]
    }
  }
  statement {
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.state.arn}/bootstrap/terraform.tfstate", "${aws_s3_bucket.state.arn}/dev/terraform.tfstate"]
  }
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.state.arn}/bootstrap/terraform.tfstate.tflock", "${aws_s3_bucket.state.arn}/dev/terraform.tfstate.tflock"]
  }
}
resource "aws_iam_policy" "state_access" {
  name   = "ecommerce-dev-terraform-state"
  policy = data.aws_iam_policy_document.state_access.json
}
output "state_bucket" { value = aws_s3_bucket.state.id }
