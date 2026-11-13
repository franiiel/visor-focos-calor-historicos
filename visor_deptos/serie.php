<?php
// Serie mensual de todos los departamentos de una fuente, consolidada a partir de los CSV de
// datos/<id>/ y guardada en caché en cache/serie_<id>.json (ver lib/series.php para la estructura).
//
// Parámetros opcionales:
// - fuente: un id de `sources` en config.json (sin él, la primera fuente). Nunca una ruta.
// - in1 (exactamente 5 dígitos): devuelve solo ese departamento: { "in1", "months", "value", "anomaly", "clim" }.

require __DIR__ . '/lib/config.php';
require __DIR__ . '/lib/series.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

function serie_error($status, $message)
{
    http_response_code($status);
    echo json_encode(['error' => $message]);
    exit;
}

$in1 = null;
if (isset($_GET['in1'])) {
    // \z en lugar de $ para rechazar también un salto de línea final.
    if (!is_string($_GET['in1']) || !preg_match('/^\d{5}\z/', $_GET['in1'])) {
        serie_error(400, 'Parámetro in1 inválido: se esperan 5 dígitos.');
    }
    $in1 = $_GET['in1'];
}

try {
    $config = visor_config(__DIR__ . '/config.json');
} catch (VisorConfigException $e) {
    error_log('serie.php: ' . $e->getMessage());
    serie_error(500, 'Configuración inválida: config.json.');
}
$fuente = $_GET['fuente'] ?? null;
$config = ($fuente === null || is_string($fuente)) ? visor_source($config, $fuente) : null;
if ($config === null) {
    serie_error(400, 'Parámetro fuente inválido.');
}

try {
    $id = $config['id'];
    $json = series_cached_json(__DIR__ . "/datos/$id", __DIR__ . "/cache/serie_$id.json", $config);
} catch (SeriesCsvException $e) {
    // Se nombra solo el archivo; la ruta absoluta queda en el log del servidor.
    error_log('serie.php: ' . $e->getMessage());
    serie_error(500, 'Archivo de datos inválido: ' . $e->csvName
        . ' (se esperan las columnas ' . visor_expected_header($config) . ').');
} catch (Throwable $e) {
    error_log('serie.php: ' . $e->getMessage());
    serie_error(500, 'No se pudo armar la serie.');
}

if ($in1 === null) {
    echo $json;
    exit;
}

// Se decodifica como objetos para que las claves del tipo "06007" se conserven como cadenas.
$all = json_decode($json);
if (!is_object($all) || !isset($all->data->{$in1})) {
    serie_error(404, 'Departamento sin datos.');
}

echo json_encode([
    'in1' => $in1,
    'months' => $all->months,
    'value' => $all->data->{$in1}->value,
    'anomaly' => $all->data->{$in1}->anomaly,
    'clim' => $all->clim->{$in1},
]);
