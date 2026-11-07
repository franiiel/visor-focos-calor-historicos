// Visor departamental (módulo ES) del conjunto de datos descrito en config.json, que
// index.php incrusta como #visor-config. index.php carga Leaflet (L) y Chart.js (Chart)
// como scripts UMD con versión fija.
import { buildScale, colorFor, legendItems, formatNumber, anomalyLabel } from './scales.js';
import {
  parseMonthCsv, splitMonth, monthLabel, MONTH_NAMES, createLatestGuard, lustrumStart, lustrumMeans, sumSeries,
  monthlyStats, yearValues,
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
  province: null, // código de 2 dígitos del filtro de provincia, null para todo el país
  provinces: new Map(), // código -> { name, deptos: [propiedades del feature] }
  series: null, // { months, value, anomaly? }; anomaly solo para un único departamento
  allSeries: null, // promesa de la respuesta completa de serie.php, usada para los totales
  map: null,
  geoLayer: null,
  layersByIn1: new Map(),
  chart: null,
  years: [], // todos los años con datos, en orden ascendente
  yearSlots: new Map(), // año seleccionado -> posición de color (ver yearColor)
  yearsChart: null,
};

// Paleta categórica en orden fijo (verificada para daltonismo). Un año conserva su color mientras
// siga seleccionado, de modo que agregar o quitar otro año nunca lo vuelve a pintar.
const YEAR_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

// No hay límite de años: después de los 8 colores verificados, los tonos avanzan según el ángulo áureo para que
// las posiciones consecutivas queden separadas. No están verificados para daltonismo; usar tantas líneas es decisión del usuario.
function yearColor(slot) {
  return slot < YEAR_COLORS.length ? YEAR_COLORS[slot] : `hsl(${Math.round(slot * 137.5) % 360} 65% 42%)`;
}

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
      state.layersByIn1.set(feature.properties.in1, layer);
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
  const { in1 } = feature.properties;
  const selected = state.selected && state.selected.in1 === in1;
  const inProvince = state.province && in1.startsWith(state.province);
  return {
    fillColor: state.scale ? colorFor(valueFor(in1), state.scale) : '#c8c8c8',
    fillOpacity: 0.85,
    color: selected || inProvince ? '#000' : '#7a7a7a',
    weight: selected ? 2.5 : inProvince ? 0.8 : 0.4,
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

// ---------- Filtros de área y series ----------

function setupAreaFilters(geo) {
  for (const { properties: p } of geo.features) {
    const code = p.in1.slice(0, 2);
    if (!state.provinces.has(code)) state.provinces.set(code, { name: p.provincia, deptos: [] });
    state.provinces.get(code).deptos.push(p);
  }
  const selProv = $('sel-prov');
  const selDepto = $('sel-depto');
  const sorted = [...state.provinces].sort((a, b) => a[1].name.localeCompare(b[1].name, 'es'));
  selProv.append(...sorted.map(([code, { name }]) => new Option(name, code)));
  selProv.disabled = false;

  selProv.addEventListener('change', () => {
    fillDeptoSelect(selProv.value, '');
    zoomTo(selProv.value);
    showArea(selProv.value);
  });
  selDepto.addEventListener('change', () => {
    if (!selDepto.value) {
      zoomTo(selProv.value);
      showArea(selProv.value);
      return;
    }
    zoomTo(selDepto.value);
    selectDepartment(state.layersByIn1.get(selDepto.value).feature.properties);
  });
}

function fillDeptoSelect(code, in1) {
  const sel = $('sel-depto');
  const deptos = code ? [...state.provinces.get(code).deptos] : [];
  deptos.sort((a, b) => a.depto.localeCompare(b.depto, 'es'));
  sel.replaceChildren(new Option('Todos', ''), ...deptos.map((p) => new Option(p.depto, p.in1)));
  sel.value = in1;
  sel.disabled = !code;
}

// code: '' para todo el país, 2 dígitos para una provincia, 5 para un departamento.
function zoomTo(code) {
  if (!code) {
    state.map.fitBounds(state.geoLayer.getBounds(), { padding: [8, 8] });
    return;
  }
  const bounds = L.latLngBounds([]);
  for (const [in1, layer] of state.layersByIn1) {
    if (in1.startsWith(code)) bounds.extend(layer.getBounds());
  }
  state.map.fitBounds(bounds, { padding: [8, 8], maxZoom: 9 });
}

function seriesFailed(err) {
  state.series = null;
  $('panel-info').textContent = `No se pudo cargar la serie (${err.message}).`;
  if (state.chart) state.chart.destroy();
  state.chart = null;
  renderYearsChart();
}

// ponytail: los totales cargan serie.php completo (~750 KB) una sola vez; agregar un endpoint por provincia si resulta demasiado pesado.
function loadAllSeries() {
  if (!state.allSeries) {
    state.allSeries = fetchJson('serie.php', 'serie.php').catch((err) => {
      state.allSeries = null; // permite que la próxima selección reintente
      throw err;
    });
  }
  return state.allSeries;
}

// Total de todo el país (código '') o de una provincia (código de 2 dígitos).
async function showArea(code) {
  state.selected = null;
  state.province = code || null;
  state.geoLayer.setStyle(featureStyle);
  $('panel-title').textContent = code ? state.provinces.get(code).name : 'Argentina';
  $('panel-info').textContent = 'Cargando serie…';
  const token = seriesGuard.next();
  state.series = null;
  renderYearsChart();
  let all;
  try {
    all = await loadAllSeries();
  } catch (err) {
    if (seriesGuard.isCurrent(token)) seriesFailed(err);
    return;
  }
  // Se ignora una respuesta tardía si mientras tanto se eligió otra área.
  if (!seriesGuard.isCurrent(token)) return;
  state.series = { months: all.months, value: sumSeries(all.months, all.data, code) };
  renderChart();
}

async function selectDepartment(props) {
  state.selected = { in1: props.in1, depto: props.depto, provincia: props.provincia };
  state.province = props.in1.slice(0, 2);
  $('sel-prov').value = state.province;
  fillDeptoSelect(state.province, props.in1);
  state.geoLayer.setStyle(featureStyle);
  $('panel-title').textContent = `${props.depto} (${props.provincia})`;
  $('panel-info').textContent = 'Cargando serie…';
  const token = seriesGuard.next();
  // Se descarta la serie anterior para que un cambio de mes durante la carga no pueda
  // escribir sus números en el panel bajo el nuevo título.
  state.series = null;
  renderYearsChart();
  let series;
  try {
    series = await fetchJson(`serie.php?in1=${encodeURIComponent(props.in1)}`, 'serie.php');
  } catch (err) {
    // Se ignora un fallo tardío si mientras tanto se eligió otra área.
    if (seriesGuard.isCurrent(token)) seriesFailed(err);
    return;
  }
  // Se ignora una respuesta tardía si mientras tanto se eligió otra área.
  if (!seriesGuard.isCurrent(token)) return;
  state.series = series;
  renderChart();
}

function setupChartExpand(btnId, panelId) {
  const btn = $(btnId);
  const panel = $(panelId);
  const setExpanded = (on) => {
    panel.classList.toggle('is-expanded', on);
    btn.setAttribute('aria-pressed', String(on));
    const label = on ? 'Reducir gráfico' : 'Ampliar gráfico';
    btn.setAttribute('aria-label', label);
    btn.title = label;
  };
  btn.addEventListener('click', () => setExpanded(!panel.classList.contains('is-expanded')));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setExpanded(false);
  });
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
  const parts = [`${monthLabel(state.month)}: ${formatNumber(s.value[idx], VALUE_DECIMALS)} ${UNIT}`];
  // Las clases de anomalía existen solo por departamento, no para los totales del país o de una provincia.
  if (s.anomaly) parts.push(`anomalía: ${anomalyLabel(s.anomaly[idx], CLASS_LABELS).toLowerCase()}`);
  $('panel-info').textContent = parts.join(' · ');
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
  renderYearsChart();
}

// ---------- Comparación de años ----------

function setupYears() {
  state.years = [...new Set(state.months.map((m) => splitMonth(m).year))].sort((a, b) => a - b);
  const sel = $('years-add');
  sel.addEventListener('change', () => {
    if (sel.value) toggleYear(Number(sel.value), true);
  });
  // Se empieza con el año más reciente para que el gráfico sea visible desde el principio.
  toggleYear(state.years[state.years.length - 1], true);
}

// El desplegable ofrece los años aún no elegidos; los elegidos son chips con un botón para quitarlos.
function renderYearControls() {
  const sel = $('years-add');
  const free = state.years.filter((y) => !state.yearSlots.has(y));
  sel.replaceChildren(
    new Option(free.length ? 'Elegir…' : 'Están todos', ''),
    ...free.map((y) => new Option(String(y), String(y))),
  );
  sel.value = '';
  sel.disabled = !free.length;

  const chosen = [...state.yearSlots.keys()].sort((a, b) => a - b);
  $('years-chips').replaceChildren(...chosen.map((year) => {
    const li = document.createElement('li');
    const swatch = document.createElement('i');
    swatch.className = 'visor-year-swatch';
    swatch.style.background = yearColor(state.yearSlots.get(year));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Quitar ${year}`);
    remove.title = `Quitar ${year}`;
    remove.addEventListener('click', () => {
      toggleYear(year, false);
      sel.focus(); // el botón ya no existe; se mantiene el foco del teclado en el filtro
    });
    li.append(swatch, String(year), remove);
    return li;
  }));
}

function toggleYear(year, on) {
  if (on) {
    const used = new Set(state.yearSlots.values());
    let slot = 0;
    while (used.has(slot)) slot += 1;
    state.yearSlots.set(year, slot);
  } else {
    state.yearSlots.delete(year);
  }
  renderYearControls();
  renderYearsChart();
}

function renderYearsChart() {
  const s = state.series;
  const years = [...state.yearSlots.keys()].sort((a, b) => a - b);
  $('years-title').textContent = `Comparación por año — ${$('panel-title').textContent}`;
  if (state.yearsChart) state.yearsChart.destroy();
  state.yearsChart = null;
  const wrap = $('years-chart-wrap');
  if (!years.length || !s) {
    wrap.hidden = true;
    // Sin una serie, se muestra el estado propio del panel (cargando o el error).
    $('years-hint').textContent = years.length ? $('panel-info').textContent : 'Elija uno o más años para ver el gráfico.';
    return;
  }
  wrap.hidden = false;
  $('years-hint').textContent = `Promedio, máximo y mínimo de cada mes en el período ${CLIM_PERIOD}.`;
  const stats = monthlyStats(s.months, s.value, config.climatology.from, config.climatology.to);
  const reference = (label, data, style) => ({ label, data, pointRadius: 0, order: 1, ...style });
  state.yearsChart = new Chart($('years-chart'), {
    type: 'line',
    data: {
      labels: MONTH_NAMES.map((name) => name.slice(0, 3)),
      datasets: [
        ...years.map((year) => {
          const color = yearColor(state.yearSlots.get(year));
          return {
            label: String(year),
            data: yearValues(s.months, s.value, year),
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
          };
        }),
        reference(`Máximo ${CLIM_PERIOD}`, stats.max, { borderColor: '#52514e', borderWidth: 1.5, borderDash: [6, 4] }),
        reference(`Promedio ${CLIM_PERIOD}`, stats.mean, { borderColor: '#000', backgroundColor: '#000', borderWidth: 2 }),
        reference(`Mínimo ${CLIM_PERIOD}`, stats.min, { borderColor: '#52514e', borderWidth: 1.5, borderDash: [2, 3] }),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, title: { display: true, text: UNIT_TITLE } },
      },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 14 } },
        tooltip: {
          filter: (item) => item.raw !== null,
          callbacks: {
            label: (item) => {
              const decimals = item.dataset.label.startsWith('Promedio') ? 1 : VALUE_DECIMALS;
              return `${item.dataset.label}: ${formatNumber(item.raw, decimals)}`;
            },
          },
        },
      },
    },
  });
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
  state.map = createMap(geo);
  setupChartExpand('chart-expand', 'panel');
  setupChartExpand('years-expand', 'years');
  if (!state.months.length) {
    showError('No hay meses con datos en la carpeta datos/.');
    $('map-title').textContent = '';
    return;
  }
  const latest = setupControls();
  setupAreaFilters(geo);
  setupYears();
  try {
    await loadMonth(latest);
  } catch (err) {
    showError(err.message);
  }
  showArea('');
}

init();
