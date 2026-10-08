<?php
// Monthly series of every department, consolidated from datos/*.csv and cached in
// cache/serie.json (see lib/series.php for the shape).
//
// Optional parameter: in1 (exactly 5 digits). When present, returns only that
// department: { "in1", "months", "focos", "anomalia", "clim" }.

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
    // \z instead of $ so a trailing newline is rejected too.
    if (!is_string($_GET['in1']) || !preg_match('/^\d{5}\z/', $_GET['in1'])) {
        serie_error(400, 'Parámetro in1 inválido: se esperan 5 dígitos.');
    }
    $in1 = $_GET['in1'];
}

try {
    $json = series_cached_json(__DIR__ . '/datos', __DIR__ . '/cache/serie.json');
} catch (SeriesCsvException $e) {
    // Name the file only; the absolute path stays in the server log.
    error_log('serie.php: ' . $e->getMessage());
    serie_error(500, 'Archivo de datos inválido: ' . $e->csvName . ' (se esperan las columnas in1,focos,anomalia).');
} catch (Throwable $e) {
    error_log('serie.php: ' . $e->getMessage());
    serie_error(500, 'No se pudo armar la serie.');
}

if ($in1 === null) {
    echo $json;
    exit;
}

// Decode as objects so "06007"-style keys are kept as strings.
$all = json_decode($json);
if (!is_object($all) || !isset($all->data->{$in1})) {
    serie_error(404, 'Departamento sin datos.');
}

echo json_encode([
    'in1' => $in1,
    'months' => $all->months,
    'focos' => $all->data->{$in1}->focos,
    'anomalia' => $all->data->{$in1}->anomalia,
    'clim' => $all->clim->{$in1},
]);
