terraform {
  backend "s3" {
    bucket              = "ecommerce-tfstate-201943655840-ap-south-1"
    key                 = "bootstrap/terraform.tfstate"
    region              = "ap-south-1"
    profile             = "cloudops"
    encrypt             = true
    use_lockfile        = true
    allowed_account_ids = ["201943655840"]
  }
}
