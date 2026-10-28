<?php
// Department heat-hotspot viewer. The header and footer partials are placeholders:
// on integration they are replaced by the SEPA site's real header and footer.

// Cache busting: the version changes whenever the file changes.
function asset_version($file)
{
    $t = @filemtime(__DIR__ . '/' . $file);
    return $t ? (string) $t : '0';
}

require __DIR__ . '/lib/config.php';
try {
    $config = visor_config(__DIR__ . '/config.json');
} catch (VisorConfigException $e) {
    error_log('index.php: ' . $e->getMessage());
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Configuración inválida: config.json.';
    exit;
}

function h($text)
{
    return htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
}

$pageTitle = $config['title'];
include __DIR__ . '/partials/header.php';
?>
<main class="visor" id="visor">
  <h1 class="visor-title"><?php echo h($config['title']); ?></h1>
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
      <label><input type="radio" name="layer" value="anomaly" checked> Anomalía</label>
      <label><input type="radio" name="layer" value="value"> <?php echo h($config['valueLabel']); ?></label>
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
        <canvas id="chart" aria-label="Serie mensual de <?php echo h($config['unit']); ?> del departamento" role="img"></canvas>
      </div>
    </aside>
  </div>

  <p class="visor-note"><?php echo h($config['note']); ?></p>
</main>

<script type="application/json" id="visor-config"><?php
echo json_encode($config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE);
?></script>

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
