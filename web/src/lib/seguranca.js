'use strict';

// Base Express comum aos dois apps: Helmet/CSP, rate limit, sessão em cookie assinado,
// proteção CSRF e helpers de renderização. (Arquivo idêntico em web/ e admin/,
// porque cada app é implantado de forma independente na sua EC2.)

const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const cookieSession = require('cookie-session');
const rateLimit = require('express-rate-limit');
const log = require('./log');
const { layout, html } = require('./html');

const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Limite extra nas rotas de código (defesa em profundidade: o WAF já limita antes).
const limiteAuth = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });

function tokensIguais(x, y) {
  const bx = Buffer.from(String(x));
  const by = Buffer.from(String(y));
  return bx.length === by.length && crypto.timingSafeEqual(bx, by);
}

// Token CSRF por sessão, exigido em todo POST.
function csrfProtection(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(16).toString('hex');
  res.locals.csrf = req.session.csrf;
  if (req.method === 'POST') {
    const token = (req.body && req.body._csrf) || '';
    if (!tokensIguais(token, req.session.csrf)) {
      log.warn('CSRF_INVALIDO', { caminho: req.path, ip: req.ip });
      return res.message('Requisição inválida', 'Sessão expirada ou requisição inválida. Tente novamente.', undefined, 403);
    }
  }
  next();
}

function criarBase({ nome, basePath = '', sessionSecret, cookieSecure, publicDir, arquivosEstaticos = {} }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // atrás do ALB

  // Health check antes da sessão (o ALB chama por HTTP interno, sem cookie)
  const health = (req, res) => res.json({ status: 'ok', app: nome });
  app.get('/health', health);
  if (basePath) app.get(`${basePath}/health`, health);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: cookieSecure ? [] : null,
        },
      },
      referrerPolicy: { policy: 'same-origin' },
    })
  );

  app.use(`${basePath}/static`, express.static(publicDir, { maxAge: '1h', index: false }));
  for (const [rota, arquivo] of Object.entries(arquivosEstaticos)) {
    app.get(rota, (req, res) => res.sendFile(arquivo));
  }

  app.use(express.urlencoded({ extended: false, limit: '2mb', parameterLimit: 100 }));
  app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
  app.use(
    cookieSession({
      name: `votacao_${nome}`,
      keys: [sessionSecret],
      path: basePath || '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: cookieSecure,
      maxAge: (nome === 'admin' ? 120 : 30) * 60 * 1000,
    })
  );

  const inicio = basePath || '/';
  app.use((req, res, next) => {
    res.page = (opts) => {
      const flash = req.session.flash || null;
      req.session.flash = null;
      res.send(layout({ area: nome, usuario: res.locals.admin || null, csrf: res.locals.csrf, flash, ...opts }).toString());
    };
    res.message = (title, texto, link = inicio, status = 200) => {
      res.status(status).page({
        title,
        body: html`<section class="card centro"><h1>${title}</h1><p>${texto}</p><a class="btn" href="${link}">Continuar</a></section>`,
      });
    };
    res.notFound = () => res.message('Não encontrado', 'A página solicitada não existe.', inicio, 404);
    req.flash = (tipo, texto) => {
      req.session.flash = { tipo, texto };
    };
    next();
  });
  app.use(csrfProtection);
  return app;
}

function finalizar(app) {
  app.use((req, res) => res.notFound());
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    log.error('ERRO_NAO_TRATADO', { mensagem: err.message, caminho: req.path });
    if (!res.headersSent) res.status(500).send('Erro interno. Tente novamente em instantes.');
  });
}

module.exports = { criarBase, finalizar, a, limiteAuth, csrfProtection };
