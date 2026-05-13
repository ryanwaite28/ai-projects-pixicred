output "queue_url" {
  value       = aws_sqs_queue.this.url
  description = "Main queue URL"
}

output "queue_arn" {
  value       = aws_sqs_queue.this.arn
  description = "Main queue ARN"
}

output "dlq_url" {
  value       = aws_sqs_queue.dlq.url
  description = "Dead letter queue URL"
}

output "dlq_arn" {
  value       = aws_sqs_queue.dlq.arn
  description = "Dead letter queue ARN"
}
