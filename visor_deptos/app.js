// Visor departamental (módulo ES) del conjunto de datos descrito en config.json, que
// index.php incrusta como #visor-config. index.php carga Leaflet (L) y Chart.js (Chart)
// como scripts UMD con versión fija.
import { buildScale, colorFor, legendItems, formatNumber, anomalyLabel } from './scales.js';
import {
  parseMonthCsv, splitMonth, monthLabel, MONTH_NAMES, createLatestGuard, lustrumStart, lustrumMeans,
} from './data.js';

const L = globalThis.L;
const Chart = globalThis.Chart;

const $ = (id) => document.getElementById(id);

function readConfig() {
  try {
    return JSON.parse($('visor-config').textContent);
  } catch {
    return null;
  }
}

// Los valores null de respaldo solo evitan que estas líneas lancen errores: init() se detiene
// antes de usarlos cuando falta la configuración.
const config = readConfig();
// Redondeo solo para mostrar; los valores no enteros conservan la precisión completa en los datos.
const VALUE_DECIMALS = config && config.integerValues ? 0 : 1;
const UNIT = config ? config.unit : '';
const UNIT_TITLE = UNIT.charAt(0).toUpperCase() + UNIT.slice(1);
const CLASS_LABELS = config ? config.anomalyClasses : [];
const CLIM_PERIOD = config
  ? `${config.climatology.from.slice(0, 4)}–${config.climatology.to.slice(0, 4)}`
  : '';

const state = {
  months: [],
  month: null,
  layer: 'anomaly',
  monthCache: new Map(), // AAAAMM -> Map<in1, {value, anomaly}>
  rows: new Map(),
  scale: null,
  selected: null, // { in1, depto, provincia }
  series: null,
  geoLayer: null,
  chart: null,
};

// Solo la última carga de mes y el último clic en un departamento pueden modificar la interfaz.
const monthGuard = createLatestGuard();
const seriesGuard = createLatestGuard();

function layerTitle() {
  return state.layer === 'anomaly' ? config.anomalyTitle : config.valueTitle;
}

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

// ---------- Mapa ----------

function createMap(geo) {
  const map = L.map('map', { minZoom: 3, zoomSnap: 0.5 });
  // Mapa base oficial del IGN, el mismo del visor de focos de 5 días de SEPA (TMS, de ahí {-y}).
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
  if (state.layer === 'anomaly') return anomalyLabel(value, CLASS_LABELS);
  if (value === null || value === undefined) return 'sin dato';
  return `${formatNumber(value, VALUE_DECIMALS)} ${UNIT}`;
}

function tooltipHtml(props) {
  return (
    `<strong>${escapeHtml(props.depto)}</strong><br>` +
    `${escapeHtml(props.provincia)}<br>` +
    `${escapeHtml(layerTitle())}: ${escapeHtml(formatValue(valueFor(props.in1)))}`
  );
}

function renderLegend() {
  const legend = $('legend');
  legend.replaceChildren();
  const title = document.createElement('div');
  title.className = 'visor-legend-title';
  title.textContent = state.layer === 'anomaly' ? `Anomalía (${CLIM_PERIOD})` : `${UNIT_TITLE} en el mes`;
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
  state.scale = buildScale(state.layer, values, CLASS_LABELS);
  state.geoLayer.setStyle(featureStyle);
  renderLegend();
  $('map-title').textContent = `${layerTitle()} — ${monthLabel(state.month)}`;
}

// ---------- Selección de mes ----------

async function loadMonth(month) {
  if (!state.months.includes(month)) return;
  const token = monthGuard.next();
  let rows = state.monthCache.get(month);
  if (!rows) {
    try {
      const res = await fetch(`datos/${config.filePrefix}_${month}.csv`);
      if (!res.ok) throw new Error(`No se pudo leer el archivo del mes ${month} (HTTP ${res.status})`);
      rows = parseMonthCsv(await res.text(), config.columns);
    } catch (err) {
      // No se informa el fallo de una solicitud reemplazada: la más reciente controla la interfaz.
      if (!monthGuard.isCurrent(token)) return;
      throw err;
    }
    state.monthCache.set(month, rows);
  }
  // Se ignora una respuesta tardía si mientras tanto se seleccionó otro mes.
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

// ---------- Series del departamento ----------

async function selectDepartment(props) {
  state.selected = { in1: props.in1, depto: props.depto, provincia: props.provincia };
  state.geoLayer.setStyle(featureStyle);
  $('panel-title').textContent = `${props.depto} (${props.provincia})`;
  $('panel-info').textContent = 'Cargando serie…';
  const token = seriesGuard.next();
  // Se descarta la serie del departamento anterior para que un cambio de mes durante la carga no pueda
  // escribir sus números en el panel bajo el nuevo título.
  state.series = null;
  let series;
  try {
    series = await fetchJson(`serie.php?in1=${encodeURIComponent(props.in1)}`, 'serie.php');
  } catch (err) {
    // Se ignora un fallo tardío si mientras tanto se hizo clic en otro departamento.
    if (!seriesGuard.isCurrent(token)) return;
    state.series = null;
    $('panel-info').textContent = `No se pudo cargar la serie del departamento (${err.message}).`;
    if (state.chart) state.chart.destroy();
    state.chart = null;
    return;
  }
  // Se ignora una respuesta tardía si mientras tanto se hizo clic en otro departamento.
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
  return months.map((_, i) => (i === idx ? state.series.value[i] : null));
}

function updatePanelInfo() {
  const s = state.series;
  const idx = s.months.indexOf(state.month);
  if (idx < 0) {
    $('panel-info').textContent = `Sin dato para ${monthLabel(state.month)}.`;
    return;
  }
  $('panel-info').textContent =
    `${monthLabel(state.month)}: ${formatNumber(s.value[idx], VALUE_DECIMALS)} ${UNIT} · ` +
    `anomalía: ${anomalyLabel(s.anomaly[idx], CLASS_LABELS).toLowerCase()}`;
}

function renderChart() {
  const s = state.series;
  const years = s.months.map((m) => splitMonth(m).year);
  const firstYear = years[0];
  const lastYear = years[years.length - 1];
  const starts = years.map((y) => lustrumStart(y, firstYear));
  const lustrumLabel = (i) => {
    const to = Math.min(starts[i] + 4, lastYear);
    return to === starts[i] ? `${starts[i]}` : `${starts[i]}–${to}`;
  };
  if (state.chart) state.chart.destroy();
  state.chart = new Chart($('chart'), {
    type: 'line',
    data: {
      labels: chartLabels(s.months),
      datasets: [
        {
          label: `${UNIT_TITLE} en el mes`,
          data: s.value,
          borderColor: '#cc4c02',
          backgroundColor: '#cc4c02',
          borderWidth: 1.5,
          pointRadius: 0,
          spanGaps: false,
        },
        {
          label: 'Promedio mensual del lustro',
          data: lustrumMeans(s.months, s.value),
          borderColor: '#000',
          backgroundColor: '#000',
          borderWidth: 2,
          pointRadius: 0,
          // Chart.js dibuja encima el order más bajo; sin esto, la serie mensual tapa estas líneas.
          order: -1,
          // Se oculta el segmento que une dos lustros, para que cada media sea una línea horizontal separada.
          segment: {
            borderColor: (ctx) => (starts[ctx.p0DataIndex] === starts[ctx.p1DataIndex] ? undefined : 'transparent'),
          },
        },
        {
          label: 'Mes seleccionado',
          data: markerData(s.months),
          borderColor: '#000',
          backgroundColor: '#fff',
          pointRadius: 5,
          pointHoverRadius: 6,
          showLine: false,
          order: -2,
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
        y: { beginAtZero: true, title: { display: true, text: UNIT_TITLE } },
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 14, sort: (a, b) => a.datasetIndex - b.datasetIndex },
        },
        tooltip: {
          itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
          filter: (item) => item.raw !== null,
          callbacks: {
            label: (item) => (item.datasetIndex === 1
              ? `Promedio mensual ${lustrumLabel(item.dataIndex)}: ${formatNumber(item.raw, 1)}`
              : `${item.dataset.label}: ${formatNumber(item.raw, VALUE_DECIMALS)}`),
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

// ---------- Inicio ----------

async function init() {
  if (!L || !Chart) {
    showError('No se pudieron cargar las librerías del mapa o del gráfico.');
    return;
  }
  if (!config) {
    showError('No se pudo leer la configuración del visor (config.json).');
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
