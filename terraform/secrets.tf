# ---------------------------------------------------------------------------
# Segredos gerados pelo Terraform e guardados no SSM Parameter Store (SecureString).
# As EC2 leem no boot (deploy/bootstrap-ec2.sh): nada de senha no código,
# no user_data ou no GitHub. Cada app tem seu próprio usuário de banco.
# ---------------------------------------------------------------------------

locals {
  ssm_prefix     = "/${var.project}"
  random_secrets = ["db_master_password", "db_web_password", "db_admin_password", "session_secret_web", "session_secret_admin"]
}

resource "random_password" "secret" {
  for_each = toset(local.random_secrets)
  length   = startswith(each.key, "db_") ? 32 : 64
  special  = false
}

resource "aws_ssm_parameter" "secret" {
  for_each = toset(concat(local.random_secrets, ["smtp_password"]))
  name     = "${local.ssm_prefix}/${each.key}"
  type     = "SecureString"
  value    = each.key == "smtp_password" ? local.smtp_password : random_password.secret[each.key].result
}
