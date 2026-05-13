output "function_arn" {
  value       = aws_lambda_function.this.arn
  description = "Lambda function ARN"
}

output "function_name" {
  value       = aws_lambda_function.this.function_name
  description = "Lambda function name"
}

output "invoke_arn" {
  value       = aws_lambda_function.this.invoke_arn
  description = "Lambda invoke ARN (used by API Gateway)"
}
