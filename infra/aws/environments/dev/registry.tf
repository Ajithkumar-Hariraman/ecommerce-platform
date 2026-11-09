resource "aws_ecr_repository" "application" {
  for_each             = toset(["api", "web", "keycloak"])
  name                 = "ecommerce-${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }
}
resource "aws_ecr_lifecycle_policy" "application" {
  for_each   = aws_ecr_repository.application
  repository = each.value.name
  policy = jsonencode({ rules = [
    { rulePriority = 1, description = "Expire untagged images after 7 days", selection = {
      tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 7
    }, action = { type = "expire" } },
    { rulePriority = 2, description = "Retain 30 tagged releases", selection = {
      tagStatus = "tagged", tagPatternList = ["*"], countType = "imageCountMoreThan", countNumber = 30
    }, action = { type = "expire" } }
  ] })
}
output "repositories" { value = { for k, v in aws_ecr_repository.application : k => v.repository_url } }
