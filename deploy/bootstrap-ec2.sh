#!/bin/bash
# Preparação inicial da EC2 (rodar UMA vez, via SSM Session Manager ou user data).
# Uso: sudo bash bootstrap-ec2.sh web   |   sudo bash bootstrap-ec2.sh admin
set -euo pipefail

APP="${1:?informe web ou admin}"
REPO_URL="https://github.com/otavioxz/votacao-online.git"

dnf install -y git nodejs20 || dnf install -y git nodejs
ln -sf "$(command -v node-20 || command -v node)" /usr/bin/node

id votacao &>/dev/null || useradd --system --no-create-home votacao

if [ ! -d /opt/votacao ]; then
  git clone "$REPO_URL" /opt/votacao
fi
git config --global --add safe.directory /opt/votacao

cd "/opt/votacao/$APP"
npm ci --omit=dev

[ -f /opt/votacao/.env ] || cp /opt/votacao/.env.example /opt/votacao/.env
chmod 600 /opt/votacao/.env
chown votacao /opt/votacao/.env

cp "/opt/votacao/deploy/votacao-$APP.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now "votacao-$APP"
