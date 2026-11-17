const test = require('node:test');
const assert = require('node:assert');
const { gerarCodigo, hashCodigo, codigoValido, emailValido } = require('../src/codigo');

test('gera código de 6 dígitos', () => {
  assert.match(gerarCodigo(), /^\d{6}$/);
});

test('valida código correto e rejeita incorreto', () => {
  const hash = hashCodigo('123456', 'salt');
  assert.ok(codigoValido('123456', 'salt', hash));
  assert.ok(!codigoValido('654321', 'salt', hash));
});

test('valida formato de e-mail', () => {
  assert.ok(emailValido('aluno@escola.edu.br'));
  assert.ok(!emailValido('nao-e-email'));
  assert.ok(!emailValido(undefined));
});
