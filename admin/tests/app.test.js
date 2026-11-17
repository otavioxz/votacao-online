const test = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');

test('health check', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  const res = await fetch(`http://localhost:${server.address().port}/health`);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { status: 'ok', app: 'admin' });
});
