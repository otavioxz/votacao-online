output "url_eleitor" {
  description = "Site de votação (certificado autoassinado: aceite o aviso do navegador)"
  value       = "https://${aws_lb.main.dns_name}/"
}

output "url_admin" {
  description = "Painel da comissão (só abre a partir dos IPs em admin_allowed_cidrs)"
  value       = "https://${aws_lb.main.dns_name}/admin"
}

output "web_instance_id" {
  value = aws_instance.app["web"].id
}

output "admin_instance_id" {
  value = aws_instance.app["admin"].id
}

output "rds_endpoint" {
  value = aws_db_instance.main.address
}

output "sns_topic" {
  value = aws_sns_topic.alerts.arn
}

output "proximos_passos" {
  value = <<-EOT
    1) Confirme a inscrição do SNS no e-mail ${var.alert_email}%{if var.email_via_ses} e o link
       "Amazon Web Services – Email Address Verification Request" do SES em: ${join(", ", sort(local.ses_emails))}%{endif}.
    2) Aguarde ~5 min após o apply: as EC2 clonam o repo e se instalam (Target Groups ficam healthy).
       Acompanhe em CloudWatch > Log groups > ${aws_cloudwatch_log_group.app.name} (stream *-bootstrap).
    3) Acesse https://${aws_lb.main.dns_name}/admin e entre com um e-mail da comissão.
    4) O pipeline encontra as EC2 pela tag Project=${var.project} (não precisa configurar IDs).
  EOT
}
