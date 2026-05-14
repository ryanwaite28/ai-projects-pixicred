terraform {
  backend "s3" {
    bucket         = "pixicred-dev-tf-state"
    key            = "pixicred/dev/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "pixicred-dev-tf-locks"
  }
}
