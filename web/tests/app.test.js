const test = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');

test('rotas da API', async (t) => {
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  t.after(() => server.close());

  const health = await fetch(`${base}/health`);
  assert.strictEqual(health.status, 200);

  const invalido = await fetch(`${base}/api/codigo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'x' }),
  });
  assert.strictEqual(invalido.status, 400);

  const valido = await fetch(`${base}/api/codigo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'aluno@escola.edu.br' }),
  });
  assert.strictEqual(valido.status, 200);
});
