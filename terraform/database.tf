# ---------------------------------------------------------------------------
# RDS PostgreSQL em sub-redes privadas isoladas (2 AZs no DB subnet group),
# sem acesso público, criptografado e forçando TLS nas conexões.
# ---------------------------------------------------------------------------

resource "aws_db_subnet_group" "main" {
  name       = "${var.project}-db-subnets"
  subnet_ids = aws_subnet.db[*].id
  tags       = { Name = "${var.project}-db-subnets" }
}

resource "aws_db_parameter_group" "main" {
  name   = "${var.project}-pg${split(".", var.db_engine_version)[0]}"
  family = "postgres${split(".", var.db_engine_version)[0]}"

  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot" # é assim que a AWS grava; sem isso o plan acusa diferença sempre
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }
}

resource "aws_db_instance" "main" {
  identifier     = "${var.project}-db"
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = "votacao"
  username = "votacao_master"
  password = random_password.secret["db_master_password"].result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name   = aws_db_parameter_group.main.name
  publicly_accessible    = false
  multi_az               = false # Single-AZ (limite do AWS Academy / custo)

  backup_retention_period         = 1
  copy_tags_to_snapshot           = true
  auto_minor_version_upgrade      = true
  enabled_cloudwatch_logs_exports = ["postgresql"]
  apply_immediately               = true

  # Ambiente acadêmico: permite destruir sem snapshot final
  skip_final_snapshot = true
  deletion_protection = false

  tags = { Name = "${var.project}-db" }
}
