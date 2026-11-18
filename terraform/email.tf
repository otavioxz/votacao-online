# ---------------------------------------------------------------------------
# E-mail pelo Amazon SES (interface SMTP): o Terraform verifica os endereços,
# cria um usuário IAM que só pode enviar a partir do remetente e gera a senha
# SMTP, que vai para o SSM como os demais segredos. As apps seguem usando SMTP.
# Conta nova fica no "sandbox" do SES: só envia PARA endereços verificados
# (remetente, comissão e ses_verified_emails). Para liberar qualquer destinatário,
# peça "production access" em SES > Account dashboard.
# No AWS Academy (sem SES/IAM), use email_via_ses = false e um SMTP externo.
# ---------------------------------------------------------------------------

locals {
  ses_from   = var.ses_from_email != "" ? var.ses_from_email : var.admin_emails[0]
  ses_emails = var.email_via_ses ? toset(concat([local.ses_from], var.admin_emails, var.ses_verified_emails)) : toset([])

  smtp_host     = var.email_via_ses ? "email-smtp.${var.region}.amazonaws.com" : var.smtp_host
  smtp_port     = var.email_via_ses ? 587 : var.smtp_port
  smtp_user     = var.email_via_ses ? aws_iam_access_key.ses_smtp[0].id : var.smtp_user
  smtp_password = var.email_via_ses ? aws_iam_access_key.ses_smtp[0].ses_smtp_password_v4 : var.smtp_password
  mail_from     = var.mail_from != "" ? var.mail_from : "Votacao Online <${var.email_via_ses ? local.ses_from : var.smtp_user}>"
}

# Cada endereço recebe um e-mail da AWS com o link de verificação
resource "aws_sesv2_email_identity" "email" {
  for_each       = local.ses_emails
  email_identity = each.value
}

resource "aws_iam_user" "ses_smtp" {
  count = var.email_via_ses ? 1 : 0
  name  = "${var.project}-ses-smtp"
}

data "aws_iam_policy_document" "ses_smtp" {
  statement {
    sid     = "EnviarSomenteDoRemetente"
    actions = ["ses:SendRawEmail"]
    # identity/* porque, no sandbox, o SES também confere os destinatários verificados
    resources = ["arn:aws:ses:${var.region}:${data.aws_caller_identity.current.account_id}:identity/*"]
    condition {
      test     = "StringEquals"
      variable = "ses:FromAddress"
      values   = [local.ses_from]
    }
  }
}

resource "aws_iam_user_policy" "ses_smtp" {
  count  = var.email_via_ses ? 1 : 0
  name   = "${var.project}-enviar-email"
  user   = aws_iam_user.ses_smtp[0].name
  policy = data.aws_iam_policy_document.ses_smtp.json
}

resource "aws_iam_access_key" "ses_smtp" {
  count = var.email_via_ses ? 1 : 0
  user  = aws_iam_user.ses_smtp[0].name
}
