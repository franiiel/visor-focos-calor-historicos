<?php
header('Content-Type: application/json');
$meses = [];
foreach (glob(__DIR__ . '/datos/focos_*.csv') as $f) {
    if (preg_match('/focos_(\d{6})\.csv$/', $f, $m)) $meses[] = $m[1];
}
sort($meses);
echo json_encode($meses);
