'use strict';

// Conexão com o RDS PostgreSQL via DATABASE_URL, sempre com TLS validado pelo
// bundle de certificados da AWS (DB_SSL_CA, baixado no bootstrap da EC2).
const fs = require('node:fs');
const { Pool } = require('pg');
const log = require('./log');

function sslOptions() {
  if (process.env.DB_SSL_CA) return { ca: fs.readFileSync(process.env.DB_SSL_CA, 'utf8'), rejectUnauthorized: true };
  if (process.env.DB_SSL === 'true') return { rejectUnauthorized: false };
  return false;
}

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslOptions(),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on('error', (e) => log.error('DB_POOL_ERRO', { mensagem: e.message }));
  }
  return pool;
}

const db = {
  query: (sql, params) => getPool().query(sql, params),
  async transacao(fn) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const resultado = await fn(client);
      await client.query('COMMIT');
      return resultado;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  },
};

module.exports = { db, sslOptions };
