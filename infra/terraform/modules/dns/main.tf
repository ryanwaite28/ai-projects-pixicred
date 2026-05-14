terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

resource "aws_route53_record" "apex" {
  count   = var.create_apex_records ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = "pixicred.com"
  type    = "A"

  alias {
    name                   = var.cloudfront_domain_name
    zone_id                = var.cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www" {
  count   = var.create_apex_records ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = "www.pixicred.com"
  type    = "A"

  alias {
    name                   = var.cloudfront_domain_name
    zone_id                = var.cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "cloudfront_subdomain" {
  count   = var.cloudfront_subdomain != "" ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = var.cloudfront_subdomain
  type    = "A"

  alias {
    name                   = var.cloudfront_domain_name
    zone_id                = var.cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "api" {
  zone_id = var.hosted_zone_id
  name    = var.api_subdomain
  type    = "A"

  alias {
    name                   = var.api_gateway_domain_name
    zone_id                = var.api_gateway_hosted_zone_id
    evaluate_target_health = true
  }
}
