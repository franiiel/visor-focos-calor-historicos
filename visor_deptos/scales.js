// Pure colour-scale and formatting helpers for the viewer. No DOM access, so they
// can be tested with node:test.

export const MISSING_COLOR = '#c8c8c8';

// Diverging scale (7 classes): blue = fewer hotspots than normal, red = more.
export const ANOMALY_COLORS = [
  '#2166ac', '#67a9cf', '#d1e5f0', '#f7f7f7', '#fddbc7', '#ef8a62', '#b2182b',
];

// Sequential scale: first colour is reserved for zero hotspots.
export const COUNT_COLORS = [
  '#fffbe6', '#fee391', '#fec44f', '#fe9929', '#ec7014', '#cc4c02', '#8c2d04',
];

const NICE_STEPS = [1, 2, 2.5, 5, 10];

// Smallest "nice" number (1, 2, 2.5 or 5 times a power of ten) >= x.
export function niceCeil(x) {
  if (!(x > 0)) return 0;
  const pow = 10 ** Math.floor(Math.log10(x));
  // Tolerance avoids 3 -> 5 style jumps caused by floating point noise.
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

// Six thresholds symmetric around 0: [-m, -m/2, -n, n, m/2, m], where m is the
// 95th percentile of |anomaly| rounded up to a nice number (at least 1) and n
// bounds the "normal" band.
export function anomalyBreaks(values) {
  const abs = finite(values).map(Math.abs).sort((a, b) => a - b);
  const m = Math.max(1, niceCeil(quantile(abs, 0.95)));
  const n = m / 10;
  return [-m, -m / 2, -n, n, m / 2, m];
}

// Up to six ascending thresholds for positive counts, from quantiles of the
// non-zero values rounded to nice numbers. Zero has its own class.
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

// Number of breaks strictly below the value (0..breaks.length).
export function classIndex(value, breaks) {
  let i = 0;
  while (i < breaks.length && breaks[i] < value) i += 1;
  return i;
}

// kind: 'anomaly' (diverging) or 'value' (sequential with a zero class).
export function buildScale(kind, values) {
  if (kind === 'anomaly') {
    return { kind, breaks: anomalyBreaks(values), colors: ANOMALY_COLORS.slice() };
  }
  // For counts, breaks[0] separates 0 from the first positive class.
  const breaks = [0, ...countBreaks(values)];
  return { kind, breaks, colors: COUNT_COLORS.slice(0, breaks.length + 1) };
}

function isMissing(value) {
  return value === null || value === undefined || !Number.isFinite(value);
}

export function colorFor(value, scale) {
  if (isMissing(value)) return MISSING_COLOR;
  return scale.colors[classIndex(value, scale.breaks)];
}

export function formatNumber(value, decimals = 0) {
  if (isMissing(value)) return 'sin dato';
  const fixed = Math.abs(value).toFixed(decimals);
  const [int, frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = value < 0 && Number(fixed) !== 0 ? '−' : '';
  return sign + grouped + (frac ? `,${frac}` : '');
}

export function formatAnomaly(value) {
  if (isMissing(value)) return 'sin dato';
  const text = formatNumber(value, 1);
  return value > 0 && text !== '0,0' ? `+${text}` : text;
}

// Legend entries from lowest to highest class, plus "Sin dato".
export function legendItems(scale) {
  const { breaks, colors } = scale;
  const items = [];
  if (scale.kind === 'anomaly') {
    const f = (v) => formatAnomaly(v);
    const labels = [
      `Muchos menos (≤ ${f(breaks[0])})`,
      `Menos (${f(breaks[0])} a ${f(breaks[1])})`,
      `Algo menos (${f(breaks[1])} a ${f(breaks[2])})`,
      `Normal (${f(breaks[2])} a ${f(breaks[3])})`,
      `Algo más (${f(breaks[3])} a ${f(breaks[4])})`,
      `Más (${f(breaks[4])} a ${f(breaks[5])})`,
      `Muchos más (> ${f(breaks[5])})`,
    ];
    labels.forEach((label, i) => items.push({ color: colors[i], label }));
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
