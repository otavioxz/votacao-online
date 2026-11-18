# ---------------------------------------------------------------------------
# Monitoramento e auditoria:
#  - Metric filters nos logs da aplicação (códigos inválidos, voto duplicado, fora do período)
#  - Alarmes CloudWatch -> SNS -> e-mail
#  - CloudTrail registrando as ações na conta AWS em um bucket S3
# ---------------------------------------------------------------------------

resource "aws_sns_topic" "alerts" {
  name = "${var.project}-alertas"
}

# Quem pode publicar no tópico: os alarmes do CloudWatch e os eventos de bounce/reclamação do SES
data "aws_iam_policy_document" "alerts" {
  statement {
    sid       = "AlarmesCloudWatch"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }

  statement {
    sid       = "EventosSES"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]
    principals {
      type        = "Service"
      identifiers = ["ses.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "alerts" {
  arn    = aws_sns_topic.alerts.arn
  policy = data.aws_iam_policy_document.alerts.json
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

locals {
  metric_ns = "Votacao/Seguranca"
  app_metrics = {
    CodigosInvalidos   = { evento = "CODIGO_INVALIDO", limite = 10, descricao = "Muitos códigos inválidos (possível força bruta)" }
    VotosDuplicados    = { evento = "VOTO_DUPLICADO", limite = 3, descricao = "Tentativas de voto duplicado" }
    VotosForaDoPeriodo = { evento = "VOTO_FORA_PERIODO", limite = 3, descricao = "Tentativas de voto fora do período" }
    LoginAdminFalhou   = { evento = "ADMIN_LOGIN_FALHOU", limite = 5, descricao = "Falhas de login no painel da comissão" }
    CodigosBloqueados  = { evento = "CODIGO_BLOQUEADO", limite = 1, descricao = "Eleitor bloqueado por excesso de tentativas" }
  }
}

resource "aws_cloudwatch_log_metric_filter" "app" {
  for_each       = local.app_metrics
  name           = "${var.project}-${each.key}"
  log_group_name = aws_cloudwatch_log_group.app.name
  pattern        = "{ $.evento = \"${each.value.evento}\" }"

  metric_transformation {
    name      = each.key
    namespace = local.metric_ns
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "app" {
  for_each            = local.app_metrics
  alarm_name          = "${var.project}-${each.key}"
  alarm_description   = each.value.descricao
  namespace           = local.metric_ns
  metric_name         = each.key
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = each.value.limite
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  depends_on          = [aws_cloudwatch_log_metric_filter.app]
}

resource "aws_cloudwatch_metric_alarm" "waf_blocked" {
  alarm_name          = "${var.project}-waf-muitos-bloqueios"
  alarm_description   = "Muitas requisições bloqueadas pelo WAF (possível ataque)"
  namespace           = "AWS/WAFV2"
  metric_name         = "BlockedRequests"
  dimensions          = { WebACL = aws_wafv2_web_acl.main.name, Region = var.region, Rule = "ALL" }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 50
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "unhealthy" {
  for_each            = local.apps
  alarm_name          = "${var.project}-${each.key}-indisponivel"
  alarm_description   = "EC2 ${each.key} falhando no health check do ALB"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  dimensions          = { TargetGroup = aws_lb_target_group.app[each.key].arn_suffix, LoadBalancer = aws_lb.main.arn_suffix }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

data "aws_caller_identity" "current" {}

# ---------------- CloudTrail ----------------
resource "aws_s3_bucket" "trail" {
  count         = var.enable_cloudtrail ? 1 : 0
  bucket        = "${var.project}-cloudtrail-${data.aws_caller_identity.current.account_id}-${var.region}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "trail" {
  count                   = var.enable_cloudtrail ? 1 : 0
  bucket                  = aws_s3_bucket.trail[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "trail" {
  count  = var.enable_cloudtrail ? 1 : 0
  bucket = aws_s3_bucket.trail[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

data "aws_iam_policy_document" "trail" {
  count = var.enable_cloudtrail ? 1 : 0

  statement {
    sid       = "AWSCloudTrailAclCheck"
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.trail[0].arn]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
  }

  statement {
    sid       = "AWSCloudTrailWrite"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.trail[0].arn}/AWSLogs/${data.aws_caller_identity.current.account_id}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
  }
}

resource "aws_s3_bucket_policy" "trail" {
  count  = var.enable_cloudtrail ? 1 : 0
  bucket = aws_s3_bucket.trail[0].id
  policy = data.aws_iam_policy_document.trail[0].json
}

resource "aws_cloudtrail" "main" {
  count                         = var.enable_cloudtrail ? 1 : 0
  name                          = "${var.project}-trilha"
  s3_bucket_name                = aws_s3_bucket.trail[0].id
  include_global_service_events = true
  is_multi_region_trail         = false
  enable_log_file_validation    = true
  depends_on                    = [aws_s3_bucket_policy.trail]
}
