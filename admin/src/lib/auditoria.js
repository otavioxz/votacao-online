'use strict';

const log = require('./log');

// Grava o evento em audit_log e no log estruturado (que alimenta os alarmes do CloudWatch).
// Os usuários de banco da aplicação não têm UPDATE/DELETE em audit_log.
async function auditar(db, { evento, ator = null, detalhes = {}, ip = null }) {
  await db.query('INSERT INTO audit_log (evento, ator, detalhes, ip) VALUES ($1, $2, $3, $4)', [
    evento,
    ator,
    detalhes,
    ip || null,
  ]);
  log.info(evento, { ator: log.maskEmail(ator), ip, ...detalhes });
}

module.exports = { auditar };
