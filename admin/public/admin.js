/* global Chart */
(function () {
  'use strict';

  // Leitura do CSV no navegador para o textarea (sem upload multipart no servidor)
  var arquivo = document.getElementById('arquivoCsv');
  if (arquivo) {
    arquivo.addEventListener('change', function () {
      var f = arquivo.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        document.getElementById('csv').value = reader.result;
      };
      reader.readAsText(f);
    });
  }

  var el = document.getElementById('dados-graficos');
  if (!el || typeof Chart === 'undefined') return;
  var d = JSON.parse(el.textContent);
  var cores = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

  new Chart(document.getElementById('graficoParticipacao'), {
    type: 'pie',
    data: {
      labels: ['Votaram', 'Ainda não votaram'],
      datasets: [{ data: [d.votantes, Math.max(d.aptos - d.votantes, 0)], backgroundColor: ['#16a34a', '#cbd5e1'] }],
    },
    options: { plugins: { legend: { position: 'bottom' } } },
  });

  if (!d.candidatos) return;
  var nomes = d.candidatos.map(function (c) { return c.nome; });

  new Chart(document.getElementById('graficoPizza'), {
    type: 'pie',
    data: {
      labels: nomes,
      datasets: [{ data: d.candidatos.map(function (c) { return c.percentual; }), backgroundColor: cores }],
    },
    options: {
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: function (ctx) { return ctx.label + ': ' + ctx.parsed + '%'; } } },
      },
    },
  });

  new Chart(document.getElementById('graficoBarras'), {
    type: 'bar',
    data: {
      labels: nomes,
      datasets: [{ label: 'Votos', data: d.candidatos.map(function (c) { return c.votos; }), backgroundColor: cores }],
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
})();
