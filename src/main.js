import { parseCsv, groupBySymbol, persistData, loadStoredData, clearStorage } from './data.js';
import { enrichSymbolData, evaluateSignal, evaluateHistory } from './indicators.js';

const state = {
  rows: [],
  symbols: {},
  enriched: {},
  latest: [],
  selected: null,
  settings: {
    resistanceLookback: 30,
    compressionWidth: 0.08,
    relativeLookback: 20,
    breakoutBuffer: 0.003,
    atrMultiplier: 1.2,
    successPct: 5,
    successDays: 10
  }
};

const elements = {
  tableBody: document.querySelector('#signalTable tbody'),
  signalFilter: document.getElementById('signalFilter'),
  scoreMin: document.getElementById('scoreMin'),
  volSpikeMin: document.getElementById('volSpikeMin'),
  symbolSearch: document.getElementById('symbolSearch'),
  priceCanvas: document.getElementById('priceChart'),
  volumeCanvas: document.getElementById('volumeChart'),
  detailSymbol: document.getElementById('detailSymbol'),
  detailDescription: document.getElementById('detailDescription'),
  detailScore: document.getElementById('detailScore'),
  breakdown: document.getElementById('indicatorBreakdown'),
  historyPanel: document.getElementById('historyPanel'),
  targetPct: document.getElementById('targetPct'),
  targetDays: document.getElementById('targetDays'),
  bollingerToggle: document.getElementById('bollingerToggle'),
  csvInput: document.getElementById('csvInput'),
  clearData: document.getElementById('clearData')
};

function loadInitialData() {
  const stored = loadStoredData();
  if (stored.length) {
    state.rows = stored;
    rebuild();
  }
}

function rebuild() {
  state.symbols = groupBySymbol(state.rows);
  const indexSeries = state.symbols['KSE100'] || [];
  state.enriched = {};
  state.latest = [];

  Object.entries(state.symbols).forEach(([symbol, series]) => {
    const enriched = enrichSymbolData(series, indexSeries, state.settings);
    state.enriched[symbol] = enriched;
    const latestPoint = enriched[enriched.length - 1];
    const scored = evaluateSignal(latestPoint, state.settings);
    state.latest.push({ symbol, ...latestPoint, ...scored });
  });
  renderTable();
}

function renderTable() {
  elements.tableBody.innerHTML = '';
  const filterSignal = elements.signalFilter.value;
  const minScore = Number(elements.scoreMin.value) || 0;
  const minVol = Number(elements.volSpikeMin.value) || 0;
  const search = elements.symbolSearch.value.toUpperCase();

  const rows = state.latest
    .filter(r => r.symbol !== 'KSE100')
    .filter(r => (filterSignal === 'all' ? true : r.signal === filterSignal))
    .filter(r => r.total >= minScore)
    .filter(r => (r.volSpike || 0) >= minVol)
    .filter(r => r.symbol.includes(search))
    .sort((a, b) => b.total - a.total);

  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.classList.add('table-row-enter');
    tr.addEventListener('animationend', () => tr.classList.remove('table-row-enter'));
    tr.onclick = () => selectSymbol(r.symbol);

    tr.innerHTML = `
      <td>${r.symbol}</td>
      <td><span class="signal-chip signal-${r.signal}">${r.signal}</span></td>
      <td>
        <div class="score-bar"><div class="score-fill" style="width:${Math.min(r.total, 15) / 15 * 100}%"></div></div>
        <div>${r.total} pts</div>
      </td>
      <td class="highlight">
        <span>Vol ${r.volSpike ? r.volSpike.toFixed(2) + 'x' : 'n/a'}</span>
        <span>BB ${(r.bbWidth || 0).toFixed(2)}</span>
        <span>Near R ${(r.proximity || 0).toFixed(2)}</span>
      </td>
      <td>${r.stopLoss ? r.stopLoss.toFixed(2) : 'n/a'}</td>
    `;
    elements.tableBody.appendChild(tr);
  });

  if (!rows.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="5">Upload CSV to see scores.</td>';
    elements.tableBody.appendChild(tr);
  }
}

function selectSymbol(symbol) {
  state.selected = symbol;
  const series = state.enriched[symbol];
  if (!series) return;
  const latest = series[series.length - 1];
  const score = evaluateSignal(latest, state.settings);
  elements.detailSymbol.textContent = symbol;
  elements.detailScore.textContent = score.total;
  elements.detailScore.style.transform = 'scale(1.06)';
  setTimeout(() => { elements.detailScore.style.transform = 'scale(1)'; }, 300);

  elements.detailDescription.textContent = `${score.signal} setup • Stop guidance ${score.stopLoss ? score.stopLoss.toFixed(2) : 'n/a'}`;
  renderBreakdown(score.breakdown);
  renderHistory(symbol, series);
  renderCharts(series);
}

function renderBreakdown(items) {
  elements.breakdown.innerHTML = '';
  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'breakdown-card';
    card.innerHTML = `
      <div class="breakdown-title">${item.name}</div>
      <div class="breakdown-score">${item.value.toFixed(1)} pts</div>
      <p class="breakdown-note">${item.note}</p>
    `;
    elements.breakdown.appendChild(card);
  });
}

function renderHistory(symbol, series) {
  const stats = evaluateHistory(series, state.settings);
  const totalSignals = Object.values(stats).reduce((a, b) => a + b.total, 0);
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <h3>Historical validation</h3>
    <p class="muted">${totalSignals} similar setups on this symbol. Success = hit ${state.settings.successPct}% within ${state.settings.successDays} sessions.</p>
    <div class="history-grid">
      ${['Watch','Prepare','Enter'].map(key => {
        const item = stats[key];
        const rate = item.total ? Math.round((item.hit / item.total) * 100) : 0;
        return `<div class="history-card"><strong>${key}</strong><div>${item.hit}/${item.total} hit (${rate}%)</div></div>`;
      }).join('')}
    </div>
  `;
  elements.historyPanel.innerHTML = '';
  elements.historyPanel.appendChild(wrap);
}

function renderCharts(series) {
  drawPriceChart(elements.priceCanvas, series, {
    showBollinger: elements.bollingerToggle.checked,
    resistance: series[series.length - 1].resistance
  });
  drawVolumeChart(elements.volumeCanvas, series);
}

function drawPriceChart(canvas, data, opts) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!data || !data.length) return;
  const padding = { left: 60, right: 20, top: 20, bottom: 24 };
  const width = canvas.width - padding.left - padding.right;
  const height = canvas.height - padding.top - padding.bottom;
  const slice = data.slice(-120);
  const prices = slice.flatMap(d => [d.high, d.low, d.upper ?? d.high, d.lower ?? d.low]);
  const min = Math.min(...prices.filter(Boolean));
  const max = Math.max(...prices.filter(Boolean));
  const xStep = width / Math.max(1, slice.length - 1);

  ctx.strokeStyle = '#334155';
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let i = 0; i <= 4; i++) {
    const yVal = padding.top + (height * i) / 4;
    ctx.strokeStyle = '#1f2937';
    ctx.beginPath();
    ctx.moveTo(padding.left, yVal);
    ctx.lineTo(canvas.width - padding.right, yVal);
    ctx.stroke();
    const price = max - ((max - min) * i) / 4;
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(price.toFixed(2), padding.left - 6, yVal);
  }

  const scaleY = val => padding.top + ((max - val) / (max - min)) * height;

  // Bollinger Bands
  if (opts.showBollinger) {
    ctx.strokeStyle = 'rgba(30,127,191,0.4)';
    ctx.fillStyle = 'rgba(30,127,191,0.08)';
    ctx.beginPath();
    slice.forEach((d, i) => {
      if (d.upper == null) return;
      const x = padding.left + i * xStep;
      const y = scaleY(d.upper);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    slice.slice().reverse().forEach((d, idx) => {
      if (d.lower == null) return;
      const i = slice.length - 1 - idx;
      const x = padding.left + i * xStep;
      const y = scaleY(d.lower);
      ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
  }

  // Moving averages
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  slice.forEach((d, i) => {
    if (d.ma20 == null) return;
    const x = padding.left + i * xStep;
    const y = scaleY(d.ma20);
    if (ctx.currentPath === undefined || i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.strokeStyle = '#f97316';
  ctx.beginPath();
  slice.forEach((d, i) => {
    if (d.ma50 == null) return;
    const x = padding.left + i * xStep;
    const y = scaleY(d.ma50);
    if (ctx.currentPath === undefined || i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Candles
  slice.forEach((d, i) => {
    const x = padding.left + i * xStep;
    const candleWidth = Math.max(3, xStep * 0.6);
    const color = d.close >= d.open ? '#16a34a' : '#ef4444';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;

    ctx.beginPath();
    ctx.moveTo(x, scaleY(d.high));
    ctx.lineTo(x, scaleY(d.low));
    ctx.stroke();

    const yOpen = scaleY(d.open);
    const yClose = scaleY(d.close);
    const top = Math.min(yOpen, yClose);
    const bodyHeight = Math.max(1, Math.abs(yClose - yOpen));
    ctx.fillRect(x - candleWidth / 2, top, candleWidth, bodyHeight);
  });

  // Resistance line
  if (opts.resistance) {
    ctx.strokeStyle = 'rgba(244,128,36,0.8)';
    ctx.lineWidth = 1.2;
    const y = scaleY(opts.resistance);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(canvas.width - padding.right, y);
    ctx.stroke();
    ctx.fillStyle = '#f59e0b';
    ctx.fillText('Resistance', canvas.width - padding.right - 6, y - 10);
  }
}

function drawVolumeChart(canvas, data) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!data || !data.length) return;
  const padding = { left: 60, right: 20, top: 10, bottom: 24 };
  const width = canvas.width - padding.left - padding.right;
  const height = canvas.height - padding.top - padding.bottom;
  const slice = data.slice(-120);
  const maxVol = Math.max(...slice.map(d => d.volume));
  const xStep = width / Math.max(1, slice.length - 1);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('Volume', padding.left - 10, padding.top + 12);

  slice.forEach((d, i) => {
    const x = padding.left + i * xStep;
    const h = (d.volume / maxVol) * height;
    const color = d.close >= d.open ? '#22c55e' : '#ef4444';
    ctx.fillStyle = color;
    ctx.fillRect(x - Math.max(3, xStep * 0.6) / 2, padding.top + height - h, Math.max(3, xStep * 0.6), h);
  });

  // Volume moving average (20)
  ctx.strokeStyle = '#38bdf8';
  ctx.beginPath();
  slice.forEach((d, i) => {
    if (d.volSpike == null) return;
    const baseVol = d.volume / d.volSpike;
    const y = padding.top + height - (baseVol / maxVol) * height;
    const x = padding.left + i * xStep;
    if (ctx.currentPath === undefined || i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function attachEvents() {
  ['change', 'keyup'].forEach(evt => {
    elements.signalFilter.addEventListener(evt, renderTable);
    elements.scoreMin.addEventListener(evt, renderTable);
    elements.volSpikeMin.addEventListener(evt, renderTable);
    elements.symbolSearch.addEventListener(evt, renderTable);
  });

  elements.targetPct.addEventListener('change', () => {
    state.settings.successPct = Number(elements.targetPct.value) || 5;
    if (state.selected) selectSymbol(state.selected);
  });
  elements.targetDays.addEventListener('change', () => {
    state.settings.successDays = Number(elements.targetDays.value) || 10;
    if (state.selected) selectSymbol(state.selected);
  });
  elements.bollingerToggle.addEventListener('change', () => {
    if (state.selected) renderCharts(state.enriched[state.selected]);
  });

  elements.csvInput.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseCsv(text);
    state.rows = mergeRows(state.rows, rows);
    persistData(state.rows);
    rebuild();
    if (state.latest.length) selectSymbol(state.latest[0].symbol);
    e.target.value = '';
  });

  elements.clearData.addEventListener('click', () => {
    clearStorage();
    state.rows = [];
    state.enriched = {};
    state.latest = [];
    elements.tableBody.innerHTML = '';
    elements.detailSymbol.textContent = 'Select a row';
    elements.detailDescription.textContent = 'Upload CSV to see price action.';
    elements.breakdown.innerHTML = '';
    elements.historyPanel.innerHTML = '';
    const ctxP = elements.priceCanvas.getContext('2d');
    ctxP.clearRect(0,0,elements.priceCanvas.width,elements.priceCanvas.height);
    const ctxV = elements.volumeCanvas.getContext('2d');
    ctxV.clearRect(0,0,elements.volumeCanvas.width,elements.volumeCanvas.height);
  });
}

function mergeRows(existing, incoming) {
  const combined = [...existing];
  const key = r => `${r.symbol}-${r.date.toISOString().slice(0,10)}`;
  const existingMap = new Map(combined.map(r => [key(r), r]));
  for (const row of incoming) {
    const k = key(row);
    if (!existingMap.has(k)) {
      existingMap.set(k, row);
      combined.push(row);
    } else {
      const stored = existingMap.get(k);
      Object.assign(stored, row);
    }
  }
  return combined;
}

attachEvents();
loadInitialData();
