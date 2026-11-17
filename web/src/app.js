const express = require('express');
const helmet = require('helmet');
const { emailValido } = require('./codigo');

const app = express();
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

app.get('/health', (req, res) => res.json({ status: 'ok', app: 'web' }));

app.get('/', (req, res) => {
  res.send('<h1>Sistema de Votação</h1><p>Informe seu e-mail cadastrado para receber o código.</p>');
});

// TODO: buscar eleitor no RDS, gerar código, salvar hash e enviar por SMTP
app.post('/api/codigo', (req, res) => {
  if (!emailValido(req.body?.email)) {
    return res.status(400).json({ erro: 'E-mail inválido' });
  }
  // Resposta genérica: não revela se o e-mail está ou não cadastrado
  res.json({ mensagem: 'Se o e-mail estiver cadastrado, você receberá um código.' });
});

module.exports = app;
