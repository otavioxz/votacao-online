'use strict';

// App ADMIN (comissão eleitoral), servido em /admin. Pelo WAF, só abre a partir dos IPs
// da instituição. Login por código enviado aos e-mails de ADMIN_EMAILS.
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { criarBase, finalizar, a, limiteAuth } = require('./lib/seguranca');
const { html, csrfField, jsonForHtml } = require('./lib/html');
const { auditar } = require('./lib/auditoria');
const { statusPeriodo, formatarData, lerDataLocal, resultadoAgregado } = require('./periodo');
const { parseEleitoresCsv } = require('./resultado');
const { gerarCodigo, hashCodigo, codigoValido } = require('./codigo');

const STATUS = { aberta: 'Aberta', agendada: 'Agendada', encerrada: 'Encerrada' };
const idValido = (id) => /^\d{1,9}$/.test(String(id));

function criarApp(opcoes = {}) {
  const producao = process.env.NODE_ENV === 'production';
  if (producao && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET é obrigatório em produção');

  const db = opcoes.db || require('./lib/db').db;
  const enviarCodigo = opcoes.enviarCodigo || require('./lib/email').enviarCodigo;
  const adminEmails = (opcoes.adminEmails || process.env.ADMIN_EMAILS || '')
    .toString()
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const maxTentativas = 5;

  const app = criarBase({
    nome: 'admin',
    basePath: '/admin',
    sessionSecret: process.env.SESSION_SECRET || 'dev-only-session-secret',
    cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : producao,
    publicDir: path.join(__dirname, '..', 'public'),
    arquivosEstaticos: {
      '/admin/static/chart.umd.js': path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.js'),
    },
  });

  app.get('/', (req, res) => res.redirect('/admin'));
  const r = express.Router();
  app.use('/admin', r);

  // ---------- Login por código ----------
  r.get('/login', (req, res) => {
    res.page({
      title: 'Acesso da comissão',
      body: html`<section class="card centro">
        <h1>Painel da Comissão Eleitoral</h1>
        <form method="post" action="/admin/auth/solicitar-codigo" class="form">
          ${csrfField(res.locals.csrf)}
          <label>E-mail da comissão<input type="email" name="email" required maxlength="254"></label>
          <button class="btn">Enviar código</button>
        </form>
      </section>`,
    });
  });

  r.post(
    '/auth/solicitar-codigo',
    limiteAuth,
    a(async (req, res) => {
      const email = String(req.body.email || '').trim().toLowerCase().slice(0, 254);
      if (adminEmails.includes(email)) {
        const codigo = gerarCodigo();
        const salt = crypto.randomBytes(16).toString('hex');
        await db.query(
          `INSERT INTO admin_codigos (email, codigo_hash, codigo_salt, expira_em, tentativas)
           VALUES ($1, $2, $3, now() + interval '10 minutes', 0)
           ON CONFLICT (email) DO UPDATE SET codigo_hash = EXCLUDED.codigo_hash, codigo_salt = EXCLUDED.codigo_salt,
             expira_em = EXCLUDED.expira_em, tentativas = 0`,
          [email, hashCodigo(codigo, salt), salt]
        );
        await enviarCodigo(email, codigo, 'Painel da comissão eleitoral');
        await auditar(db, { evento: 'ADMIN_CODIGO_ENVIADO', ator: email, ip: req.ip });
      } else {
        await auditar(db, { evento: 'ADMIN_LOGIN_FALHOU', ator: email || null, detalhes: { motivo: 'email_nao_autorizado' }, ip: req.ip });
      }
      req.session.adminPendente = email;
      res.redirect('/admin/codigo');
    })
  );

  r.get('/codigo', (req, res) => {
    if (!req.session.adminPendente) return res.redirect('/admin/login');
    res.page({
      title: 'Código',
      body: html`<section class="card centro">
        <h1>Informe o código</h1>
        <p>Se o e-mail for de um membro da comissão, enviamos um código válido por 10 minutos.</p>
        <form method="post" action="/admin/auth/validar-codigo" class="form">
          ${csrfField(res.locals.csrf)}
          <label>Código<input name="codigo" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code"></label>
          <button class="btn">Entrar</button>
        </form>
      </section>`,
    });
  });

  r.post(
    '/auth/validar-codigo',
    limiteAuth,
    a(async (req, res) => {
      const email = req.session.adminPendente;
      if (!email) return res.redirect('/admin/login');
      const codigo = String(req.body.codigo || '').replace(/\D/g, '').slice(0, 6);
      const { rows: [row] } = await db.query(
        'SELECT codigo_hash, codigo_salt, tentativas, expira_em > now() AS valido FROM admin_codigos WHERE email = $1',
        [email]
      );
      const ok =
        row && row.valido && row.tentativas < maxTentativas && adminEmails.includes(email) &&
        codigoValido(codigo, row.codigo_salt, row.codigo_hash);

      if (!ok) {
        if (row) await db.query('UPDATE admin_codigos SET tentativas = tentativas + 1 WHERE email = $1', [email]);
        await auditar(db, { evento: 'ADMIN_LOGIN_FALHOU', ator: email, detalhes: { motivo: 'codigo_invalido_ou_expirado' }, ip: req.ip });
        req.flash('erro', 'Código inválido ou expirado.');
        return res.redirect('/admin/codigo');
      }
      await db.query('DELETE FROM admin_codigos WHERE email = $1', [email]);
      req.session.adminPendente = null;
      req.session.admin = { email, exp: Date.now() + 2 * 60 * 60 * 1000 };
      await auditar(db, { evento: 'ADMIN_LOGIN', ator: email, ip: req.ip });
      res.redirect('/admin');
    })
  );

  // ---------- Daqui para baixo: só a comissão autenticada ----------
  r.use((req, res, next) => {
    const s = req.session.admin;
    if (s && Date.now() < s.exp && adminEmails.includes(s.email)) {
      res.locals.admin = s.email;
      return next();
    }
    req.session.admin = null;
    res.redirect('/admin/login');
  });

  r.post('/logout', (req, res) => {
    req.session = null;
    res.redirect('/admin/login');
  });

  r.get(
    '/',
    a(async (req, res) => {
      const { rows } = await db.query(`
        SELECT v.id, v.nome, v.inicio, v.fim,
          (SELECT COUNT(*) FROM candidatos c WHERE c.votacao_id = v.id)::int AS candidatos,
          (SELECT COUNT(*) FROM eleitores_aptos e WHERE e.votacao_id = v.id)::int AS aptos,
          (SELECT COUNT(*) FROM eleitores_aptos e WHERE e.votacao_id = v.id AND e.votou)::int AS votantes
        FROM votacoes v ORDER BY v.inicio DESC`);
      res.page({
        title: 'Votações',
        body: html`<h1>Votações</h1>
        <table class="tabela">
          <thead><tr><th>Nome</th><th>Período</th><th>Status</th><th>Candidatos</th><th>Votaram / Aptos</th><th></th></tr></thead>
          <tbody>${rows.map((v) => {
            const st = statusPeriodo(v);
            return html`<tr><td>${v.nome}</td><td>${formatarData(v.inicio)} – ${formatarData(v.fim)}</td>
              <td><span class="badge ${st}">${STATUS[st]}</span></td><td>${v.candidatos}</td>
              <td>${v.votantes} / ${v.aptos}</td><td><a href="/admin/votacoes/${v.id}">Gerenciar</a></td></tr>`;
          })}</tbody>
        </table>
        <section class="card">
          <h2>Nova votação</h2>
          <form method="post" action="/admin/votacoes" class="form grid">
            ${csrfField(res.locals.csrf)}
            <label>Nome<input name="nome" required minlength="3" maxlength="200"></label>
            <label>Início (horário de Brasília)<input type="datetime-local" name="inicio" required></label>
            <label>Fim (horário de Brasília)<input type="datetime-local" name="fim" required></label>
            <button class="btn">Criar votação</button>
          </form>
        </section>`,
      });
    })
  );

  r.post(
    '/votacoes',
    a(async (req, res) => {
      const nome = String(req.body.nome || '').trim().slice(0, 200);
      const inicio = lerDataLocal(req.body.inicio);
      const fim = lerDataLocal(req.body.fim);
      if (nome.length < 3 || !inicio || !fim || fim <= inicio || fim <= new Date()) {
        req.flash('erro', 'Dados inválidos: confira o nome e se o fim é depois do início e do momento atual.');
        return res.redirect('/admin');
      }
      const { rows: [v] } = await db.query(
        'INSERT INTO votacoes (nome, inicio, fim, criado_por) VALUES ($1, $2, $3, $4) RETURNING id',
        [nome, inicio, fim, res.locals.admin]
      );
      await auditar(db, { evento: 'VOTACAO_CRIADA', ator: res.locals.admin, detalhes: { votacao_id: v.id, nome }, ip: req.ip });
      req.flash('ok', 'Votação criada. Cadastre os candidatos e importe os e-mails antes do início.');
      res.redirect(`/admin/votacoes/${v.id}`);
    })
  );

  r.get(
    '/votacoes/:id',
    a(async (req, res) => {
      if (!idValido(req.params.id)) return res.notFound();
      const { rows: [v] } = await db.query('SELECT id, nome, inicio, fim FROM votacoes WHERE id = $1', [req.params.id]);
      if (!v) return res.notFound();
      const st = statusPeriodo(v);
      const editavel = st === 'agendada';

      const { rows: cands } = await db.query(
        `SELECT c.id, c.nome, c.descricao, COUNT(vo.id)::int AS votos FROM candidatos c
           LEFT JOIN votos vo ON vo.candidato_id = c.id
          WHERE c.votacao_id = $1 GROUP BY c.id ORDER BY c.nome`,
        [v.id]
      );
      const { rows: [cont] } = await db.query(
        'SELECT COUNT(*)::int AS aptos, COUNT(*) FILTER (WHERE votou)::int AS votantes FROM eleitores_aptos WHERE votacao_id = $1',
        [v.id]
      );
      const { rows: eventos } = await db.query(
        `SELECT criado_em, ator, evento, ip FROM audit_log WHERE detalhes->>'votacao_id' = $1 ORDER BY id DESC LIMIT 25`,
        [String(v.id)]
      );
      const resultado = resultadoAgregado(cands, cont.aptos);
      // Votos por candidato só depois do encerramento (sigilo durante a votação)
      const dados = {
        aptos: cont.aptos,
        votantes: cont.votantes,
        candidatos: st === 'encerrada' ? resultado.candidatos.map((c) => ({ nome: c.nome, votos: c.votos, percentual: c.percentual })) : null,
      };

      res.page({
        title: v.nome,
        body: html`<h1>${v.nome} <span class="badge ${st}">${STATUS[st]}</span></h1>
        <p>${formatarData(v.inicio)} até ${formatarData(v.fim)}</p>

        <section class="card">
          <h2>Dashboard</h2>
          <script type="application/json" id="dados-graficos">${jsonForHtml(dados)}</script>
          <div class="graficos">
            <div><h3>Participação (${cont.votantes} de ${cont.aptos})</h3><canvas id="graficoParticipacao"></canvas></div>
            ${st === 'encerrada'
              ? html`<div><h3>Votos por candidato (%)</h3><canvas id="graficoPizza"></canvas></div>
                     <div class="largo"><h3>Votos por candidato</h3><canvas id="graficoBarras"></canvas></div>`
              : html`<div><p class="dica">Os votos por candidato ficam ocultos até o encerramento.</p></div>`}
          </div>
        </section>

        <section class="card">
          <h2>Candidatos (${cands.length})</h2>
          <ul class="lista simples">${cands.map(
            (c) => html`<li>${c.nome}${c.descricao ? html` <small>– ${c.descricao}</small>` : ''}
              ${editavel
                ? html`<form method="post" action="/admin/votacoes/${v.id}/candidatos/${c.id}/remover" class="inline">
                    ${csrfField(res.locals.csrf)}<button class="link perigo">remover</button></form>`
                : ''}</li>`
          )}</ul>
          ${editavel
            ? html`<form method="post" action="/admin/votacoes/${v.id}/candidatos" class="form grid">
                ${csrfField(res.locals.csrf)}
                <label>Nome<input name="nome" required maxlength="200"></label>
                <label>Descrição (opcional)<input name="descricao" maxlength="300"></label>
                <button class="btn">Adicionar candidato</button>
              </form>`
            : html`<p class="dica">Candidatos não podem ser alterados após o início.</p>`}
        </section>

        <section class="card">
          <h2>Eleitores aptos (${cont.aptos})</h2>
          ${editavel
            ? html`<form method="post" action="/admin/votacoes/${v.id}/eleitores" class="form">
                ${csrfField(res.locals.csrf)}
                <label>Arquivo CSV (uma coluna "email")<input type="file" id="arquivoCsv" accept=".csv,.txt,text/csv"></label>
                <label>Conteúdo do CSV<textarea id="csv" name="csv" rows="6" placeholder="email&#10;aluno1@unidavi.edu.br" required></textarea></label>
                <button class="btn">Importar e-mails</button>
              </form>`
            : html`<p class="dica">A lista de e-mails só pode ser importada antes do início da votação.</p>`}
        </section>

        <section class="card">
          <h2>Auditoria desta votação</h2>
          <table class="tabela pequena"><thead><tr><th>Quando</th><th>Quem</th><th>Evento</th><th>IP</th></tr></thead>
          <tbody>${eventos.map((e) => html`<tr><td>${formatarData(e.criado_em)}</td><td>${e.ator}</td><td>${e.evento}</td><td>${e.ip}</td></tr>`)}</tbody></table>
          <a href="/admin/auditoria">Ver auditoria completa</a>
        </section>`,
      });
    })
  );

  r.post(
    '/votacoes/:id/candidatos',
    a(async (req, res) => {
      if (!idValido(req.params.id)) return res.notFound();
      const id = Number(req.params.id);
      const nome = String(req.body.nome || '').trim().slice(0, 200);
      const descricao = String(req.body.descricao || '').trim().slice(0, 300) || null;
      if (!nome) {
        req.flash('erro', 'Informe o nome do candidato.');
        return res.redirect(`/admin/votacoes/${id}`);
      }
      const { rowCount } = await db.query(
        'INSERT INTO candidatos (votacao_id, nome, descricao) SELECT id, $2, $3 FROM votacoes WHERE id = $1 AND inicio > now()',
        [id, nome, descricao]
      );
      if (rowCount) {
        await auditar(db, { evento: 'CANDIDATO_ADICIONADO', ator: res.locals.admin, detalhes: { votacao_id: id, nome }, ip: req.ip });
        req.flash('ok', 'Candidato adicionado.');
      } else req.flash('erro', 'Não é possível alterar candidatos após o início da votação.');
      res.redirect(`/admin/votacoes/${id}`);
    })
  );

  r.post(
    '/votacoes/:id/candidatos/:cid/remover',
    a(async (req, res) => {
      if (!idValido(req.params.id) || !idValido(req.params.cid)) return res.notFound();
      const id = Number(req.params.id);
      const { rowCount } = await db.query(
        `DELETE FROM candidatos c USING votacoes v
          WHERE c.id = $1 AND c.votacao_id = $2 AND v.id = c.votacao_id AND v.inicio > now()`,
        [req.params.cid, id]
      );
      if (rowCount) {
        await auditar(db, { evento: 'CANDIDATO_REMOVIDO', ator: res.locals.admin, detalhes: { votacao_id: id, candidato_id: Number(req.params.cid) }, ip: req.ip });
        req.flash('ok', 'Candidato removido.');
      } else req.flash('erro', 'Não foi possível remover (a votação já começou?).');
      res.redirect(`/admin/votacoes/${id}`);
    })
  );

  r.post(
    '/votacoes/:id/eleitores',
    a(async (req, res) => {
      if (!idValido(req.params.id)) return res.notFound();
      const { rows: [v] } = await db.query('SELECT id, inicio, fim FROM votacoes WHERE id = $1', [req.params.id]);
      if (!v) return res.notFound();
      if (statusPeriodo(v) !== 'agendada') {
        req.flash('erro', 'A importação só é permitida antes do início da votação.');
        return res.redirect(`/admin/votacoes/${v.id}`);
      }
      const csv = String(req.body.csv || '');
      const emails = parseEleitoresCsv(csv);
      const linhas = csv.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l.toLowerCase() !== 'email').length;
      if (emails.length > 20000) {
        req.flash('erro', 'Limite de 20.000 e-mails por importação.');
        return res.redirect(`/admin/votacoes/${v.id}`);
      }
      const { rowCount } = await db.query(
        `INSERT INTO eleitores_aptos (votacao_id, email) SELECT $1, e FROM unnest($2::text[]) AS e
         ON CONFLICT (votacao_id, email) DO NOTHING`,
        [v.id, emails]
      );
      const ignoradas = Math.max(linhas - emails.length, 0);
      await auditar(db, {
        evento: 'ELEITORES_IMPORTADOS',
        ator: res.locals.admin,
        detalhes: { votacao_id: v.id, novos: rowCount, validos: emails.length, ignorados: ignoradas },
        ip: req.ip,
      });
      req.flash(ignoradas ? 'aviso' : 'ok', `${rowCount} e-mail(s) novo(s) importado(s).${ignoradas ? ` ${ignoradas} linha(s) inválida(s) ou duplicada(s) ignorada(s).` : ''}`);
      res.redirect(`/admin/votacoes/${v.id}`);
    })
  );

  r.get(
    '/auditoria',
    a(async (req, res) => {
      const { rows } = await db.query('SELECT criado_em, ator, evento, detalhes, ip FROM audit_log ORDER BY id DESC LIMIT 300');
      res.page({
        title: 'Auditoria',
        body: html`<h1>Auditoria</h1>
        <p class="dica">Últimos 300 eventos. Os logs também vão para o CloudWatch, e as ações na conta AWS ficam no CloudTrail.</p>
        <table class="tabela pequena"><thead><tr><th>Quando</th><th>Quem</th><th>Evento</th><th>Detalhes</th><th>IP</th></tr></thead>
        <tbody>${rows.map(
          (e) => html`<tr class="${/INVALIDO|DUPLICADO|FORA|FALHOU|BLOQUEADO/.test(e.evento) ? 'suspeito' : ''}">
            <td>${formatarData(e.criado_em)}</td><td>${e.ator}</td><td>${e.evento}</td><td><code>${JSON.stringify(e.detalhes)}</code></td><td>${e.ip}</td></tr>`
        )}</tbody></table>`,
      });
    })
  );

  finalizar(app);
  return app;
}

module.exports = criarApp();
module.exports.criarApp = criarApp;
