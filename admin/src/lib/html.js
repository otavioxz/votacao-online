'use strict';

// Template HTML com escape automático (proteção contra XSS na própria aplicação,
// além do WAF). Todo valor interpolado é escapado, exceto o que for marcado com raw().

class SafeHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(render).join('');
  if (value instanceof SafeHtml) return value.value;
  return esc(value);
}

function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1];
  });
  return new SafeHtml(out);
}

const raw = (s) => new SafeHtml(String(s));

// JSON seguro para embutir em <script type="application/json">
function jsonForHtml(data) {
  return raw(JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026'));
}

const csrfField = (token) => html`<input type="hidden" name="_csrf" value="${token}">`;

function layout({ title, body, area = 'web', usuario = null, csrf = '', flash = null }) {
  const base = area === 'admin' ? '/admin' : '';
  return html`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Votação Online</title>
<link rel="stylesheet" href="${base}/static/style.css">
</head>
<body>
<header class="topo"><div class="wrap topo-in">
  <a class="marca" href="${base || '/'}">Votação Online${area === 'admin' ? ' · Comissão Eleitoral' : ''}</a>
  ${usuario
    ? html`<nav>
      <a href="/admin">Votações</a>
      <a href="/admin/auditoria">Auditoria</a>
      <form method="post" action="/admin/logout" class="inline">${csrfField(csrf)}<button class="link">Sair (${usuario})</button></form>
    </nav>`
    : ''}
</div></header>
<main class="wrap">
${flash ? html`<div class="alerta ${flash.tipo}">${flash.texto}</div>` : ''}
${body}
</main>
<footer class="wrap rodape">Eleições de representantes estudantis · AWS (WAF · ALB · EC2 · RDS)</footer>
${area === 'admin' ? raw('<script src="/admin/static/chart.umd.js"></script><script src="/admin/static/admin.js"></script>') : ''}
</body>
</html>`;
}

module.exports = { html, raw, esc, layout, csrfField, jsonForHtml, SafeHtml };
