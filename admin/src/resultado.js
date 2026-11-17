// Percentual de cada candidato (alimenta o gráfico de pizza/barras do dashboard)
function calcularResultado(votos) {
  const total = votos.length;
  const contagem = {};
  for (const v of votos) contagem[v.candidato] = (contagem[v.candidato] || 0) + 1;
  return Object.entries(contagem)
    .map(([candidato, qtd]) => ({
      candidato,
      votos: qtd,
      percentual: total ? Math.round((qtd / total) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.votos - a.votos);
}

// Domínio sem pontos repetidos: evita backtracking (ReDoS) apontado pelo CodeQL
const EMAIL_REGEX = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

// Importa e-mails aptos de um CSV (uma coluna "email"), sem duplicados
function parseEleitoresCsv(csv) {
  const linhas = csv.split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean);
  if (linhas[0] === 'email') linhas.shift();
  return [...new Set(linhas.filter((l) => l.length <= 254 && EMAIL_REGEX.test(l)))];
}

// A votação só aceita votos dentro do período definido pela comissão
function votacaoAberta(votacao, agora = new Date()) {
  return agora >= new Date(votacao.inicio) && agora <= new Date(votacao.fim);
}

module.exports = { calcularResultado, parseEleitoresCsv, votacaoAberta };
