-- Schema do RDS PostgreSQL (sub-rede privada, sem internet).
-- Idempotente: aplicado por admin/src/migrate.js a cada deploy da EC2 Admin,
-- que também cria os usuários votacao_web e votacao_admin com privilégio mínimo.

CREATE TABLE IF NOT EXISTS votacoes (
  id          SERIAL PRIMARY KEY,
  nome        VARCHAR(200) NOT NULL,
  inicio      TIMESTAMPTZ  NOT NULL,
  fim         TIMESTAMPTZ  NOT NULL,
  criado_por  VARCHAR(254),
  criado_em   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (fim > inicio)
);

CREATE TABLE IF NOT EXISTS candidatos (
  id          SERIAL PRIMARY KEY,
  votacao_id  INT NOT NULL REFERENCES votacoes(id) ON DELETE CASCADE,
  nome        VARCHAR(200) NOT NULL,
  descricao   VARCHAR(300)
);

-- Guarda apenas o hash (scrypt + salt) do código; "votou" impede voto duplicado
CREATE TABLE IF NOT EXISTS eleitores_aptos (
  id                 SERIAL PRIMARY KEY,
  votacao_id         INT NOT NULL REFERENCES votacoes(id) ON DELETE CASCADE,
  email              VARCHAR(255) NOT NULL,
  codigo_hash        VARCHAR(128),
  codigo_salt        VARCHAR(64),
  codigo_enviado_em  TIMESTAMPTZ,
  tentativas         INT NOT NULL DEFAULT 0,
  votou              BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (votacao_id, email)
);

-- Votos anônimos: sem e-mail, sem referência ao eleitor e sem horário.
-- O id é um UUID aleatório para que a ordem dos votos não possa ser cruzada
-- com a ordem dos eventos VOTO_REGISTRADO na auditoria.
CREATE TABLE IF NOT EXISTS votos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  votacao_id    INT NOT NULL REFERENCES votacoes(id) ON DELETE CASCADE,
  candidato_id  INT NOT NULL REFERENCES candidatos(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_votos_votacao ON votos (votacao_id);

-- Códigos de login da comissão (expiram em 10 minutos)
CREATE TABLE IF NOT EXISTS admin_codigos (
  email        VARCHAR(254) PRIMARY KEY,
  codigo_hash  VARCHAR(128) NOT NULL,
  codigo_salt  VARCHAR(64)  NOT NULL,
  expira_em    TIMESTAMPTZ  NOT NULL,
  tentativas   INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  evento      VARCHAR(100) NOT NULL,
  ator        VARCHAR(254),
  detalhes    JSONB,
  ip          INET,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_evento ON audit_log (evento);

-- Privilégios (aplicados pelo migrate.js):
--   votacao_web:   SELECT votacoes, candidatos | SELECT, UPDATE eleitores_aptos | SELECT, INSERT votos | INSERT audit_log
--   votacao_admin: SELECT, INSERT votacoes, eleitores_aptos | SELECT, INSERT, DELETE candidatos
--                  | CRUD admin_codigos | SELECT votos | SELECT, INSERT audit_log
--   Nenhum dos dois pode alterar/apagar votos ou a auditoria, nem fazer DDL.
