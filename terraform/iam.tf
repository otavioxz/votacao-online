# ---------------------------------------------------------------------------
# IAM das EC2 com privilégio mínimo:
#  - SSM (Session Manager e Run Command do deploy, sem SSH)
#  - CloudWatch Agent (envio de logs)
#  - leitura SOMENTE dos parâmetros /<projeto>/* no Parameter Store
# No AWS Academy não é possível criar IAM: use create_instance_role = false
# e o instance profile pré-definido (LabInstanceProfile).
# ---------------------------------------------------------------------------

locals {
  instance_profile = var.create_instance_role ? aws_iam_instance_profile.ec2[0].name : var.instance_profile_name
}

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ec2" {
  count              = var.create_instance_role ? 1 : 0
  name               = "${var.project}-ec2-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "ssm" {
  count      = var.create_instance_role ? 1 : 0
  role       = aws_iam_role.ec2[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "cloudwatch" {
  count      = var.create_instance_role ? 1 : 0
  role       = aws_iam_role.ec2[0].name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

data "aws_iam_policy_document" "ec2_parametros" {
  statement {
    sid       = "LerParametrosDoProjeto"
    actions   = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = ["arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter${local.ssm_prefix}/*"]
  }

  statement {
    sid       = "DescriptografarSecureString"
    actions   = ["kms:Decrypt"]
    resources = ["arn:aws:kms:${var.region}:${data.aws_caller_identity.current.account_id}:key/*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "ec2_parametros" {
  count  = var.create_instance_role ? 1 : 0
  name   = "${var.project}-ler-parametros"
  role   = aws_iam_role.ec2[0].id
  policy = data.aws_iam_policy_document.ec2_parametros.json
}

resource "aws_iam_instance_profile" "ec2" {
  count = var.create_instance_role ? 1 : 0
  name  = "${var.project}-ec2-profile"
  role  = aws_iam_role.ec2[0].name
}
