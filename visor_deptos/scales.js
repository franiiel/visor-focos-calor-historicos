// Funciones puras de escala de colores y de formato para el visor. No acceden al DOM, por lo que
// se pueden probar con node:test.

export const MISSING_COLOR = '#c8c8c8';

// Clases de anomalía 1-5 de SEPA (ver VISOR_FOCOS.md): azul = menos focos que lo normal,
// neutro = normal, rojo = más; los extremos son el mínimo y el máximo históricos.
export const ANOMALY_COLORS = ['#2166ac', '#92c5de', '#f7f7f7', '#f4a582', '#b2182b'];

// Escala secuencial: el primer color se reserva para cero focos.
export const COUNT_COLORS = [
  '#fffbe6', '#fee391', '#fec44f', '#fe9929', '#ec7014', '#cc4c02', '#8c2d04',
];

const NICE_STEPS = [1, 2, 2.5, 5, 10];

// Menor número "redondo" (1, 2, 2.5 o 5 por una potencia de diez) >= x.
export function niceCeil(x) {
  if (!(x > 0)) return 0;
  const pow = 10 ** Math.floor(Math.log10(x));
  // La tolerancia evita saltos del tipo 3 -> 5 causados por el ruido de punto flotante.
  const step = NICE_STEPS.find((s) => s * pow >= x * (1 - 1e-9));
  return step * pow;
}

function finite(values) {
  return values.filter((v) => typeof v === 'number' && Number.isFinite(v));
}

function quantile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

// Hasta seis umbrales ascendentes para conteos positivos, a partir de cuantiles de los
// valores distintos de cero redondeados a números redondos. El cero tiene su propia clase.
export function countBreaks(values) {
  const positive = finite(values).filter((v) => v > 0).sort((a, b) => a - b);
  if (!positive.length) return [1];
  const breaks = [];
  for (const p of [0.2, 0.4, 0.6, 0.8, 0.95]) {
    const b = Math.max(1, niceCeil(quantile(positive, p)));
    if (!breaks.length || b > breaks.at(-1)) breaks.push(b);
  }
  return breaks;
}

// Cantidad de cortes estrictamente menores que el valor (0..breaks.length).
export function classIndex(value, breaks) {
  let i = 0;
  while (i < breaks.length && breaks[i] < value) i += 1;
  return i;
}

// kind: 'anomaly' (clases fijas 1-5, rotuladas con classLabels) o 'value'
// (secuencial con una clase para el cero).
export function buildScale(kind, values, classLabels = []) {
  if (kind === 'anomaly') {
    return { kind, colors: ANOMALY_COLORS.slice(), labels: classLabels };
  }
  // Para conteos, breaks[0] separa el 0 de la primera clase positiva.
  const breaks = [0, ...countBreaks(values)];
  return { kind, breaks, colors: COUNT_COLORS.slice(0, breaks.length + 1) };
}

function isMissing(value) {
  return value === null || value === undefined || !Number.isFinite(value);
}

// Índice 0-4 de una clase de anomalía, o -1 para cualquier valor que no sea una clase 1-5.
function anomalyIndex(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value - 1 : -1;
}

export function colorFor(value, scale) {
  if (isMissing(value)) return MISSING_COLOR;
  if (scale.kind === 'anomaly') return scale.colors[anomalyIndex(value)] ?? MISSING_COLOR;
  return scale.colors[classIndex(value, scale.breaks)];
}

export function anomalyLabel(value, classLabels) {
  return classLabels[anomalyIndex(value)] ?? 'sin dato';
}

export function formatNumber(value, decimals = 0) {
  if (isMissing(value)) return 'sin dato';
  const fixed = Math.abs(value).toFixed(decimals);
  const [int, frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = value < 0 && Number(fixed) !== 0 ? '−' : '';
  return sign + grouped + (frac ? `,${frac}` : '');
}

// Entradas de la leyenda de la clase más baja a la más alta, más "Sin dato".
export function legendItems(scale) {
  const { breaks, colors } = scale;
  const items = [];
  if (scale.kind === 'anomaly') {
    scale.labels.forEach((label, i) => items.push({ color: colors[i], label }));
  } else {
    items.push({ color: colors[0], label: '0' });
    for (let i = 1; i < breaks.length; i++) {
      const lo = breaks[i - 1] + 1;
      const hi = breaks[i];
      const label = lo >= hi ? formatNumber(hi) : `${formatNumber(lo)} a ${formatNumber(hi)}`;
      items.push({ color: colors[i], label });
    }
    items.push({ color: colors[breaks.length], label: `Más de ${formatNumber(breaks.at(-1))}` });
  }
  items.push({ color: MISSING_COLOR, label: 'Sin dato' });
  return items;
}
