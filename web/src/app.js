'use strict';

// App Web do ELEITOR: e-mail cadastrado -> código por e-mail -> valida -> cédula -> voto único -> resultado.
const path = require('node:path');
const { criarBase, finalizar, a, limiteAuth } = require('./lib/seguranca');
const { html, csrfField } = require('./lib/html');
const { auditar } = require('./lib/auditoria');
const { gerarCodigo, hashCodigo, codigoValido, emailValido } = require('./codigo');
const { statusPeriodo, formatarData, resultadoAgregado } = require('./periodo');
const crypto = require('node:crypto');
const log = require('./lib/log');

const STATUS = { aberta: 'Aberta', agendada: 'Agendada', encerrada: 'Encerrada' };

function criarApp(opcoes = {}) {
  const producao = process.env.NODE_ENV === 'production';
  if (producao && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET é obrigatório em produção');

  const db = opcoes.db || require('./lib/db').db;
  const enviarCodigo = opcoes.enviarCodigo || require('./lib/email').enviarCodigo;
  const maxTentativas = 5;

  const app = criarBase({
    nome: 'web',
    sessionSecret: process.env.SESSION_SECRET || 'dev-only-session-secret',
    cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : producao,
    publicDir: path.join(__dirname, '..', 'public'),
  });

  async function buscarVotacao(id) {
    if (!/^\d{1,9}$/.test(String(id))) return null;
    const { rows } = await db.query('SELECT id, nome, inicio, fim FROM votacoes WHERE id = $1', [id]);
    return rows[0] || null;
  }

  function eleitorDaSessao(req, votacaoId) {
    const s = req.session.eleitor;
    return s && s.votacaoId === Number(votacaoId) && Date.now() < s.exp ? s : null;
  }

  const normalizar = (email) => String(email || '').trim().toLowerCase().slice(0, 254);

  // ---------- Página inicial ----------
  app.get(
    '/',
    a(async (req, res) => {
      const { rows } = await db.query('SELECT id, nome, inicio, fim FROM votacoes ORDER BY inicio DESC LIMIT 50');
      const agora = new Date();
      const item = (v) => {
        const st = statusPeriodo(v, agora);
        return html`<li class="card linha">
          <div><strong>${v.nome}</strong> <span class="badge ${st}">${STATUS[st]}</span><br>
          <small>${formatarData(v.inicio)} até ${formatarData(v.fim)}</small></div>
          ${st === 'aberta' ? html`<a class="btn" href="/votacao/${v.id}">Votar</a>` : ''}
          ${st === 'encerrada' ? html`<a class="btn sec" href="/votacao/${v.id}/resultado">Resultado</a>` : ''}
        </li>`;
      };
      res.page({
        title: 'Votações',
        body: html`<h1>Sistema de Votação</h1>
          <p>Eleições de representantes estudantis. Escolha a votação e informe seu e-mail cadastrado para receber o código.</p>
          ${rows.length ? html`<ul class="lista">${rows.map(item)}</ul>` : html`<p>Nenhuma votação cadastrada ainda.</p>`}`,
      });
    })
  );

  // ---------- Etapa 1: e-mail ----------
  function formEmail(res, v, erro, status = 200) {
    res.status(status).page({
      title: v.nome,
      body: html`<section class="card">
        <h1>${v.nome}</h1>
        ${erro ? html`<div class="alerta erro">${erro}</div>` : ''}
        <p>Votação aberta até <strong>${formatarData(v.fim)}</strong>.</p>
        <form method="post" action="/auth/solicitar-codigo" class="form">
          ${csrfField(res.locals.csrf)}
          <input type="hidden" name="votacao_id" value="${v.id}">
          <label>Seu e-mail cadastrado<input type="email" name="email" required maxlength="254" autocomplete="email"></label>
          <button class="btn">Receber código</button>
        </form>
        <p class="dica">O código é único para esta votação e enviado uma única vez. Se já recebeu, informe o e-mail de novo e use o mesmo código.</p>
      </section>`,
    });
  }

  app.get(
    '/votacao/:id',
    a(async (req, res) => {
      const v = await buscarVotacao(req.params.id);
      if (!v) return res.notFound();
      const st = statusPeriodo(v);
      if (st === 'agendada') return res.message(v.nome, `A votação abre em ${formatarData(v.inicio)}.`);
      if (st === 'encerrada') return res.message(v.nome, 'A votação está encerrada.', `/votacao/${v.id}/resultado`);
      formEmail(res, v);
    })
  );

  app.post(
    '/auth/solicitar-codigo',
    limiteAuth,
    a(async (req, res) => {
      const v = await buscarVotacao(req.body.votacao_id);
      if (!v) return res.notFound();
      const email = normalizar(req.body.email);
      if (!emailValido(email)) return formEmail(res, v, 'E-mail inválido.', 400);

      if (statusPeriodo(v) !== 'aberta') {
        await auditar(db, { evento: 'VOTO_FORA_PERIODO', ator: email, detalhes: { votacao_id: v.id, etapa: 'solicitar_codigo' }, ip: req.ip });
        return res.message(v.nome, 'Esta votação não está aberta.');
      }

      // Código único: só gera se o e-mail é apto, não votou e ainda não recebeu código.
      const codigo = gerarCodigo();
      const salt = crypto.randomBytes(16).toString('hex');
      const { rows } = await db.query(
        `UPDATE eleitores_aptos SET codigo_hash = $1, codigo_salt = $2, codigo_enviado_em = now()
          WHERE votacao_id = $3 AND email = $4 AND codigo_hash IS NULL AND votou = false
          RETURNING id`,
        [hashCodigo(codigo, salt), salt, v.id, email]
      );

      if (rows.length) {
        try {
          await enviarCodigo(email, codigo, v.nome);
          await auditar(db, { evento: 'CODIGO_ENVIADO', ator: email, detalhes: { votacao_id: v.id }, ip: req.ip });
        } catch (e) {
          await db.query('UPDATE eleitores_aptos SET codigo_hash = NULL, codigo_salt = NULL, codigo_enviado_em = NULL WHERE id = $1', [rows[0].id]);
          log.error('EMAIL_FALHOU', { mensagem: e.message });
          return res.message('Falha no envio', 'Não foi possível enviar o e-mail agora. Tente novamente em instantes.', `/votacao/${v.id}`);
        }
      } else {
        await auditar(db, { evento: 'CODIGO_NAO_GERADO', ator: email, detalhes: { votacao_id: v.id }, ip: req.ip });
      }

      // Resposta genérica: não revela se o e-mail está ou não cadastrado.
      req.session.pendente = { votacaoId: v.id, email };
      res.redirect(`/votacao/${v.id}/codigo`);
    })
  );

  // ---------- Etapa 2: código ----------
  function formCodigo(res, v, erro) {
    res.page({
      title: 'Código de verificação',
      body: html`<section class="card">
        <h1>${v.nome}</h1>
        ${erro ? html`<div class="alerta erro">${erro}</div>` : ''}
        <p>Se o e-mail estiver cadastrado, você receberá um código de 6 dígitos.</p>
        <form method="post" action="/auth/validar-codigo" class="form">
          ${csrfField(res.locals.csrf)}
          <label>Código<input name="codigo" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code"></label>
          <button class="btn">Validar e ir para a cédula</button>
        </form>
      </section>`,
    });
  }

  app.get(
    '/votacao/:id/codigo',
    a(async (req, res) => {
      const v = await buscarVotacao(req.params.id);
      if (!v) return res.notFound();
      const p = req.session.pendente;
      if (!p || p.votacaoId !== v.id) return res.redirect(`/votacao/${v.id}`);
      formCodigo(res, v);
    })
  );

  app.post(
    '/auth/validar-codigo',
    limiteAuth,
    a(async (req, res) => {
      const p = req.session.pendente;
      if (!p) return res.redirect('/');
      const v = await buscarVotacao(p.votacaoId);
      if (!v) return res.notFound();

      if (statusPeriodo(v) !== 'aberta') {
        req.session.pendente = null;
        await auditar(db, { evento: 'VOTO_FORA_PERIODO', ator: p.email, detalhes: { votacao_id: v.id, etapa: 'validar_codigo' }, ip: req.ip });
        return res.message(v.nome, 'Esta votação não está mais aberta.');
      }

      const codigo = String(req.body.codigo || '').replace(/\D/g, '').slice(0, 6);
      const { rows } = await db.query(
        'SELECT id, codigo_hash, codigo_salt, tentativas, votou FROM eleitores_aptos WHERE votacao_id = $1 AND email = $2',
        [v.id, p.email]
      );
      const e = rows[0];

      if (e && e.votou) {
        req.session.pendente = null;
        await auditar(db, { evento: 'VOTO_DUPLICADO', ator: p.email, detalhes: { votacao_id: v.id, etapa: 'validar_codigo' }, ip: req.ip });
        return res.message(v.nome, 'Este e-mail já votou nesta eleição. Cada eleitor vota uma única vez.');
      }
      if (!e || !e.codigo_hash) {
        await auditar(db, { evento: 'CODIGO_INVALIDO', ator: p.email, detalhes: { votacao_id: v.id, motivo: 'sem_codigo' }, ip: req.ip });
        return formCodigo(res, v, 'Código inválido.');
      }
      if (e.tentativas >= maxTentativas) {
        await auditar(db, { evento: 'CODIGO_BLOQUEADO', ator: p.email, detalhes: { votacao_id: v.id }, ip: req.ip });
        return res.message(v.nome, 'Número máximo de tentativas atingido. Procure a comissão eleitoral.');
      }
      if (!codigoValido(codigo, e.codigo_salt, e.codigo_hash)) {
        await db.query('UPDATE eleitores_aptos SET tentativas = tentativas + 1 WHERE id = $1', [e.id]);
        await auditar(db, { evento: 'CODIGO_INVALIDO', ator: p.email, detalhes: { votacao_id: v.id, tentativa: e.tentativas + 1 }, ip: req.ip });
        return formCodigo(res, v, `Código inválido. Tentativas restantes: ${maxTentativas - e.tentativas - 1}.`);
      }

      req.session.pendente = null;
      req.session.eleitor = { id: e.id, votacaoId: v.id, exp: new Date(v.fim).getTime() };
      await auditar(db, { evento: 'CODIGO_VALIDADO', ator: p.email, detalhes: { votacao_id: v.id }, ip: req.ip });
      res.redirect(`/votacao/${v.id}/cedula`);
    })
  );

  // ---------- Etapa 3: cédula e voto ----------
  app.get(
    '/votacao/:id/cedula',
    a(async (req, res) => {
      const v = await buscarVotacao(req.params.id);
      if (!v) return res.notFound();
      if (!eleitorDaSessao(req, v.id) || statusPeriodo(v) !== 'aberta') return res.redirect(`/votacao/${v.id}`);
      const { rows: cands } = await db.query('SELECT id, nome, descricao FROM candidatos WHERE votacao_id = $1 ORDER BY nome', [v.id]);
      res.page({
        title: 'Cédula',
        body: html`<section class="card">
          <h1>Cédula · ${v.nome}</h1>
          <form method="post" action="/votacao/${v.id}/votar" class="form">
            ${csrfField(res.locals.csrf)}
            <fieldset class="cedula">
              ${cands.map(
                (c) => html`<label class="opcao"><input type="radio" name="candidato_id" value="${c.id}" required>
                  <span><strong>${c.nome}</strong>${c.descricao ? html`<br><small>${c.descricao}</small>` : ''}</span></label>`
              )}
            </fieldset>
            <button class="btn">Confirmar voto</button>
          </form>
          <p class="dica">Seu voto é anônimo: o sistema registra apenas que você votou, não em quem.</p>
        </section>`,
      });
    })
  );

  app.post(
    '/votacao/:id/votar',
    a(async (req, res) => {
      const s = eleitorDaSessao(req, req.params.id);
      if (!s) return res.message('Sessão expirada', 'Valide seu código novamente para votar.', `/votacao/${Number(req.params.id) || ''}`);
      const candidatoId = Number(req.body.candidato_id);

      const r = await db.transacao(async (c) => {
        const { rows: [v] } = await c.query('SELECT id, nome, inicio, fim FROM votacoes WHERE id = $1', [s.votacaoId]);
        if (!v || statusPeriodo(v) !== 'aberta') return { erro: 'fora' };
        // FOR UPDATE bloqueia a linha do eleitor: impede voto duplo mesmo com cliques simultâneos.
        const { rows: [e] } = await c.query('SELECT id, email, votou FROM eleitores_aptos WHERE id = $1 AND votacao_id = $2 FOR UPDATE', [s.id, v.id]);
        if (!e) return { erro: 'invalido' };
        if (e.votou) return { erro: 'duplicado', v, email: e.email };
        const cand = await c.query('SELECT 1 FROM candidatos WHERE id = $1 AND votacao_id = $2', [candidatoId, v.id]);
        if (!cand.rowCount) return { erro: 'candidato' };

        await c.query('INSERT INTO votos (votacao_id, candidato_id) VALUES ($1, $2)', [v.id, candidatoId]);
        await c.query('UPDATE eleitores_aptos SET votou = true, codigo_hash = NULL, codigo_salt = NULL WHERE id = $1', [e.id]);
        await auditar(c, { evento: 'VOTO_REGISTRADO', ator: e.email, detalhes: { votacao_id: v.id }, ip: req.ip });
        return { ok: true, v };
      });

      req.session.eleitor = null;
      if (r.erro === 'fora') {
        await auditar(db, { evento: 'VOTO_FORA_PERIODO', detalhes: { votacao_id: s.votacaoId, etapa: 'votar' }, ip: req.ip });
        return res.message('Votação encerrada', 'O período de votação terminou.');
      }
      if (r.erro === 'duplicado') {
        await auditar(db, { evento: 'VOTO_DUPLICADO', ator: r.email, detalhes: { votacao_id: r.v.id, etapa: 'votar' }, ip: req.ip });
        return res.message('Voto já registrado', 'Este e-mail já votou nesta eleição.');
      }
      if (r.erro) return res.message('Voto inválido', 'Não foi possível registrar o voto.');
      res.message('Voto registrado!', `Obrigado por votar. O resultado será publicado após ${formatarData(r.v.fim)}.`, `/votacao/${r.v.id}/resultado`);
    })
  );

  // ---------- Resultado público (após o encerramento) ----------
  app.get(
    '/votacao/:id/resultado',
    a(async (req, res) => {
      const v = await buscarVotacao(req.params.id);
      if (!v) return res.notFound();
      if (statusPeriodo(v) !== 'encerrada') {
        return res.message(v.nome, `O resultado será publicado após o encerramento (${formatarData(v.fim)}).`);
      }
      const { rows: linhas } = await db.query(
        `SELECT c.nome, COUNT(vo.id)::int AS votos FROM candidatos c
           LEFT JOIN votos vo ON vo.candidato_id = c.id
          WHERE c.votacao_id = $1 GROUP BY c.id, c.nome`,
        [v.id]
      );
      const { rows: [{ total }] } = await db.query('SELECT COUNT(*)::int AS total FROM eleitores_aptos WHERE votacao_id = $1', [v.id]);
      const r = resultadoAgregado(linhas, total);
      res.page({
        title: `Resultado · ${v.nome}`,
        body: html`<section class="card">
          <h1>Resultado · ${v.nome}</h1>
          <p>${r.totalVotos} votos de ${r.totalAptos} eleitores cadastrados (participação de ${r.participacao}%).</p>
          <table class="tabela">
            <thead><tr><th>Candidato</th><th>Votos</th><th>%</th><th></th></tr></thead>
            <tbody>${r.candidatos.map(
              (c) => html`<tr><td>${c.nome}</td><td>${c.votos}</td><td>${c.percentual}%</td>
                <td class="barra"><progress max="100" value="${c.percentual}"></progress></td></tr>`
            )}</tbody>
          </table>
        </section>`,
      });
    })
  );

  finalizar(app);
  return app;
}

module.exports = criarApp();
module.exports.criarApp = criarApp;
