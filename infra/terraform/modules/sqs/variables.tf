variable "name" {
  type        = string
  description = "Queue name (without .fifo suffix)"
}

variable "visibility_timeout_seconds" {
  type        = number
  description = "Visibility timeout in seconds"
  default     = 30
}

variable "max_receive_count" {
  type        = number
  description = "Number of times a message is received before moving to DLQ"
  default     = 3
}

variable "tags" {
  type        = map(string)
  description = "Resource tags"
  default     = {}
}
