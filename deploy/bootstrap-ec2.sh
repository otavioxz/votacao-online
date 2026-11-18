#!/bin/bash
# Preparação da EC2: executado AUTOMATICAMENTE pelo user_data do Terraform no primeiro boot.
# Uso: bash deploy/bootstrap-ec2.sh web|admin
# Lê /etc/votacao/infra.conf (gerado pelo Terraform) e os segredos do SSM Parameter Store.
set -euo pipefail

APP="${1:?informe web ou admin}"
# shellcheck disable=SC1091
source /etc/votacao/infra.conf # REGION SSM_PREFIX DB_HOST DB_NAME SMTP_* MAIL_FROM ADMIN_EMAILS LOG_GROUP NODE_VERSION
cd /opt/votacao

# ---------- Node.js LTS fixado (binário oficial) ----------
dnf install -y amazon-cloudwatch-agent logrotate tar gzip
curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz" -o /tmp/node.tgz
mkdir -p /opt/node && tar -xzf /tmp/node.tgz -C /opt/node --strip-components=1 && rm -f /tmp/node.tgz
ln -sf /opt/node/bin/node /usr/bin/node
ln -sf /opt/node/bin/npm /usr/bin/npm
ln -sf /opt/node/bin/npx /usr/bin/npx

# ---------- Usuário sem privilégios e logs ----------
id votacao &>/dev/null || useradd --system --no-create-home --shell /sbin/nologin votacao
mkdir -p /var/log/votacao /etc/votacao
chown votacao:votacao /var/log/votacao

# Certificados da AWS para validar o TLS do RDS
curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /etc/votacao/rds-ca.pem
chmod 644 /etc/votacao/rds-ca.pem

ssm() { aws ssm get-parameter --region "$REGION" --name "$SSM_PREFIX/$1" --with-decryption --query Parameter.Value --output text; }

# ---------- .env (segredos vindos do SSM; arquivo só legível pelo root/systemd) ----------
PORT=3000; [ "$APP" = "admin" ] && PORT=3001
umask 077
cat > /opt/votacao/.env <<EOF
NODE_ENV=production
PORT=$PORT
DATABASE_URL=postgres://votacao_$APP:$(ssm "db_${APP}_password")@$DB_HOST:5432/$DB_NAME
DB_SSL_CA=/etc/votacao/rds-ca.pem
SESSION_SECRET=$(ssm "session_secret_$APP")
SMTP_HOST=$SMTP_HOST
SMTP_PORT=$SMTP_PORT
SMTP_USER=$SMTP_USER
SMTP_PASS="$(ssm smtp_password)"
MAIL_FROM="$MAIL_FROM"
ADMIN_EMAILS=$ADMIN_EMAILS
EOF
umask 022

# ---------- Serviço systemd ----------
cp "deploy/votacao-$APP.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable "votacao-$APP"

cat > /etc/logrotate.d/votacao <<'EOF'
/var/log/votacao/*.log {
  daily
  rotate 7
  compress
  missingok
  notifempty
  copytruncate
}
EOF

# ---------- CloudWatch Agent: envia os logs da aplicação (metric filters/alarmes) ----------
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<EOF
{
  "agent": { "run_as_user": "root" },
  "logs": { "logs_collected": { "files": { "collect_list": [
    { "file_path": "/var/log/votacao/$APP.log", "log_group_name": "$LOG_GROUP", "log_stream_name": "{instance_id}-$APP" },
    { "file_path": "/var/log/user-data.log", "log_group_name": "$LOG_GROUP", "log_stream_name": "{instance_id}-$APP-bootstrap" }
  ] } } }
}
EOF
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json

# ---------- Instala e inicia (novas tentativas enquanto o RDS/migração ficam prontos) ----------
for tentativa in 1 2 3 4 5 6; do
  if bash deploy/atualizar.sh "$APP"; then exit 0; fi
  echo "Tentativa $tentativa falhou; nova tentativa em 30s"
  sleep 30
done
exit 1
