'use strict';

const nodemailer = require('nodemailer');
const log = require('./log');

let transporter = null;

function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 587);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      requireTLS: port === 587, // SMTP 587 com STARTTLS obrigatório
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      // Fila de envio: o SES no sandbox aceita 1 e-mail por segundo. Com a turma pedindo código
      // ao mesmo tempo, os envios esperam a vez em vez de falhar com "Throttling".
      pool: true,
      maxConnections: 1,
      rateLimit: 1,
      rateDelta: 1100, // um pouco acima de 1 s, de margem
    });
  }
  return transporter;
}

async function enviarCodigo(para, codigo, contexto) {
  const t = getTransport();
  if (!t) {
    log.warn('SMTP_NAO_CONFIGURADO', { para: log.maskEmail(para) });
    // Só em desenvolvimento local, para testar sem servidor de e-mail.
    if (process.env.NODE_ENV !== 'production') console.log(`[DEV] código para ${para}: ${codigo}`);
    return;
  }
  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: para,
    subject: `Seu código de verificação · ${contexto}`,
    text: [
      'Olá!',
      '',
      `Seu código de verificação para "${contexto}" é: ${codigo}`,
      '',
      'Não compartilhe este código. Se você não solicitou, ignore este e-mail.',
    ].join('\n'),
  });
  log.info('EMAIL_ENVIADO', { para: log.maskEmail(para) });
}

module.exports = { enviarCodigo };
