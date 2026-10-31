// Funciones puras de datos para el visor (sin DOM), probadas con node:test.

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

// Interpreta un CSV mensual como Map<in1, {value, anomaly}>, leyendo los nombres de columna
// indicados en config.json (`columns: {value, anomaly}`, en minúsculas).
// in1 se mantiene como cadena para conservar el cero inicial; las filas con un código inválido
// se omiten, y los valores vacíos o no numéricos pasan a ser null ("sin dato").
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

// Ordena las solicitudes asíncronas para que solo la última pueda aplicar su resultado:
// se toma un token con next() antes del await y después se verifica isCurrent(token).
export function createLatestGuard() {
  let latest = 0;
  return {
    next: () => ++latest,
    isCurrent: (token) => token === latest,
  };
}
