// Department heat-hotspot viewer (ES module). Leaflet (L) and Chart.js (Chart) are
// loaded as pinned UMD scripts by index.php.
import { buildScale, colorFor, legendItems, formatNumber, formatAnomaly } from './scales.js';
import { parseMonthCsv, splitMonth, monthLabel, MONTH_NAMES, createLatestGuard } from './data.js';

const L = globalThis.L;
const Chart = globalThis.Chart;

const LAYER_TITLES = {
  anomalia: 'Anomalía de focos de calor',
  focos: 'Focos de calor totales',
};

const state = {
  months: [],
  month: null,
  layer: 'anomalia',
  monthCache: new Map(), // AAAAMM -> Map<in1, {focos, anomalia}>
  rows: new Map(),
  scale: null,
  selected: null, // { in1, depto, provincia }
  series: null,
  geoLayer: null,
  chart: null,
};

// Only the latest month load and the latest department click may touch the UI.
const monthGuard = createLatestGuard();
const seriesGuard = createLatestGuard();

const $ = (id) => document.getElementById(id);

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function showError(message) {
  const box = $('error');
  box.textContent = message;
  box.hidden = false;
}

async function fetchJson(url, what) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new Error(`${what}: la respuesta no es JSON válido`);
  }
}

// ---------- Map ----------

function createMap(geo) {
  const map = L.map('map', { minZoom: 3, zoomSnap: 0.5 });
  // Official IGN basemap, same as the SEPA 5-day hotspot viewer (TMS, hence {-y}).
  L.tileLayer(
    'https://wms.ign.gob.ar/geoserver/gwc/service/tms/1.0.0/capabaseargenmap@EPSG%3A3857@png/{z}/{x}/{-y}.png',
    {
      maxZoom: 12,
      attribution:
        '<a href="https://www.ign.gob.ar/AreaServicios/Argenmap/Introduccion">Argenmap — IGN</a> · ' +
        'Departamentos: INDEC 2005 (vía SEPA)',
    },
  ).addTo(map);

  state.geoLayer = L.geoJSON(geo, {
    style: featureStyle,
    onEachFeature: (feature, layer) => {
      layer.bindTooltip(() => tooltipHtml(feature.properties), { sticky: true });
      layer.on({
        mouseover: () => {
          layer.setStyle({ weight: 2, color: '#222' });
          layer.bringToFront();
        },
        mouseout: () => state.geoLayer.resetStyle(layer),
        click: () => selectDepartment(feature.properties),
      });
    },
  }).addTo(map);

  map.fitBounds(state.geoLayer.getBounds(), { padding: [8, 8] });
  return map;
}

function valueFor(in1) {
  const row = state.rows.get(in1);
  return row ? row[state.layer] : null;
}

function featureStyle(feature) {
  const selected = state.selected && state.selected.in1 === feature.properties.in1;
  return {
    fillColor: state.scale ? colorFor(valueFor(feature.properties.in1), state.scale) : '#c8c8c8',
    fillOpacity: 0.85,
    color: selected ? '#000' : '#7a7a7a',
    weight: selected ? 2.5 : 0.4,
  };
}

function formatValue(value) {
  if (value === null || value === undefined) return 'sin dato';
  return state.layer === 'anomalia'
    ? `${formatAnomaly(value)} focos respecto de lo normal`
    : `${formatNumber(value)} focos`;
}

function tooltipHtml(props) {
  return (
    `<strong>${escapeHtml(props.depto)}</strong><br>` +
    `${escapeHtml(props.provincia)}<br>` +
    `${escapeHtml(LAYER_TITLES[state.layer])}: ${escapeHtml(formatValue(valueFor(props.in1)))}`
  );
}

function renderLegend() {
  const legend = $('legend');
  legend.replaceChildren();
  const title = document.createElement('div');
  title.className = 'visor-legend-title';
  title.textContent = state.layer === 'anomalia' ? 'Anomalía (focos)' : 'Focos en el mes';
  legend.append(title);
  for (const item of legendItems(state.scale)) {
    const row = document.createElement('div');
    row.className = 'visor-legend-item';
    const swatch = document.createElement('span');
    swatch.className = 'visor-legend-swatch';
    swatch.style.background = item.color;
    const label = document.createElement('span');
    label.textContent = item.label;
    row.append(swatch, label);
    legend.append(row);
  }
}

function restyle() {
  const values = [...state.rows.values()].map((r) => r[state.layer]);
  state.scale = buildScale(state.layer, values);
  state.geoLayer.setStyle(featureStyle);
  renderLegend();
  $('map-title').textContent = `${LAYER_TITLES[state.layer]} — ${monthLabel(state.month)}`;
}

// ---------- Month selection ----------

async function loadMonth(month) {
  if (!state.months.includes(month)) return;
  const token = monthGuard.next();
  let rows = state.monthCache.get(month);
  if (!rows) {
    try {
      const res = await fetch(`datos/focos_${month}.csv`);
      if (!res.ok) throw new Error(`No se pudo leer el archivo del mes ${month} (HTTP ${res.status})`);
      rows = parseMonthCsv(await res.text());
    } catch (err) {
      // A failure of a superseded request is not reported: the newer one owns the UI.
      if (!monthGuard.isCurrent(token)) return;
      throw err;
    }
    state.monthCache.set(month, rows);
  }
  // Ignore a late response if another month was selected meanwhile.
  if (!monthGuard.isCurrent(token)) return;
  state.month = month;
  state.rows = rows;
  restyle();
  updateChartMarker();
}

function fillMonthSelect(year, preferredMonth) {
  const sel = $('sel-month');
  const available = state.months.filter((m) => splitMonth(m).year === year);
  sel.replaceChildren(
    ...available.map((m) => new Option(MONTH_NAMES[splitMonth(m).month - 1], m)),
  );
  const keep = available.find((m) => splitMonth(m).month === preferredMonth);
  sel.value = keep || available[available.length - 1];
  return sel.value;
}

function setupControls() {
  const years = [...new Set(state.months.map((m) => splitMonth(m).year))].sort((a, b) => b - a);
  const selYear = $('sel-year');
  const selMonth = $('sel-month');
  selYear.replaceChildren(...years.map((y) => new Option(String(y), String(y))));
  const latest = state.months[state.months.length - 1];
  selYear.value = String(splitMonth(latest).year);
  fillMonthSelect(splitMonth(latest).year, splitMonth(latest).month);
  selYear.disabled = false;
  selMonth.disabled = false;

  const onChange = (fn) => () => fn().catch((err) => showError(err.message));
  selYear.addEventListener('change', onChange(() => {
    const current = state.month ? splitMonth(state.month).month : 12;
    return loadMonth(fillMonthSelect(Number(selYear.value), current));
  }));
  selMonth.addEventListener('change', onChange(() => loadMonth(selMonth.value)));
  for (const radio of document.querySelectorAll('input[name="layer"]')) {
    radio.addEventListener('change', () => {
      state.layer = radio.value;
      restyle();
    });
  }
  return latest;
}

// ---------- Department series ----------

async function selectDepartment(props) {
  state.selected = { in1: props.in1, depto: props.depto, provincia: props.provincia };
  state.geoLayer.setStyle(featureStyle);
  $('panel-title').textContent = `${props.depto} (${props.provincia})`;
  $('panel-info').textContent = 'Cargando serie…';
  const token = seriesGuard.next();
  // Drop the previous department's series so a month change while loading cannot
  // write its numbers into the panel under the new title.
  state.series = null;
  let series;
  try {
    series = await fetchJson(`serie.php?in1=${encodeURIComponent(props.in1)}`, 'serie.php');
  } catch (err) {
    // Ignore a late failure if another department was clicked meanwhile.
    if (!seriesGuard.isCurrent(token)) return;
    state.series = null;
    $('panel-info').textContent = `No se pudo cargar la serie del departamento (${err.message}).`;
    if (state.chart) state.chart.destroy();
    state.chart = null;
    return;
  }
  // Ignore a late response if another department was clicked meanwhile.
  if (!seriesGuard.isCurrent(token)) return;
  state.series = series;
  renderChart();
}

function chartLabels(months) {
  return months.map((m) => {
    const { year, month } = splitMonth(m);
    return `${MONTH_NAMES[month - 1].slice(0, 3)} ${year}`;
  });
}

function markerData(months) {
  const idx = months.indexOf(state.month);
  return months.map((_, i) => (i === idx ? state.series.focos[i] : null));
}

function updatePanelInfo() {
  const s = state.series;
  const idx = s.months.indexOf(state.month);
  if (idx < 0) {
    $('panel-info').textContent = `Sin dato para ${monthLabel(state.month)}.`;
    return;
  }
  const clim = s.clim ? s.clim[splitMonth(state.month).month - 1] : null;
  $('panel-info').textContent =
    `${monthLabel(state.month)}: ${formatNumber(s.focos[idx])} focos · ` +
    `anomalía ${formatAnomaly(s.anomalia[idx])} · ` +
    `promedio 2001–2020 del mes: ${formatNumber(clim, 1)}`;
}

function renderChart() {
  const s = state.series;
  // Reference: the 2001-2020 mean of the same calendar month, repeated along the series.
  const reference = s.months.map((m) => (s.clim ? s.clim[splitMonth(m).month - 1] : null));
  if (state.chart) state.chart.destroy();
  state.chart = new Chart($('chart'), {
    type: 'line',
    data: {
      labels: chartLabels(s.months),
      datasets: [
        {
          label: 'Focos en el mes',
          data: s.focos,
          borderColor: '#cc4c02',
          backgroundColor: '#cc4c02',
          borderWidth: 1.5,
          pointRadius: 0,
          spanGaps: false,
        },
        {
          label: 'Promedio 2001–2020 del mismo mes',
          data: reference,
          borderColor: '#555',
          borderDash: [4, 3],
          borderWidth: 1,
          pointRadius: 0,
        },
        {
          label: 'Mes seleccionado',
          data: markerData(s.months),
          borderColor: '#000',
          backgroundColor: '#fff',
          pointRadius: 5,
          pointHoverRadius: 6,
          showLine: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { ticks: { maxTicksLimit: 8, maxRotation: 0 }, grid: { display: false } },
        y: { beginAtZero: true, title: { display: true, text: 'Focos' } },
      },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 14 } },
        tooltip: {
          filter: (item) => item.raw !== null,
          callbacks: {
            label: (item) => `${item.dataset.label}: ${formatNumber(item.raw, item.datasetIndex === 1 ? 1 : 0)}`,
          },
        },
      },
    },
  });
  updatePanelInfo();
}

function updateChartMarker() {
  if (!state.chart || !state.series) return;
  state.chart.data.datasets[2].data = markerData(state.series.months);
  state.chart.update('none');
  updatePanelInfo();
}

// ---------- Startup ----------

async function init() {
  if (!L || !Chart) {
    showError('No se pudieron cargar las librerías del mapa o del gráfico.');
    return;
  }
  let months;
  let geo;
  try {
    [months, geo] = await Promise.all([
      fetchJson('listar.php', 'listar.php'),
      fetchJson('deptos.geo.json', 'deptos.geo.json'),
    ]);
  } catch (err) {
    showError(`No se pudieron cargar los datos iniciales (${err.message}). El visor necesita PHP para listar los meses.`);
    $('map-title').textContent = '';
    return;
  }
  state.months = Array.isArray(months) ? months.filter((m) => /^\d{6}$/.test(m)).sort() : [];
  createMap(geo);
  if (!state.months.length) {
    showError('No hay meses con datos en la carpeta datos/.');
    $('map-title').textContent = '';
    return;
  }
  const latest = setupControls();
  try {
    await loadMonth(latest);
  } catch (err) {
    showError(err.message);
  }
}

init();
