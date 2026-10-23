// Pure data helpers for the viewer (no DOM), tested with node:test.

const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export { MONTH_NAMES };

function toNumber(text) {
  const t = (text ?? '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// Parses one monthly CSV into Map<in1, {value, anomaly}>, reading the column names
// given by config.json (`columns: {value, anomaly}`, lowercase).
// in1 stays a string so the leading zero is preserved; rows with an invalid code
// are skipped, and empty or non-numeric values become null ("sin dato").
export function parseMonthCsv(text, columns) {
  const expected = `in1,${columns.value},${columns.anomaly}`;
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) throw new Error(`CSV vacío: falta el encabezado ${expected}`);
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const col = {
    in1: header.indexOf('in1'),
    value: header.indexOf(columns.value),
    anomaly: header.indexOf(columns.anomaly),
  };
  if (col.in1 < 0 || col.value < 0 || col.anomaly < 0) {
    throw new Error(`Encabezado inválido: se esperaba ${expected}`);
  }
  const rows = new Map();
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const in1 = (cells[col.in1] ?? '').trim();
    if (!/^\d{5}$/.test(in1)) continue;
    rows.set(in1, { value: toNumber(cells[col.value]), anomaly: toNumber(cells[col.anomaly]) });
  }
  return rows;
}

export function splitMonth(aaaamm) {
  return { year: Number(aaaamm.slice(0, 4)), month: Number(aaaamm.slice(4, 6)) };
}

export function monthLabel(aaaamm) {
  const { year, month } = splitMonth(aaaamm);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

// Sequences async requests so only the latest one may apply its result:
// take a token with next() before awaiting, then check isCurrent(token) after.
export function createLatestGuard() {
  let latest = 0;
  return {
    next: () => ++latest,
    isCurrent: (token) => token === latest,
  };
}
