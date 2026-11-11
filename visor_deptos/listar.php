<?php
// Meses disponibles (AAAAMM) de una fuente de config.json (datos/<id>/).
//
// Parámetro opcional: fuente (un id de `sources`; sin él, la primera fuente). Solo se acepta un id
// de la lista, nunca una ruta.

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
$fuente = $_GET['fuente'] ?? null;
$source = ($fuente === null || is_string($fuente)) ? visor_source($config, $fuente) : null;
if ($source === null) {
    http_response_code(400);
    echo json_encode(['error' => 'Parámetro fuente inválido.']);
    exit;
}
echo json_encode(array_column(series_list_csv(__DIR__ . '/datos/' . $source['id'], $source['filePrefix']), 0));
