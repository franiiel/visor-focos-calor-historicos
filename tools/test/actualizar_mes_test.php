<?php
// Pruebas en PHP plano para visor_deptos/lib/actualizar_mes.php (sin framework).
// Ejecución: php tools/test/actualizar_mes_test.php  -> código de salida 0 cuando pasan todas las verificaciones.

require __DIR__ . '/../../visor_deptos/lib/actualizar_mes.php';

$failures = 0;
$checks = 0;

function check($name, $ok)
{
    global $failures, $checks;
    $checks++;
    if ($ok) {
        echo "ok   - $name\n";
    } else {
        $failures++;
        echo "FAIL - $name\n";
    }
}

function square($x0, $y0, $x1, $y1)
{
    return [[$x0, $y0], [$x1, $y0], [$x1, $y1], [$x0, $y1], [$x0, $y0]];
}

// ---------- Geometría y clase (mismos casos que las pruebas de Node) ----------

$rings = [square(0, 0, 4, 4), square(1, 1, 2, 2)];
check('inside', monthly_in_polygon(0.5, 0.5, $rings));
check('outside', !monthly_in_polygon(5, 0.5, $rings));
check('in the hole', !monthly_in_polygon(1.5, 1.5, $rings));

$feature = function ($link, $polygons) {
    return ['type' => 'Feature', 'properties' => ['LINK' => $link], 'geometry' => ['type' => 'MultiPolygon', 'coordinates' => $polygons]];
};
$geo = ['type' => 'FeatureCollection', 'features' => [
    $feature('6021', [[square(0, 0, 1, 1)]]),
    $feature('22007', [[square(1, 0, 2, 1), square(1.4, 0.4, 1.6, 0.6)], [square(5, 5, 6, 6)]]),
]];
$depts = monthly_departments($geo);
check('departments zero padded and sorted', array_column($depts, 0) === ['06021', '22007']);
check('each side of a border', monthly_find_department($depts, 0.9, 0.5) === '06021' && monthly_find_department($depts, 1.1, 0.5) === '22007');
check('second MultiPolygon part', monthly_find_department($depts, 5.5, 5.5) === '22007');
check('hole and outside are null', monthly_find_department($depts, 1.5, 0.5) === null && monthly_find_department($depts, -3, 0.5) === null);

$stats = ['max' => 10, 'mean' => 5, 'min' => 1];
check('class rule from 5 down', array_map(function ($v) use ($stats) {
    return monthly_anomaly_class($v, $stats);
}, [11, 10, 6, 5, 4, 2, 1, 0]) === [5, 4, 4, 3, 2, 2, 1, 1]);
check('upper edge of the normal band is normal', monthly_anomaly_class(11, ['max' => 20, 'mean' => 10, 'min' => 0]) === 3);
check('never any hotspot: zero is class 1', monthly_anomaly_class(0, ['max' => 0, 'mean' => 0, 'min' => 0]) === 1);

// ---------- Meses y ventanas de descarga ----------

check('previous month', monthly_previous_month(new DateTimeImmutable('2026-01-02')) === '202512');
check('windows of at most 5 days cover the month', monthly_windows('202602') === [
    ['2026-02-01', 5], ['2026-02-06', 5], ['2026-02-11', 5], ['2026-02-16', 5], ['2026-02-21', 5], ['2026-02-26', 3],
]);
$windows = monthly_windows('202601');
check('31-day month ends with a 1-day window', end($windows) === ['2026-01-31', 1]);

// ---------- CLI ----------

function make_dir()
{
    $dir = sys_get_temp_dir() . '/actualizar_mes_test_' . bin2hex(random_bytes(6));
    mkdir($dir . '/datos', 0755, true);
    return $dir;
}

function remove_dir($dir)
{
    foreach (array_merge(glob($dir . '/*/*') ?: [], glob($dir . '/*') ?: []) as $path) {
        is_dir($path) ? @rmdir($path) : @unlink($path);
    }
    @rmdir($dir);
}

function run_cli($args, $env = [])
{
    $cmd = array_merge([PHP_BINARY, __DIR__ . '/../../visor_deptos/lib/actualizar_mes.php'], $args);
    $proc = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $env + ['PATH' => getenv('PATH'), 'SystemRoot' => getenv('SystemRoot')]);
    $out = stream_get_contents($pipes[1]);
    $err = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    return [proc_close($proc), $out, $err];
}

$dir = make_dir();
$config = json_decode(file_get_contents(__DIR__ . '/../../visor_deptos/config.json'), true);
$config['sources'][0]['climatology'] = ['from' => '200101', 'to' => '200212'];
$config['sources'][1]['climatology'] = ['from' => '199901', 'to' => '199912']; // VIIRS: sin referencia en datos/
file_put_contents("$dir/config.json", json_encode($config));
file_put_contents("$dir/geo.json", json_encode($geo));
// Referencia fija (la que escribe tools/compute_anomalies.mjs) de un histórico 2001–2002 con enero
// 06021: 2 y 4 (max 4, mean 3, min 2) y 22007: 1 y 0; mismo caso que tools/test/procesar_mes.test.mjs.
$reference = "in1,mes,max,promedio,min,desvio\n06021,01,4,3,2,1.4142135623730951\n06021,02,0,0,0,0\n"
    . "22007,01,1,0.5,0,0.7071067811865476\n22007,02,0,0,0,0\n";
file_put_contents("$dir/datos/referencia.csv", $reference);
$header = "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight\n";
$row = function ($lat, $lon, $date) {
    return "$lat,$lon,300,1,1,$date,0100,Terra,MODIS,50,6.1NRT,280,10,N\n";
};
file_put_contents("$dir/focos.csv", $header . str_repeat($row(0.5, 0.5, '2003-01-10'), 5)
    . $row(9, 9, '2003-01-10')        // fuera de todo departamento
    . $row(0.5, 1.1, '2003-02-01'));  // otro mes: se ignora
$base = ['--geojson', "$dir/geo.json", '--config', "$dir/config.json", '--datos', "$dir/datos"];

list($code, $out) = run_cli(array_merge($base, ['--mes', '200301', '--csv', "$dir/focos.csv"]));
check('local CSV: exit 0', $code === 0);
check('every department, 0 when no hotspots, classified', @file_get_contents("$dir/datos/focos_200301.csv") === "in1,focos,anomalia\n06021,5,5\n22007,0,1\n");
check('log names the month, assigned and dropped', strpos($out, '200301') !== false && strpos($out, '5 assigned') !== false && strpos($out, '1 outside') !== false);
check('no temporary file left', !glob("$dir/datos/*.tmp"));

// La referencia es fija: un mes del período de climatología no se procesa.
$before = scandir("$dir/datos");
file_put_contents("$dir/focos02.csv", $header . str_repeat($row(0.5, 0.5, '2002-01-05'), 3));
list($code, , $err) = run_cli(array_merge($base, ['--mes', '200201', '--csv', "$dir/focos02.csv"]));
check('month inside the climatology: exit 1 and nothing written',
    $code === 1 && scandir("$dir/datos") === $before && strpos($err, 'inside the reference period (200101-200212)') !== false);

// Sin referencia.csv utilizable no escribe nada, aunque estén los CSV mensuales.
$refCases = [
    'missing referencia.csv' => [null, 'Missing'],
    'empty referencia.csv' => ["in1,mes,max,promedio,min,desvio\n", 'no reference rows'],
    'referencia.csv without its columns' => ["in1,mes,valor\n06021,01,1\n", 'in1,mes,max,promedio,min'],
];
foreach ($refCases as $name => list($content, $message)) {
    unlink("$dir/datos/referencia.csv");
    file_put_contents("$dir/datos/focos_200101.csv", "in1,focos,anomalia\n06021,2,1\n22007,1,4\n");
    if ($content !== null) {
        file_put_contents("$dir/datos/referencia.csv", $content);
    }
    $snapshot = scandir("$dir/datos");
    list($code, , $err) = run_cli(array_merge($base, ['--mes', '200302', '--csv', "$dir/focos.csv"]));
    check("$name: exit 1 and nothing written", $code === 1 && scandir("$dir/datos") === $snapshot && strpos($err, $message) !== false);
    @unlink("$dir/datos/referencia.csv");
    unlink("$dir/datos/focos_200101.csv");
    file_put_contents("$dir/datos/referencia.csv", $reference);
}

$before = scandir("$dir/datos");
file_put_contents("$dir/bad.csv", "Invalid MAP_KEY.\n");
list($code, , $err) = run_cli(array_merge($base, ['--mes', '200302', '--csv', "$dir/bad.csv"]));
check('invalid FIRMS file: exit 1 and nothing written', $code === 1 && scandir("$dir/datos") === $before && strpos($err, 'latitude') !== false);

foreach (['2026-13', '202613', '../x', '20261'] as $bad) {
    list($code) = run_cli(array_merge($base, ['--mes', $bad, '--csv', "$dir/focos.csv"]));
    check("invalid month $bad: exit 1", $code === 1 && scandir("$dir/datos") === $before);
}
list($code, , $err) = run_cli(array_merge($base, ['--mes', '200302']), ['FIRMS_MAP_KEY' => '']);
check('download without FIRMS_MAP_KEY: exit 1 naming it', $code === 1 && strpos($err, 'FIRMS_MAP_KEY') !== false);
list($code, , $err) = run_cli(['--mes', '200302', '--bogus', 'x']);
check('unknown option: exit 1', $code === 1 && strpos($err, '--bogus') !== false);
list($code, , $err) = run_cli(array_merge($base, ['--fuente', '../modis', '--mes', '200301', '--csv', "$dir/focos.csv"]));
check('unknown --fuente: exit 1 naming it', $code === 1 && strpos($err, '../modis') !== false && scandir("$dir/datos") === $before);
// --fuente viirs usa la climatología de VIIRS (1999): 199905 cae dentro de su período, no del de MODIS.
$before = scandir("$dir/datos");
list($code, , $err) = run_cli(array_merge($base, ['--fuente', 'viirs', '--mes', '199905', '--csv', "$dir/focos.csv"]));
check('--fuente viirs: its own climatology',
    $code === 1 && scandir("$dir/datos") === $before && strpos($err, 'inside the reference period (199901-199912)') !== false);
remove_dir($dir);

echo "\n$checks checks, $failures failed\n";
exit($failures === 0 ? 0 : 1);
