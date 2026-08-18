
/* ── Chart.js global defaults ──────────────────────────────── */
Chart.defaults.color = '#94a3b8';
Chart.defaults.font.family = "'Inter', sans-serif";

/* ── Colour palette ─────────────────────────────────────────── */
const ACCENT   = '#6366f1';
const ACCENT2  = '#8b5cf6';
const ACCENT3  = '#06b6d4';
const HIT_C    = '#10b981';
const FLOP_C   = '#ef4444';

/* ── State ──────────────────────────────────────────────────── */
let charts = {};         // keyed by chart id
let datasetStats = {};   // from /dataset-stats

/* ── Utility ────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

function hexToRgba(hex, a = 1) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

/* ─────────────────────────────────────────────────────────────
   1. INIT – load dataset stats and render seed charts
   ───────────────────────────────────────────────────────────── */
async function initDashboard() {
  try {
    const res = await fetch('/dataset-stats');
    datasetStats = await res.json();
    updateStatStrip(datasetStats);
    renderFeatureImportanceStatic(datasetStats.feature_importance || []);
    renderHeatmap(datasetStats.correlation || {});
    renderHistogram(datasetStats.vote_sample || [], 'Vote Average');
    renderLineChart(datasetStats.pop_labels || [], datasetStats.pop_values || []);
    renderBarChart({budget: 500_000_000, budgetCr: 50, popularity:25, runtime:110, vote_average:6.5}, true);
    renderPieChart(50, 50);
    renderGauge(50);
  } catch(e) {
    console.warn('Could not load dataset stats:', e);
  }
}

function updateStatStrip(stats) {
  if (!stats.total_movies) return;
  $('statMovies').textContent = (stats.total_movies || 0).toLocaleString();
  $('statHits').textContent   = (stats.hit_count   || 0).toLocaleString();
  $('statFlops').textContent  = (stats.flop_count  || 0).toLocaleString();
  $('statAcc').textContent    = stats.accuracy ? (stats.accuracy * 100).toFixed(1) + '%' : '–';
}

/* ─────────────────────────────────────────────────────────────
   2. FORM – sync sliders with inputs
   ───────────────────────────────────────────────────────────── */
document.querySelectorAll('.sync-input').forEach(inp => {
  const sliderId = inp.id + '_slider';
  const slider   = $(sliderId);
  const labelId  = inp.id + '_val';
  if (!slider) return;

  // input → slider
  inp.addEventListener('input', () => {
    slider.value = inp.value;
    if ($(labelId)) $(labelId).textContent = inp.value;
  });

  // slider → input
  slider.addEventListener('input', () => {
    inp.value = slider.value;
    if ($(labelId)) $(labelId).textContent = slider.value;
  });
});

/* ─────────────────────────────────────────────────────────────
   3. PREDICTION
   ───────────────────────────────────────────────────────────── */
$('predictBtn').addEventListener('click', async () => {
  const budget       = parseFloat($('budget').value);   // entered in Crore ₹
  const popularity   = parseFloat($('popularity').value);
  const runtime      = parseFloat($('runtime').value);
  const vote_average = parseFloat($('vote_average').value);

  if ([budget, popularity, runtime, vote_average].some(isNaN)) {
    alert('Please fill in all four fields.');
    return;
  }

  // Convert Crore ₹ → raw number (1 Crore = 1,00,00,000)
  const budgetRaw = budget * 10_000_000;

  setLoading(true);

  try {
    const res  = await fetch('/predict', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ budget: budgetRaw, popularity, runtime, vote_average }),
    });
    const data = await res.json();

    if (data.error) { alert(data.error); return; }

    // Attach display-friendly Crore value for the bar chart
    data.inputs.budgetCr = budget;
    displayResult(data);
    updateAllCharts(data);
  } catch (e) {
    alert('Prediction failed. Is the server running?');
    console.error(e);
  } finally {
    setLoading(false);
  }
});


function setLoading(on) {
  const btn     = $('predictBtn');
  const spinner = $('spinner');
  const btnText = $('btnText');
  btn.disabled  = on;
  spinner.style.display = on ? 'block' : 'none';
  btnText.style.display = on ? 'none'  : 'block';
  if (on) btn.classList.add('predicting');
  else    btn.classList.remove('predicting');
}

function displayResult(data) {
  const card = $('resultCard');
  const isHit = data.prediction === 'Hit';

  card.className = 'result-card ' + (isHit ? 'hit' : 'flop');
  $('resultLabel').textContent = isHit ? '🎉 HIT' : '❌ FLOP';
  $('resultProb').innerHTML    =
    `Confidence: <strong>${data.probability}%</strong>`;
  card.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ─────────────────────────────────────────────────────────────
   4. UPDATE ALL CHARTS
   ───────────────────────────────────────────────────────────── */
function updateAllCharts(data) {
  renderBarChart(data.inputs);
  renderPieChart(data.hit_prob, data.flop_prob);
  renderGauge(data.hit_prob);
  // Line & histogram stay dataset-driven
}

/* ─────────────────────────────────────────────────────────────
   5. BAR CHART – input feature values
   ───────────────────────────────────────────────────────────── */
function renderBarChart(inputs, seed = false) {
  destroyChart('barChart');

  const labels = ['Budget (Cr ₹)', 'Popularity', 'Runtime (min)', 'Vote Avg'];
  const values = [
    // budgetCr is set when coming from a real prediction; inputs.budget is raw
    +(inputs.budgetCr !== undefined ? inputs.budgetCr : (inputs.budget / 10_000_000)).toFixed(2),
    +inputs.popularity.toFixed(2),
    +inputs.runtime.toFixed(2),
    +inputs.vote_average.toFixed(2),
  ];

  charts['barChart'] = new Chart($('barChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Input Value',
        data:  values,
        backgroundColor: [
          hexToRgba(ACCENT,  0.75),
          hexToRgba(ACCENT2, 0.75),
          hexToRgba(ACCENT3, 0.75),
          hexToRgba('#f59e0b', 0.75),
        ],
        borderColor: [ACCENT, ACCENT2, ACCENT3, '#f59e0b'],
        borderWidth: 2,
        borderRadius: 8,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.parsed.y}`,
          },
        },
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true },
      },
    },
  });
}

/* ─────────────────────────────────────────────────────────────
   6. PIE CHART – Hit vs Flop probability
   ───────────────────────────────────────────────────────────── */
function renderPieChart(hitPct, flopPct) {
  destroyChart('pieChart');

  charts['pieChart'] = new Chart($('pieChart'), {
    type: 'doughnut',
    data: {
      labels: ['Hit', 'Flop'],
      datasets: [{
        data: [hitPct, flopPct],
        backgroundColor: [hexToRgba(HIT_C, 0.8), hexToRgba(FLOP_C, 0.8)],
        borderColor:     [HIT_C, FLOP_C],
        borderWidth: 2,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      animation: { animateRotate: true, duration: 800 },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { padding: 16, usePointStyle: true },
        },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed.toFixed(1)}%` },
        },
      },
    },
  });
}

/* ─────────────────────────────────────────────────────────────
   7. LINE CHART – Popularity vs Success likelihood
   ───────────────────────────────────────────────────────────── */
function renderLineChart(labels, values) {
  destroyChart('lineChart');

  if (!labels.length) {
    // Default seed line
    labels = Array.from({length:10},(_,i)=>`P${i+1}`);
    values = [0.1,0.15,0.22,0.30,0.40,0.55,0.65,0.70,0.78,0.85];
  }

  charts['lineChart'] = new Chart($('lineChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Success Likelihood',
        data:  values.map(v => +(v*100).toFixed(1)),
        borderColor: ACCENT3,
        backgroundColor: hexToRgba(ACCENT3, 0.12),
        borderWidth: 2.5,
        fill: true,
        tension: 0.45,
        pointRadius: 3,
        pointHoverRadius: 6,
        pointBackgroundColor: ACCENT3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 700 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.parsed.y.toFixed(1)}%` },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { maxTicksLimit: 6, maxRotation: 0, font: { size: 9 } },
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          beginAtZero: true,
          max: 100,
          ticks: { callback: v => v + '%' },
        },
      },
    },
  });
}

/* ─────────────────────────────────────────────────────────────
   8. HISTOGRAM – Vote Average distribution
   ───────────────────────────────────────────────────────────── */
function renderHistogram(samples, label = 'Value') {
  destroyChart('histChart');

  if (!samples.length) {
    samples = Array.from({length:100},()=>(Math.random()*4+4).toFixed(1)).map(Number);
  }

  // Bin into 15 buckets
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const binCount = 15;
  const binSize  = (max - min) / binCount || 1;
  const bins     = Array(binCount).fill(0);
  samples.forEach(v => {
    const idx = Math.min(Math.floor((v - min) / binSize), binCount - 1);
    bins[idx]++;
  });
  const binLabels = Array.from({length: binCount}, (_, i) =>
    (min + i * binSize).toFixed(1)
  );

  charts['histChart'] = new Chart($('histChart'), {
    type: 'bar',
    data: {
      labels: binLabels,
      datasets: [{
        label,
        data:  bins,
        backgroundColor: hexToRgba(ACCENT2, 0.7),
        borderColor:     ACCENT2,
        borderWidth: 1,
        borderRadius: 4,
        borderSkipped: false,
        barPercentage: 1.0,
        categoryPercentage: 1.0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: ctx => `Around ${ctx[0].label}`,
            label: ctx => ` Count: ${ctx.parsed.y}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 8, font: { size: 9 } },
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          beginAtZero: true,
        },
      },
    },
  });
}

/* ─────────────────────────────────────────────────────────────
   9. GAUGE – speedometer-style hit probability
   ───────────────────────────────────────────────────────────── */
function renderGauge(hitPct) {
  destroyChart('gaugeChart');

  const pct   = Math.min(Math.max(hitPct, 0), 100);
  const ratio = pct / 100;

  // Gauge is a doughnut rotated by 180°
  charts['gaugeChart'] = new Chart($('gaugeChart'), {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [pct, 100 - pct, 100],   // filled, empty, hidden half
        backgroundColor: [
          pct >= 50 ? hexToRgba(HIT_C, 0.85) : hexToRgba(FLOP_C, 0.85),
          'rgba(255,255,255,0.06)',
          'rgba(0,0,0,0)',              // bottom half hidden
        ],
        borderColor: ['transparent','transparent','transparent'],
        borderWidth: 0,
        circumference: 180,
        rotation: 270,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      animation: { duration: 900, easing: 'easeOutQuart' },
      plugins: {
        legend:  { display: false },
        tooltip: { enabled: false },
      },
    },
  });

  // Update centre label
  $('gaugeValue').textContent = pct.toFixed(1) + '%';
  $('gaugeValue').style.color = pct >= 50 ? HIT_C : FLOP_C;
}

/* ─────────────────────────────────────────────────────────────
   10. FEATURE IMPORTANCE – inline bars
   ───────────────────────────────────────────────────────────── */
function renderFeatureImportanceStatic(importances) {
  const features = ['budget', 'popularity', 'runtime', 'vote_average'];
  const colors   = [ACCENT, ACCENT2, ACCENT3, '#f59e0b'];
  const container = $('featImportance');
  if (!container) return;

  // Default if model not yet trained
  const vals = importances.length ? importances : [0.38, 0.28, 0.16, 0.18];
  const max  = Math.max(...vals);
  container.innerHTML = '';

  features.forEach((name, i) => {
    const pct = ((vals[i] / max) * 100).toFixed(1);
    const row = document.createElement('div');
    row.className = 'feat-bar-row';
    row.innerHTML = `
      <div class="feat-bar-label">${name.replace('_', ' ')}</div>
      <div class="feat-bar-track">
        <div class="feat-bar-fill" data-pct="${pct}" style="background: linear-gradient(90deg, ${colors[i]}, ${ACCENT3})"></div>
      </div>
      <div class="feat-bar-pct">${(vals[i]*100).toFixed(1)}%</div>`;
    container.appendChild(row);
  });

  // Animate fills after rendering
  requestAnimationFrame(() => {
    document.querySelectorAll('.feat-bar-fill').forEach(el => {
      el.style.width = el.dataset.pct + '%';
    });
  });
}

/* ─────────────────────────────────────────────────────────────
   11. HEATMAP – feature correlation
   ───────────────────────────────────────────────────────────── */
function renderHeatmap(corr) {
  const features = ['budget', 'popularity', 'runtime', 'vote_average'];
  const labels   = ['Budget', 'Popularity', 'Runtime', 'Vote Avg'];
  const container = $('heatmapGrid');
  if (!container) return;
  container.innerHTML = '';

  // Default correlation if missing
  const defaultCorr = {
    budget:       { budget:1,     popularity:0.26,  runtime:0.28, vote_average:0.09 },
    popularity:   { budget:0.26,  popularity:1,     runtime:0.11, vote_average:0.19 },
    runtime:      { budget:0.28,  popularity:0.11,  runtime:1,    vote_average:0.21 },
    vote_average: { budget:0.09,  popularity:0.19,  runtime:0.21, vote_average:1    },
  };
  const data = Object.keys(corr).length ? corr : defaultCorr;

  function corrColor(v) {
    // -1 → red, 0 → dark, 1 → blue
    if (v >= 0) {
      const i = Math.round(v * 100);
      return `rgba(99,102,241,${0.15 + v * 0.70})`;
    } else {
      return `rgba(239,68,68,${0.15 + Math.abs(v) * 0.70})`;
    }
  }

  // Header row (empty corner + column labels)
  const corner = document.createElement('div');
  corner.className = 'hm-header';
  container.appendChild(corner);

  labels.forEach(l => {
    const h = document.createElement('div');
    h.className = 'hm-header';
    h.textContent = l;
    container.appendChild(h);
  });

  // Data rows
  features.forEach((row, ri) => {
    const rowLabel = document.createElement('div');
    rowLabel.className = 'hm-label';
    rowLabel.title = labels[ri];
    rowLabel.textContent = labels[ri];
    container.appendChild(rowLabel);

    features.forEach(col => {
      const val = (data[row]?.[col] ?? 0);
      const cell = document.createElement('div');
      cell.className = 'hm-cell';
      cell.style.background = corrColor(val);
      cell.style.color = Math.abs(val) > 0.5 ? '#fff' : '#94a3b8';
      cell.textContent = val.toFixed(2);
      cell.title = `${labels[ri]} ↔ ${labels[features.indexOf(col)]}: ${val.toFixed(3)}`;
      container.appendChild(cell);
    });
  });
}

/* ─────────────────────────────────────────────────────────────
   12. RESET
   ───────────────────────────────────────────────────────────── */
$('resetBtn').addEventListener('click', () => {
  $('budget').value       = '';
  $('popularity').value   = '';
  $('runtime').value      = '';
  $('vote_average').value = '';

  // Reset sliders
  ['budget','popularity','runtime','vote_average'].forEach(id => {
    const slider = $(id + '_slider');
    if (slider) slider.value = slider.min;
    const val = $(id + '_val');
    if (val) val.textContent = slider ? slider.min : '';
  });

  $('resultCard').style.display = 'none';

  // Re-initialize charts to seed state
  renderBarChart({budget: 500_000_000, budgetCr: 50, popularity:25, runtime:110, vote_average:6.5}, true);
  renderPieChart(50, 50);
  renderGauge(50);
});

/* ─────────────────────────────────────────────────────────────
   BOOT
   ───────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', initDashboard);
