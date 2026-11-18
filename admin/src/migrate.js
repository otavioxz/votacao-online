'use strict';

// Aplica db/schema.sql (idempotente) e cria os dois usuários de banco com privilégio mínimo:
//   votacao_web   -> só o que o app do eleitor usa (sem acesso a admin_codigos, sem DELETE)
//   votacao_admin -> só o que a comissão usa (não pode inserir/alterar votos)
// Roda na EC2 Admin a cada deploy, com o usuário master lido do SSM apenas neste momento.

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { sslOptions } = require('./lib/db');

const GRANTS = {
  votacao_web: [
    'GRANT SELECT ON votacoes, candidatos TO votacao_web',
    'GRANT SELECT, UPDATE ON eleitores_aptos TO votacao_web',
    'GRANT SELECT, INSERT ON votos TO votacao_web',
    'GRANT INSERT ON audit_log TO votacao_web',
    'GRANT USAGE ON SEQUENCE audit_log_id_seq TO votacao_web',
  ],
  votacao_admin: [
    'GRANT SELECT, INSERT ON votacoes, eleitores_aptos TO votacao_admin',
    'GRANT SELECT, INSERT, DELETE ON candidatos TO votacao_admin',
    'GRANT SELECT, INSERT, UPDATE, DELETE ON admin_codigos TO votacao_admin',
    'GRANT SELECT ON votos TO votacao_admin',
    'GRANT SELECT, INSERT ON audit_log TO votacao_admin',
    'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO votacao_admin',
  ],
};

async function main() {
  const { DATABASE_URL, DB_MASTER_USER, DB_MASTER_PASSWORD, DB_WEB_PASSWORD, DB_ADMIN_PASSWORD } = process.env;
  if (!DATABASE_URL || !DB_MASTER_USER || !DB_MASTER_PASSWORD || !DB_WEB_PASSWORD || !DB_ADMIN_PASSWORD) {
    throw new Error('Defina DATABASE_URL, DB_MASTER_USER, DB_MASTER_PASSWORD, DB_WEB_PASSWORD e DB_ADMIN_PASSWORD');
  }
  const url = new URL(DATABASE_URL);
  const client = new Client({
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.slice(1),
    user: DB_MASTER_USER,
    password: DB_MASTER_PASSWORD,
    ssl: sslOptions(),
  });
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8'));

    const senhas = { votacao_web: DB_WEB_PASSWORD, votacao_admin: DB_ADMIN_PASSWORD };
    const banco = client.escapeIdentifier(url.pathname.slice(1));
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');

    for (const [usuario, senha] of Object.entries(senhas)) {
      const u = client.escapeIdentifier(usuario);
      const pw = client.escapeLiteral(senha);
      const existe = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [usuario]);
      await client.query(`${existe.rowCount ? 'ALTER' : 'CREATE'} ROLE ${u} WITH LOGIN PASSWORD ${pw}`);
      // Zera tudo e concede apenas o necessário
      await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${u}`);
      await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${u}`);
      await client.query(`GRANT CONNECT ON DATABASE ${banco} TO ${u}`);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${u}`);
      for (const grant of GRANTS[usuario]) await client.query(grant);
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({ ts: new Date().toISOString(), evento: 'MIGRACAO_OK' }));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ evento: 'MIGRACAO_FALHOU', mensagem: e.message }));
  process.exit(1);
});
