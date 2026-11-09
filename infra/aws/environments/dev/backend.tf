terraform {
  required_version = ">= 1.10, < 2.0"
  required_providers {
    random = { source = "hashicorp/random", version = "~> 3.7" }
    aws    = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    bucket              = "ecommerce-tfstate-201943655840-ap-south-1"
    key                 = "dev/terraform.tfstate"
    region              = "ap-south-1"
    profile             = "cloudops"
    encrypt             = true
    use_lockfile        = true
    allowed_account_ids = ["201943655840"]
  }
}
provider "aws" {
  region              = "ap-south-1"
  profile             = "cloudops"
  allowed_account_ids = ["201943655840"]
  default_tags { tags = { Project = "ecommerce", Environment = "dev", ManagedBy = "terraform" } }
}
