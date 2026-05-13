terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

resource "aws_db_subnet_group" "this" {
  name       = "pixicred-${var.env}-db-subnet-group"
  subnet_ids = var.subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "rds" {
  name        = "pixicred-${var.env}-rds-sg"
  description = "RDS security group — allows inbound Postgres from Lambda"
  vpc_id      = var.vpc_id
  tags        = var.tags
}

resource "aws_security_group_rule" "rds_ingress" {
  for_each                 = toset(var.allowed_security_group_ids)
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = each.value
  security_group_id        = aws_security_group.rds.id
}

resource "aws_db_instance" "this" {
  identifier                    = "pixicred-${var.env}-db"
  engine                        = "postgres"
  engine_version                = "15"
  instance_class                = "db.t4g.micro"
  allocated_storage             = 20
  storage_type                  = "gp3"
  db_name                       = var.db_name
  username                      = var.db_username
  password                      = var.db_password
  db_subnet_group_name          = aws_db_subnet_group.this.name
  vpc_security_group_ids        = [aws_security_group.rds.id]
  iam_database_authentication_enabled = true
  backup_retention_period       = 7
  skip_final_snapshot           = var.env == "dev"
  final_snapshot_identifier     = var.env == "prod" ? "pixicred-prod-db-final" : null
  multi_az                      = false
  publicly_accessible           = false
  deletion_protection           = var.env == "prod"
  tags                          = var.tags
}
