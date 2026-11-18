variable "region" {
  description = "Região AWS. Para o plano de DR, basta trocar a região e rodar terraform apply."
  type        = string
  default     = "us-east-2"
}

variable "project" {
  description = "Prefixo dos nomes dos recursos"
  type        = string
  default     = "votacao"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,15}$", var.project))
    error_message = "Use 3 a 16 caracteres minúsculos, números ou hífen."
  }
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "admin_allowed_cidrs" {
  description = "IPs da instituição que podem acessar /admin (bloqueio feito no WAF). Ex.: [\"200.100.50.10/32\"]"
  type        = list(string)

  validation {
    condition     = length(var.admin_allowed_cidrs) > 0 && alltrue([for c in var.admin_allowed_cidrs : can(cidrhost(c, 0))])
    error_message = "Informe ao menos um CIDR IPv4 válido, ex.: 200.100.50.10/32."
  }
}

variable "admin_emails" {
  description = "E-mails da comissão eleitoral autorizados a entrar no painel admin"
  type        = list(string)
}

variable "alert_email" {
  description = "E-mail que recebe os alarmes do CloudWatch via SNS (precisa confirmar a inscrição)"
  type        = string
}

variable "email_via_ses" {
  description = "Envia os e-mails pelo Amazon SES (email.tf). false = usa o SMTP externo de smtp_host/smtp_user/smtp_password (ex.: no AWS Academy)."
  type        = bool
  default     = true
}

variable "ses_from_email" {
  description = "Remetente verificado no SES. Se vazio, usa o primeiro e-mail de admin_emails."
  type        = string
  default     = ""
}

variable "ses_verified_emails" {
  description = "Outros e-mails verificados no SES. Enquanto a conta estiver no sandbox, só esses (e a comissão) recebem códigos, ex.: eleitores de teste."
  type        = list(string)
  default     = []
}

variable "smtp_host" {
  description = "Só com email_via_ses = false"
  type        = string
  default     = "smtp.gmail.com"
}

variable "smtp_port" {
  description = "Só com email_via_ses = false"
  type        = number
  default     = 587
}

variable "smtp_user" {
  description = "Só com email_via_ses = false. Usuário SMTP (ex.: conta Gmail)"
  type        = string
  default     = ""
}

variable "smtp_password" {
  description = "Só com email_via_ses = false. Senha SMTP (no Gmail, uma 'senha de app'). Vai para o SSM Parameter Store como SecureString."
  type        = string
  default     = ""
  sensitive   = true
}

variable "mail_from" {
  description = "Remetente exibido nos e-mails. Se vazio, \"Votacao Online <remetente>\"."
  type        = string
  default     = ""
}

variable "repo_url" {
  description = "Repositório clonado pelas EC2 (público)"
  type        = string
  default     = "https://github.com/otavioxz/votacao-online.git"
}

variable "git_ref" {
  description = "Branch ou tag clonada no primeiro boot. Atualizações depois são feitas pelo pipeline."
  type        = string
  default     = "main"
}

variable "instance_type" {
  type    = string
  default = "t3.micro"
}

variable "create_instance_role" {
  description = "Cria a role IAM das EC2 com privilégio mínimo. Use false no AWS Academy (que não permite criar IAM)."
  type        = bool
  default     = true
}

variable "instance_profile_name" {
  description = "Instance profile já existente, usado só quando create_instance_role = false (ex.: LabInstanceProfile no AWS Academy)"
  type        = string
  default     = "LabInstanceProfile"
}

variable "node_version" {
  description = "Versão do Node.js (LTS) instalada nas EC2"
  type        = string
  default     = "22.12.0"
}

variable "db_instance_class" {
  type    = string
  default = "db.t3.micro"
}

variable "db_engine_version" {
  type    = string
  default = "16"
}

variable "waf_rate_limit_auth" {
  description = "Máximo de requisições por IP a cada 5 minutos nas rotas de envio/validação de código. Atenção: alunos na rede da instituição compartilham o mesmo IP público."
  type        = number
  default     = 100
}

variable "waf_rate_limit_global" {
  description = "Máximo de requisições por IP a cada 5 minutos no site todo"
  type        = number
  default     = 2000
}

variable "enable_cloudtrail" {
  description = "Cria a trilha do CloudTrail. Se o AWS Academy negar (AccessDenied), coloque false."
  type        = bool
  default     = true
}

variable "log_retention_days" {
  type    = number
  default = 30
}
