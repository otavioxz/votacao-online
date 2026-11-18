const test = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const { criarApp } = require('../src/app');

function bancoFalso() {
  return { query: async () => ({ rows: [], rowCount: 0 }), transacao: async (fn) => fn(this) };
}

function iniciar(t, instancia) {
  const server = instancia.listen(0);
  t.after(() => server.close());
  return (caminho) => fetch(`http://localhost:${server.address().port}${caminho}`, { redirect: 'manual' });
}

test('health check', async (t) => {
  const req = iniciar(t, app);
  const res = await req('/health');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { status: 'ok', app: 'admin' });
  // caminho usado pelo health check do ALB (regra /admin*)
  assert.strictEqual((await req('/admin/health')).status, 200);
});

test('painel exige login da comissão', async (t) => {
  const req = iniciar(t, criarApp({ db: bancoFalso(), adminEmails: 'comissao@escola.br' }));
  const res = await req('/admin');
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.get('location'), '/admin/login');
  assert.strictEqual((await req('/admin/auditoria')).headers.get('location'), '/admin/login');
});

test('página de login tem token CSRF e cabeçalhos de segurança', async (t) => {
  const req = iniciar(t, criarApp({ db: bancoFalso() }));
  const res = await req('/admin/login');
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /name="_csrf" value="[a-f0-9]{32}"/);
  assert.ok(res.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.strictEqual(res.headers.get('x-frame-options'), 'SAMEORIGIN');
});
