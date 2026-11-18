# ---------------------------------------------------------------------------
# EC2 Web (eleitor) e EC2 Admin (comissão) em sub-redes privadas, sem IP público,
# sem chave SSH, IMDSv2 obrigatório e disco criptografado.
# Usam a role IAM de iam.tf (ou o LabInstanceProfile, no AWS Academy).
# No 1º boot clonam o repositório e rodam deploy/bootstrap-ec2.sh: recriar a
# instância (DR) devolve o mesmo servidor, sem passo manual.
# ---------------------------------------------------------------------------

data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/${var.project}/app"
  retention_in_days = var.log_retention_days
}

resource "aws_instance" "app" {
  for_each = local.apps

  ami                         = data.aws_ssm_parameter.al2023.value
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.app[each.value.subnet_index].id
  vpc_security_group_ids      = [aws_security_group.app[each.key].id]
  iam_instance_profile        = local.instance_profile
  associate_public_ip_address = false

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    encrypted   = true
    volume_type = "gp3"
  }

  user_data = templatefile("${path.module}/templates/user_data.sh.tftpl", {
    app            = each.key
    region         = var.region
    ssm_prefix     = local.ssm_prefix
    repo_url       = var.repo_url
    git_ref        = var.git_ref
    node_version   = var.node_version
    db_host        = aws_db_instance.main.address
    db_name        = aws_db_instance.main.db_name
    db_master_user = aws_db_instance.main.username
    smtp_host      = local.smtp_host
    smtp_port      = local.smtp_port
    smtp_user      = local.smtp_user
    mail_from      = local.mail_from
    admin_emails   = join(",", var.admin_emails)
    log_group      = aws_cloudwatch_log_group.app.name
  })
  user_data_replace_on_change = true

  # Precisa de NAT (git/pacotes), segredos e banco prontos antes do boot.
  depends_on = [
    aws_route_table_association.app,
    aws_nat_gateway.nat,
    aws_ssm_parameter.secret,
    aws_iam_role_policy.ec2_parametros,
    aws_iam_role_policy_attachment.ssm,
    aws_iam_role_policy_attachment.cloudwatch,
  ]

  lifecycle {
    ignore_changes = [ami]
  }

  tags = {
    Name = "${var.project}-${each.key}"
    Role = each.key
  }
}
