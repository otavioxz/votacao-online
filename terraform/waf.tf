# ---------------------------------------------------------------------------
# AWS WAF na frente do ALB:
#  0. /admin só a partir dos IPs da instituição
#  1. Rate limit no envio/validação de código (anti força bruta)
#  2. Rate limit geral por IP (anti-flood)
#  10-13. Regras gerenciadas AWS: XSS e comuns, SQL injection, entradas maliciosas, IPs de má reputação
# ---------------------------------------------------------------------------

resource "aws_wafv2_ip_set" "admin" {
  name               = "${var.project}-ips-instituicao"
  description        = "IPs autorizados a acessar /admin"
  scope              = "REGIONAL"
  ip_address_version = "IPV4"
  addresses          = var.admin_allowed_cidrs
}

resource "aws_wafv2_web_acl" "main" {
  name        = "${var.project}-waf"
  description = "Protecao do sistema de votacao"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "admin-somente-ips-instituicao"
    priority = 0
    action {
      block {}
    }
    statement {
      and_statement {
        statement {
          byte_match_statement {
            search_string         = "/admin"
            positional_constraint = "STARTS_WITH"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
          }
        }
        statement {
          not_statement {
            statement {
              ip_set_reference_statement {
                arn = aws_wafv2_ip_set.admin.arn
              }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project}-admin-ip-block"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-limit-codigos"
    priority = 1
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit                 = var.waf_rate_limit_auth
        evaluation_window_sec = 300
        aggregate_key_type    = "IP"
        scope_down_statement {
          byte_match_statement {
            search_string         = "/auth/"
            positional_constraint = "CONTAINS"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "LOWERCASE"
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project}-rate-codigos"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-limit-geral"
    priority = 2
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit                 = var.waf_rate_limit_global
        evaluation_window_sec = 300
        aggregate_key_type    = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project}-rate-geral"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-common-xss"
    priority = 10
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
        # A importação de CSV pode ter corpo > 8 KB: essa regra só conta, não bloqueia.
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project}-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-sqli"
    priority = 11
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesSQLiRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project}-sqli"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 12
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project}-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-ip-reputation"
    priority = 13
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesAmazonIpReputationList"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project}-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project}-waf"
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = aws_lb.main.arn
  web_acl_arn  = aws_wafv2_web_acl.main.arn
}

# Logs do WAF (o nome do log group precisa começar com aws-waf-logs-)
resource "aws_cloudwatch_log_group" "waf" {
  name              = "aws-waf-logs-${var.project}"
  retention_in_days = var.log_retention_days
}

resource "aws_wafv2_web_acl_logging_configuration" "main" {
  resource_arn            = aws_wafv2_web_acl.main.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]
}
