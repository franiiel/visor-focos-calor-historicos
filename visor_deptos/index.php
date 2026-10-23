<?php
// Department heat-hotspot viewer. The header and footer partials are placeholders:
// on integration they are replaced by the SEPA site's real header and footer.

// Cache busting: the version changes whenever the file changes.
function asset_version($file)
{
    $t = @filemtime(__DIR__ . '/' . $file);
    return $t ? (string) $t : '0';
}

$pageTitle = 'Focos de calor por departamento';
include __DIR__ . '/partials/header.php';
?>
<main class="visor" id="visor">
  <div class="visor-banner" role="note">
    Prototipo con datos sintéticos de prueba — no representan focos reales.
  </div>

  <h1 class="visor-title">Focos de calor por departamento</h1>
  <p class="visor-subtitle" id="map-title" aria-live="polite">Cargando datos…</p>

  <form class="visor-controls" id="controls" onsubmit="return false;">
    <label>Año
      <select id="sel-year" disabled></select>
    </label>
    <label>Mes
      <select id="sel-month" disabled></select>
    </label>
    <fieldset class="visor-layer">
      <legend>Capa</legend>
      <label><input type="radio" name="layer" value="anomalia" checked> Anomalía</label>
      <label><input type="radio" name="layer" value="focos"> Focos totales</label>
    </fieldset>
  </form>

  <div class="visor-error" id="error" role="alert" hidden></div>

  <div class="visor-layout">
    <div class="visor-map-wrap">
      <div id="map" class="visor-map" aria-label="Mapa de departamentos"></div>
      <div class="visor-legend" id="legend" aria-label="Referencias"></div>
    </div>

    <aside class="visor-panel" id="panel">
      <h2 id="panel-title">Serie del departamento</h2>
      <p id="panel-info" class="visor-hint">Seleccione un departamento en el mapa para ver su serie mensual.</p>
      <div class="visor-chart-wrap">
        <canvas id="chart" aria-label="Serie mensual de focos del departamento" role="img"></canvas>
      </div>
    </aside>
  </div>

  <p class="visor-note">
    Anomalía: diferencia entre los focos del mes y el promedio de focos del mismo mes
    en 2001–2020 (supuesto del prototipo; la definición final la establece SEPA).
  </p>
</main>

<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      integrity="sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H"
      crossorigin="anonymous">
<link rel="stylesheet" href="app.css?v=<?php echo asset_version('app.css'); ?>">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        integrity="sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH"
        crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js"
        integrity="sha384-jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe+6DChMTBJemed7ZnvJ"
        crossorigin="anonymous"></script>
<script type="module" src="app.js?v=<?php echo asset_version('app.js'); ?>"></script>
<?php include __DIR__ . '/partials/footer.php'; ?>
