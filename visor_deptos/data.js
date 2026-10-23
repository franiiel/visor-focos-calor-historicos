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

// Parses one monthly CSV (`in1,focos,anomalia`) into Map<in1, {focos, anomalia}>.
// in1 stays a string so the leading zero is preserved; rows with an invalid code
// are skipped, and empty or non-numeric values become null ("sin dato").
export function parseMonthCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) throw new Error('CSV vacío: falta el encabezado in1,focos,anomalia');
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const col = { in1: header.indexOf('in1'), focos: header.indexOf('focos'), anomalia: header.indexOf('anomalia') };
  if (col.in1 < 0 || col.focos < 0 || col.anomalia < 0) {
    throw new Error('Encabezado inválido: se esperaba in1,focos,anomalia');
  }
  const rows = new Map();
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const in1 = (cells[col.in1] ?? '').trim();
    if (!/^\d{5}$/.test(in1)) continue;
    rows.set(in1, { focos: toNumber(cells[col.focos]), anomalia: toNumber(cells[col.anomalia]) });
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
