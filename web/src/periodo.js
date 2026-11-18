'use strict';

// Status do período da votação e datas no fuso de Brasília.
function statusPeriodo(votacao, agora = new Date()) {
  if (agora < new Date(votacao.inicio)) return 'agendada';
  if (agora >= new Date(votacao.fim)) return 'encerrada';
  return 'aberta';
}

function formatarData(data) {
  return new Date(data).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}

// Valor de <input type="datetime-local"> (sem fuso) interpretado no horário de Brasília
function lerDataLocal(valor, offset = '-03:00') {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(valor || ''))) return null;
  const d = new Date(`${valor}:00${offset}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// linhas: [{ nome, votos }] já agregadas pelo banco; inclui candidatos com 0 voto
function resultadoAgregado(linhas, totalAptos) {
  const lista = linhas.map((c) => ({ ...c, votos: Number(c.votos) || 0 }));
  const totalVotos = lista.reduce((s, c) => s + c.votos, 0);
  const aptos = Number(totalAptos) || 0;
  return {
    totalVotos,
    totalAptos: aptos,
    participacao: aptos ? Math.round((totalVotos / aptos) * 1000) / 10 : 0,
    candidatos: lista
      .map((c) => ({ ...c, percentual: totalVotos ? Math.round((c.votos / totalVotos) * 10000) / 100 : 0 }))
      .sort((x, y) => y.votos - x.votos || String(x.nome).localeCompare(String(y.nome))),
  };
}

module.exports = { statusPeriodo, formatarData, lerDataLocal, resultadoAgregado };
