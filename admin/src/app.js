const express = require('express');
const helmet = require('helmet');

const app = express();
app.use(helmet());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => res.json({ status: 'ok', app: 'admin' }));

// TODO: autenticação da comissão; rotas de votação, candidatos, CSV e dashboard
app.get('/', (req, res) => {
  res.send('<h1>Painel da Comissão Eleitoral</h1>');
});

module.exports = app;
