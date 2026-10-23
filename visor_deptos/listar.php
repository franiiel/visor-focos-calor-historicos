<?php
// Available months (AAAAMM) of the dataset described in config.json. No parameters.

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
// Month keys are 6-digit strings that PHP turns into int array keys, so cast back.
echo json_encode(array_map('strval', array_keys(series_list_csv(__DIR__ . '/datos', $config['filePrefix']))));
