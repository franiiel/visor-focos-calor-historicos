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

// Los lustros (bloques de 5 años) se anclan en el primer año de la serie: 2001–2005, 2006–2010, …
export function lustrumStart(year, firstYear) {
  return firstYear + Math.floor((year - firstYear) / 5) * 5;
}

// Para cada mes, la media de los valores mensuales de su lustro (null si el bloque no tiene datos).
export function lustrumMeans(months, values) {
  if (months.length === 0) return [];
  const firstYear = splitMonth(months[0]).year;
  const blocks = new Map(); // año de inicio -> { sum, count }
  const starts = months.map((m) => lustrumStart(splitMonth(m).year, firstYear));
  starts.forEach((start, i) => {
    const b = blocks.get(start) || { sum: 0, count: 0 };
    if (values[i] !== null && values[i] !== undefined) {
      b.sum += values[i];
      b.count += 1;
    }
    blocks.set(start, b);
  });
  return starts.map((start) => {
    const b = blocks.get(start);
    return b.count > 0 ? b.sum / b.count : null;
  });
}

// Total mensual de los departamentos cuyo in1 empieza con prefix (un código de provincia de 2 dígitos,
// o '' para todo el país). Un mes en el que ninguno de ellos tiene datos es null.
export function sumSeries(months, data, prefix = '') {
  const sums = months.map(() => null);
  for (const [in1, series] of Object.entries(data)) {
    if (!in1.startsWith(prefix)) continue;
    series.value.forEach((v, i) => {
      if (v !== null && v !== undefined) sums[i] = (sums[i] ?? 0) + v;
    });
  }
  return sums;
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
