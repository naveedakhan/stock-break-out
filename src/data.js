const STORAGE_KEY = 'psx-swing-data-v1';

export function loadStoredData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return parsed.map(r => ({ ...r, date: new Date(r.date) }));
  } catch (e) {
    console.error('Failed to parse storage', e);
    return [];
  }
}

export function persistData(rows) {
  const serializable = rows.map(r => ({ ...r, date: r.date.toISOString() }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
}

export function clearStorage() {
  localStorage.removeItem(STORAGE_KEY);
}

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift().split(',').map(h => h.trim());
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split(',');
    const record = {};
    header.forEach((h, idx) => { record[h] = parts[idx]?.trim(); });
    rows.push({
      symbol: record.Symbol,
      date: new Date(record.Date),
      open: Number(record.Open),
      high: Number(record.High),
      low: Number(record.Low),
      close: Number(record.Close),
      volume: Number(record.Volume)
    });
  }
  return rows.filter(r => r.symbol && !Number.isNaN(r.close));
}

export function groupBySymbol(rows) {
  const map = {};
  for (const row of rows) {
    if (!map[row.symbol]) map[row.symbol] = [];
    map[row.symbol].push(row);
  }
  Object.keys(map).forEach(sym => map[sym].sort((a, b) => a.date - b.date));
  return map;
}
