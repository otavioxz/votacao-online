# ---------------------------------------------------------------------------
# Security Groups em cadeia:  Internet -> ALB -> EC2 (3000) -> RDS (5432)
# Nenhuma porta de administração (SSH/22) aberta: acesso às EC2 via SSM.
# ---------------------------------------------------------------------------

locals {
  apps = {
    web   = { port = 3000, subnet_index = 0, health_path = "/health" }
    admin = { port = 3001, subnet_index = 1, health_path = "/admin/health" }
  }
}

resource "aws_security_group" "alb" {
  name        = "${var.project}-alb-sg"
  description = "ALB: HTTP/HTTPS da internet"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${var.project}-alb-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS publico"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP publico (apenas redireciona para HTTPS)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  for_each                     = local.apps
  security_group_id            = aws_security_group.alb.id
  description                  = "ALB para EC2 ${each.key}"
  referenced_security_group_id = aws_security_group.app[each.key].id
  ip_protocol                  = "tcp"
  from_port                    = each.value.port
  to_port                      = each.value.port
}

resource "aws_security_group" "app" {
  for_each    = local.apps
  name        = "${var.project}-${each.key}-sg"
  description = "EC2 ${each.key}: recebe somente do ALB"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${var.project}-${each.key}-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  for_each                     = local.apps
  security_group_id            = aws_security_group.app[each.key].id
  description                  = "Somente o ALB"
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = each.value.port
  to_port                      = each.value.port
}

resource "aws_vpc_security_group_egress_rule" "app_https" {
  for_each          = local.apps
  security_group_id = aws_security_group.app[each.key].id
  description       = "HTTPS de saida via NAT (SSM, S3, CloudWatch, pacotes)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "app_smtp" {
  for_each          = local.apps
  security_group_id = aws_security_group.app[each.key].id
  description       = "SMTP com TLS para envio dos codigos"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = var.smtp_port
  to_port           = var.smtp_port
}

resource "aws_vpc_security_group_egress_rule" "app_to_db" {
  for_each                     = local.apps
  security_group_id            = aws_security_group.app[each.key].id
  description                  = "PostgreSQL no RDS"
  referenced_security_group_id = aws_security_group.db.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_security_group" "db" {
  name        = "${var.project}-db-sg"
  description = "RDS: aceita 5432 somente das EC2 da aplicacao"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${var.project}-db-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "db_from_app" {
  for_each                     = local.apps
  security_group_id            = aws_security_group.db.id
  description                  = "PostgreSQL vindo da EC2 ${each.key}"
  referenced_security_group_id = aws_security_group.app[each.key].id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
