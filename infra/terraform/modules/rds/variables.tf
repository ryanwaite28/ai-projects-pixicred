variable "env" {
  type        = string
  description = "Environment name (dev or prod)"
}

variable "db_name" {
  type        = string
  description = "Database name"
  default     = "pixicred"
}

variable "db_username" {
  type        = string
  description = "Master DB username (for initial provisioning only — app uses IAM auth)"
  default     = "pixicred_admin"
}

variable "db_password" {
  type        = string
  description = "Master DB password — stored in Secrets Manager; never used by the application"
  sensitive   = true
}

variable "vpc_id" {
  type        = string
  description = "VPC ID for the RDS security group"
}

variable "subnet_ids" {
  type        = list(string)
  description = "Subnet IDs for the DB subnet group (at least two AZs)"
}

variable "allowed_security_group_ids" {
  type        = list(string)
  description = "Security group IDs allowed to connect to RDS (e.g. Lambda SG)"
  default     = []
}

variable "tags" {
  type        = map(string)
  description = "Resource tags"
  default     = {}
}
