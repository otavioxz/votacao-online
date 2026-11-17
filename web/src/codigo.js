const crypto = require('node:crypto');

// Código de 6 dígitos, único por votação, enviado por e-mail ao eleitor
function gerarCodigo() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

// Só o hash do código é salvo no banco (tabela eleitores_aptos)
function hashCodigo(codigo, salt) {
  return crypto.scryptSync(codigo, salt, 32).toString('hex');
}

function codigoValido(codigo, salt, hashSalvo) {
  const a = Buffer.from(hashCodigo(codigo, salt), 'hex');
  const b = Buffer.from(hashSalvo, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function emailValido(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

module.exports = { gerarCodigo, hashCodigo, codigoValido, emailValido };
