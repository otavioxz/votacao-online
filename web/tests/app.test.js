const test = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const { criarApp } = require('../src/app');

// Banco falso: registra as consultas e devolve linhas pré-definidas
function bancoFalso(respostas = {}) {
  const consultas = [];
  return {
    consultas,
    async query(sql, params) {
      consultas.push({ sql, params });
      for (const [trecho, rows] of Object.entries(respostas)) {
        if (sql.includes(trecho)) return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
    async transacao(fn) {
      return fn(this);
    },
  };
}

function iniciar(t, instancia) {
  const server = instancia.listen(0);
  t.after(() => server.close());
  const base = `http://localhost:${server.address().port}`;
  let cookie = '';
  return async (caminho, opcoes = {}) => {
    const res = await fetch(base + caminho, { redirect: 'manual', ...opcoes, headers: { cookie, ...(opcoes.headers || {}) } });
    const set = res.headers.getSetCookie().map((c) => c.split(';')[0]);
    if (set.length) cookie = set.join('; ');
    return { status: res.status, location: res.headers.get('location'), texto: await res.text() };
  };
}

const csrf = (texto) => (texto.match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1];
const form = (dados) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(dados).toString(),
});

const agora = Date.now();
const votacaoAberta = { id: 1, nome: 'Representante <b>Turma</b>', inicio: new Date(agora - 60e3), fim: new Date(agora + 3600e3) };

test('health check sem banco', async (t) => {
  const req = iniciar(t, app);
  const r = await req('/health');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(JSON.parse(r.texto), { status: 'ok', app: 'web' });
});

test('lista votações escapando HTML (XSS)', async (t) => {
  const req = iniciar(t, criarApp({ db: bancoFalso({ 'FROM votacoes ORDER BY': [votacaoAberta] }) }));
  const r = await req('/');
  assert.strictEqual(r.status, 200);
  assert.ok(r.texto.includes('Representante &lt;b&gt;Turma&lt;/b&gt;'));
  assert.ok(r.texto.includes('/votacao/1'));
});

test('POST sem token CSRF é bloqueado', async (t) => {
  const req = iniciar(t, criarApp({ db: bancoFalso() }));
  const r = await req('/auth/solicitar-codigo', form({ votacao_id: '1', email: 'aluno@escola.edu.br' }));
  assert.strictEqual(r.status, 403);
});

test('e-mail inválido retorna 400; válido recebe resposta genérica', async (t) => {
  const enviados = [];
  const db = bancoFalso({ 'FROM votacoes WHERE id': [votacaoAberta], 'UPDATE eleitores_aptos SET codigo_hash': [{ id: 7 }] });
  const req = iniciar(t, criarApp({ db, enviarCodigo: async (para, codigo) => enviados.push({ para, codigo }) }));

  const pagina = await req('/votacao/1');
  const token = csrf(pagina.texto);
  assert.ok(token);

  const invalido = await req('/auth/solicitar-codigo', form({ _csrf: token, votacao_id: '1', email: 'x' }));
  assert.strictEqual(invalido.status, 400);

  const valido = await req('/auth/solicitar-codigo', form({ _csrf: token, votacao_id: '1', email: 'Aluno@Escola.edu.br' }));
  assert.strictEqual(valido.location, '/votacao/1/codigo');
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0].para, 'aluno@escola.edu.br');
  assert.match(enviados[0].codigo, /^\d{6}$/);
  // o código nunca é gravado em texto puro
  const update = db.consultas.find((c) => c.sql.includes('UPDATE eleitores_aptos SET codigo_hash'));
  assert.ok(!update.params.includes(enviados[0].codigo));
});

test('cédula exige código validado', async (t) => {
  const req = iniciar(t, criarApp({ db: bancoFalso({ 'FROM votacoes WHERE id': [votacaoAberta] }) }));
  const r = await req('/votacao/1/cedula');
  assert.strictEqual(r.location, '/votacao/1');
});
