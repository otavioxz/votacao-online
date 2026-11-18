'use strict';

// Logs estruturados em JSON (uma linha por evento). O CloudWatch Agent envia o arquivo
// de log para o CloudWatch Logs, onde metric filters contam eventos como CODIGO_INVALIDO
// e VOTO_DUPLICADO e disparam alarmes via SNS.

function maskEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return email || null;
  const [user, domain] = email.split('@');
  return `${user.slice(0, 2)}***@${domain}`;
}

function write(nivel, evento, dados = {}) {
  const linha = JSON.stringify({
    ts: new Date().toISOString(),
    nivel,
    app: process.env.APP_ROLE || 'app',
    evento,
    ...dados,
  });
  if (nivel === 'error') console.error(linha);
  else console.log(linha);
}

module.exports = {
  maskEmail,
  info: (evento, dados) => write('info', evento, dados),
  warn: (evento, dados) => write('warn', evento, dados),
  error: (evento, dados) => write('error', evento, dados),
};
