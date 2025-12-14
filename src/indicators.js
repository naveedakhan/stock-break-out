function rollingAverage(values, window) {
  const result = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) result[i] = sum / window;
  }
  return result;
}

function rollingStd(values, window) {
  const result = Array(values.length).fill(null);
  const avg = rollingAverage(values, window);
  for (let i = window - 1; i < values.length; i++) {
    const slice = values.slice(i - window + 1, i + 1);
    const mean = avg[i];
    const variance = slice.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / window;
    result[i] = Math.sqrt(variance);
  }
  return result;
}

function trueRange(prevClose, high, low) {
  if (prevClose == null) return high - low;
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(prevClose - low));
}

export function enrichSymbolData(rows, indexSeries, settings) {
  const closes = rows.map(r => r.close);
  const highs = rows.map(r => r.high);
  const lows = rows.map(r => r.low);
  const volumes = rows.map(r => r.volume);
  const ma20 = rollingAverage(closes, 20);
  const ma50 = rollingAverage(closes, 50);
  const std20 = rollingStd(closes, 20);
  const volMa20 = rollingAverage(volumes, 20);

  let prevAtr = null;
  const atr = rows.map((row, idx) => {
    const tr = trueRange(idx === 0 ? null : rows[idx - 1].close, row.high, row.low);
    if (idx === 0) { prevAtr = tr; return null; }
    if (idx < 14) { prevAtr = prevAtr == null ? tr : (prevAtr * idx + tr) / (idx + 1); return null; }
    prevAtr = (prevAtr * 13 + tr) / 14;
    return prevAtr;
  });

  const kseIndex = indexSeries && indexSeries.length ? indexSeries : null;

  return rows.map((row, idx) => {
    const upper = ma20[idx] != null && std20[idx] != null ? ma20[idx] + 2 * std20[idx] : null;
    const lower = ma20[idx] != null && std20[idx] != null ? ma20[idx] - 2 * std20[idx] : null;
    const width = upper && lower ? (upper - lower) / ma20[idx] : null;

    let resistance = null;
    if (idx >= settings.resistanceLookback) {
      const windowHigh = Math.max(...highs.slice(idx - settings.resistanceLookback, idx));
      resistance = windowHigh;
    }

    let relStrength = null;
    if (kseIndex) {
      const currentIndexClose = kseIndex[idx]?.close ?? null;
      const baseIdx = idx - settings.relativeLookback;
      if (currentIndexClose != null && baseIdx >= 0) {
        const baseIndexClose = kseIndex[baseIdx].close;
        const baseClose = rows[baseIdx].close;
        if (baseIndexClose && baseClose) {
          const stockReturn = (row.close - baseClose) / baseClose;
          const indexReturn = (currentIndexClose - baseIndexClose) / baseIndexClose;
          relStrength = indexReturn ? stockReturn / indexReturn : null;
        }
      }
    }

    const volSpike = volMa20[idx] ? row.volume / volMa20[idx] : null;
    const proximity = resistance ? (row.close - resistance) / resistance : null;
    const compressed = width != null && width < settings.compressionWidth;

    const signalContext = {
      ma20: ma20[idx],
      ma50: ma50[idx],
      bbWidth: width,
      upper,
      lower,
      volSpike,
      resistance,
      proximity,
      compressed,
      atr: atr[idx],
      relStrength
    };

    return { ...row, ma20: ma20[idx], ma50: ma50[idx], bbWidth: width, upper, lower, volSpike, resistance, proximity, compressed, atr: atr[idx], relStrength, context: signalContext };
  });
}

export function evaluateSignal(point, settings) {
  const scores = [];
  let total = 0;

  const proximityScore = point.resistance ? Math.max(0, 3 - Math.abs(point.proximity * 100) / 0.75) : 0;
  scores.push({ name: 'Resistance proximity', value: proximityScore, note: point.resistance ? `${(point.proximity * 100).toFixed(2)}% from resistance` : 'Waiting for history' });
  total += proximityScore;

  const compressionScore = point.bbWidth != null ? (point.bbWidth < 0.06 ? 3 : point.bbWidth < 0.1 ? 2 : 0) : 0;
  scores.push({ name: 'Compression (BB width)', value: compressionScore, note: point.bbWidth != null ? `${(point.bbWidth * 100).toFixed(2)}%` : 'Need 20 candles' });
  total += compressionScore;

  const volumeScore = point.volSpike != null ? (point.volSpike > 1.5 ? 3 : point.volSpike > 1.1 ? 2 : 0) : 0;
  scores.push({ name: 'Volume spike', value: volumeScore, note: point.volSpike ? `${point.volSpike.toFixed(2)}x vs 20d` : 'Need 20 days' });
  total += volumeScore;

  const trendScore = (point.ma20 && point.ma50 && point.close > point.ma20 && point.ma20 > point.ma50) ? 2 : 0;
  scores.push({ name: 'Trend alignment', value: trendScore, note: point.ma20 && point.ma50 ? 'Close > 20 > 50' : 'Need 50 days' });
  total += trendScore;

  const relScore = point.relStrength ? (point.relStrength > 1.1 ? 2 : point.relStrength > 0.9 ? 1 : 0) : 0;
  scores.push({ name: 'Relative strength vs KSE-100', value: relScore, note: point.relStrength ? `${(point.relStrength * 100).toFixed(0)}% of index` : 'Upload KSE-100 series' });
  total += relScore;

  let signal = 'None';
  if (point.close > (point.resistance || 0) * (1 + settings.breakoutBuffer) && point.volSpike && point.volSpike > 1.2) {
    signal = 'Enter';
  } else if (point.compressed && point.volSpike && point.volSpike > 1 && point.proximity != null && point.proximity > -0.01 && point.proximity < 0.02) {
    signal = 'Prepare';
  } else if (point.compressed && point.proximity != null && point.proximity > -0.03 && point.proximity < 0.03) {
    signal = 'Watch';
  }

  const stopLoss = point.atr ? point.close - point.atr * settings.atrMultiplier : point.low;

  return { signal, total: Math.round(total), breakdown: scores, stopLoss };
}

export function evaluateHistory(series, settings) {
  const results = { Watch: { hit: 0, total: 0 }, Prepare: { hit: 0, total: 0 }, Enter: { hit: 0, total: 0 } };
  for (let i = 0; i < series.length; i++) {
    const candle = series[i];
    const { signal } = evaluateSignal(candle, settings);
    if (signal === 'None') continue;
    const future = series.slice(i + 1, i + 1 + settings.successDays);
    const target = candle.close * (1 + settings.successPct / 100);
    const hit = future.some(f => f.high >= target);
    results[signal].total += 1;
    if (hit) results[signal].hit += 1;
  }
  return results;
}
