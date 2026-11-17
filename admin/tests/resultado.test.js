const test = require('node:test');
const assert = require('node:assert');
const { calcularResultado, parseEleitoresCsv, votacaoAberta } = require('../src/resultado');

test('calcula percentual por candidato', () => {
  const r = calcularResultado([{ candidato: 'A' }, { candidato: 'A' }, { candidato: 'B' }, { candidato: 'A' }]);
  assert.deepStrictEqual(r, [
    { candidato: 'A', votos: 3, percentual: 75 },
    { candidato: 'B', votos: 1, percentual: 25 },
  ]);
});

test('resultado vazio sem votos', () => {
  assert.deepStrictEqual(calcularResultado([]), []);
});

test('importa CSV ignorando cabeçalho, inválidos e duplicados', () => {
  const csv = 'email\nA@escola.br\na@escola.br\ninvalido\n\nb@escola.br';
  assert.deepStrictEqual(parseEleitoresCsv(csv), ['a@escola.br', 'b@escola.br']);
});

test('verifica período da votação', () => {
  const v = { inicio: '2026-01-01T00:00:00Z', fim: '2026-01-02T00:00:00Z' };
  assert.ok(votacaoAberta(v, new Date('2026-01-01T12:00:00Z')));
  assert.ok(!votacaoAberta(v, new Date('2026-01-03T00:00:00Z')));
});
