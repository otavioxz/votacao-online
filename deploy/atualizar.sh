#!/bin/bash
# Instala dependências, aplica migrações (só no admin) e reinicia o serviço com health check.
# Chamado pelo bootstrap (1º boot) e pelo GitHub Actions via SSM Run Command, depois do
# "git checkout" do commit aprovado.   Uso: bash deploy/atualizar.sh web|admin
set -euo pipefail

APP="${1:?informe web ou admin}"
# shellcheck disable=SC1091
source /etc/votacao/infra.conf
cd "/opt/votacao/$APP"

npm ci --omit=dev --no-audit --no-fund --loglevel=error

if [ "$APP" = "admin" ]; then
  echo "Aplicando db/schema.sql e privilégios (usuário master só neste passo)..."
  ssm() { aws ssm get-parameter --region "$REGION" --name "$SSM_PREFIX/$1" --with-decryption --query Parameter.Value --output text; }
  (
    set -a
    # shellcheck disable=SC1091
    source /opt/votacao/.env
    DB_MASTER_USER="$DB_MASTER_USER"
    DB_MASTER_PASSWORD="$(ssm db_master_password)"
    DB_WEB_PASSWORD="$(ssm db_web_password)"
    DB_ADMIN_PASSWORD="$(ssm db_admin_password)"
    set +a
    node src/migrate.js
  )
fi

systemctl restart "votacao-$APP"

PORT=3000; [ "$APP" = "admin" ] && PORT=3001
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    echo "votacao-$APP no ar ($(git -C /opt/votacao rev-parse --short HEAD))"
    exit 0
  fi
  sleep 2
done
echo "votacao-$APP não respondeu ao health check"
tail -n 40 "/var/log/votacao/$APP.log" || true
exit 1
