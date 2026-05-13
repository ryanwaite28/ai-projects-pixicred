terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

resource "aws_apigatewayv2_api" "this" {
  name          = var.name
  protocol_type = "HTTP"
  tags          = var.tags
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true
  tags        = var.tags
}

resource "aws_apigatewayv2_integration" "this" {
  for_each           = var.integrations
  api_id             = aws_apigatewayv2_api.this.id
  integration_type   = "AWS_PROXY"
  integration_uri    = each.value.invoke_arn
  payload_format_version = "2.0"
}

locals {
  routes = flatten([
    for name, cfg in var.integrations : [
      for route in cfg.routes : {
        key            = "${name}:${route.method}:${route.path}"
        integration_id = aws_apigatewayv2_integration.this[name].id
        route_key      = "${route.method} ${route.path}"
        lambda_arn     = cfg.lambda_arn
      }
    ]
  ])
  routes_map = { for r in local.routes : r.key => r }
}

resource "aws_apigatewayv2_route" "this" {
  for_each  = local.routes_map
  api_id    = aws_apigatewayv2_api.this.id
  route_key = each.value.route_key
  target    = "integrations/${each.value.integration_id}"
}

resource "aws_lambda_permission" "this" {
  for_each      = local.routes_map
  statement_id  = "AllowApiGatewayInvoke-${replace(each.key, ":", "-")}"
  action        = "lambda:InvokeFunction"
  function_name = each.value.lambda_arn
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}

resource "aws_apigatewayv2_domain_name" "this" {
  domain_name = var.domain_name
  tags        = var.tags

  domain_name_configuration {
    certificate_arn = var.acm_certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "this" {
  api_id      = aws_apigatewayv2_api.this.id
  domain_name = aws_apigatewayv2_domain_name.this.id
  stage       = aws_apigatewayv2_stage.default.id
}
