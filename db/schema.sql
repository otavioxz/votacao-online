-- Schema do RDS PostgreSQL (sub-rede privada, sem internet)

CREATE TABLE votacoes (
  id          SERIAL PRIMARY KEY,
  nome        VARCHAR(200) NOT NULL,
  inicio      TIMESTAMPTZ  NOT NULL,
  fim         TIMESTAMPTZ  NOT NULL,
  CHECK (fim > inicio)
);

CREATE TABLE candidatos (
  id          SERIAL PRIMARY KEY,
  votacao_id  INT NOT NULL REFERENCES votacoes(id),
  nome        VARCHAR(200) NOT NULL
);

-- Guarda apenas o hash do código; "votou" impede voto duplicado
CREATE TABLE eleitores_aptos (
  id           SERIAL PRIMARY KEY,
  votacao_id   INT NOT NULL REFERENCES votacoes(id),
  email        VARCHAR(255) NOT NULL,
  codigo_hash  VARCHAR(128),
  codigo_salt  VARCHAR(64),
  votou        BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (votacao_id, email)
);

-- Votos anônimos: sem e-mail nem referência ao eleitor
CREATE TABLE votos (
  id            SERIAL PRIMARY KEY,
  votacao_id    INT NOT NULL REFERENCES votacoes(id),
  candidato_id  INT NOT NULL REFERENCES candidatos(id),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id          SERIAL PRIMARY KEY,
  evento      VARCHAR(100) NOT NULL,
  detalhes    JSONB,
  ip          INET,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Usuário da aplicação com privilégio mínimo (sem DROP/ALTER, sem UPDATE/DELETE em votos)
-- CREATE USER app_votacao WITH PASSWORD '<definir no Secrets/.env>';
-- GRANT SELECT ON votacoes, candidatos TO app_votacao;
-- GRANT SELECT, UPDATE ON eleitores_aptos TO app_votacao;
-- GRANT INSERT, SELECT ON votos, audit_log TO app_votacao;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_votacao;
