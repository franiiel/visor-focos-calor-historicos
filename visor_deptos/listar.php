<?php
// Meses disponibles (AAAAMM) del conjunto de datos descrito en config.json. Sin parámetros.

require __DIR__ . '/lib/config.php';
require __DIR__ . '/lib/series.php';

header('Content-Type: application/json');
try {
    $config = visor_config(__DIR__ . '/config.json');
} catch (VisorConfigException $e) {
    error_log('listar.php: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'Configuración inválida: config.json.']);
    exit;
}
echo json_encode(array_column(series_list_csv(__DIR__ . '/datos', $config['filePrefix']), 0));
