terraform {
  backend "s3" {
    bucket         = "pixicred-prod-tf-state"
    key            = "pixicred/prod/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "pixicred-prod-tf-locks"
  }
}
