<?php
// Plain-PHP tests for visor_deptos/lib/series.php and lib/config.php (no framework).
// Run: php tools/test/series_test.php  -> exit code 0 when every check passes.

require __DIR__ . '/../../visor_deptos/lib/config.php';
require __DIR__ . '/../../visor_deptos/lib/series.php';

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

function make_dir()
{
    $dir = sys_get_temp_dir() . '/series_test_' . bin2hex(random_bytes(6));
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

function write_csv($dataDir, $month, $body, $prefix = 'focos')
{
    $path = $dataDir . "/{$prefix}_$month.csv";
    file_put_contents($path, $body);
    return $path;
}

function fingerprint($dataDir, $config)
{
    clearstatcache();
    return series_data_fingerprint($dataDir, $config);
}

// Same values as visor_deptos/config.json; the UI texts are irrelevant here.
$cfg = [
    'filePrefix' => 'focos',
    'columns' => ['value' => 'focos', 'anomaly' => 'anomalia'],
    'integerValues' => true,
    'climatology' => ['from' => '200101', 'to' => '202012'],
];

$csvA = "in1,focos,anomalia\n06007,10,1.5\n38077,2,-0.5\n";
$csvB = "in1,focos,anomalia\n06007,20,2.5\n38077,4,-1.0\n";

// --- Normal build shape -------------------------------------------------------
$root = make_dir();
$data = $root . '/datos';
write_csv($data, '200101', $csvA);
write_csv($data, '200102', "in1,focos,anomalia\n06007,5,0\n");
$series = series_build($data, $cfg);
check('build: months sorted as strings', $series['months'] === ['200101', '200102']);
check('build: values aligned to months', $series['data']->{'06007'}['value'] === [10, 5]);
check('build: missing month is null', $series['data']->{'38077'}['value'] === [2, null]);
check('build: anomaly parsed as float', $series['data']->{'06007'}['anomaly'] === [1.5, 0.0]);
check('build: clim has 12 entries', count($series['clim']->{'06007'}) === 12);
check('build: clim January mean', $series['clim']->{'06007'}[0] === 10.0);
check('build: clim without data is null', $series['clim']->{'06007'}[5] === null);
remove_dir($root);

// --- Configured dataset -------------------------------------------------------
$root = make_dir();
$data = $root . '/datos';
$viirs = [
    'filePrefix' => 'viirs',
    'columns' => ['value' => 'cantidad', 'anomaly' => 'anom'],
    'integerValues' => false,
    'climatology' => ['from' => '200102', 'to' => '200102'],
];
write_csv($data, '200101', "in1,cantidad,anom\n06007,1.25,0.5\n", 'viirs');
write_csv($data, '200102', "in1,cantidad,anom\n06007,2.5,1\n", 'viirs');
write_csv($data, '200103', $csvA); // focos_ file: ignored with this prefix
$series = series_build($data, $viirs);
check('config: only files with the configured prefix', $series['months'] === ['200101', '200102']);
check('config: configured columns, decimals kept', $series['data']->{'06007'}['value'] === [1.25, 2.5]);
check('config: configured climatology period', $series['clim']->{'06007'}[0] === null && $series['clim']->{'06007'}[1] === 2.5);
check('config: default prefix ignores other datasets', series_build($data, $cfg)['months'] === ['200103']);
$thrown = null;
try {
    series_build($data, ['columns' => ['value' => 'x', 'anomaly' => 'y']] + $viirs);
} catch (SeriesCsvException $e) {
    $thrown = $e;
}
check('config: missing configured column throws naming them', $thrown !== null && strpos($thrown->getMessage(), 'in1,x,y') !== false);
remove_dir($root);

// --- Fingerprint --------------------------------------------------------------
$root = make_dir();
$data = $root . '/datos';
$path = write_csv($data, '200101', $csvA);
$mtime = filemtime($path);
$fp1 = fingerprint($data, $cfg);
check('fingerprint: returns a string', is_string($fp1) && $fp1 !== '');
check('fingerprint: stable when nothing changed', fingerprint($data, $cfg) === $fp1);
check('fingerprint: changes when the config changes', fingerprint($data, ['integerValues' => false] + $cfg) !== $fp1);

write_csv($data, '200101', $csvA . "02007,1,0\n");
touch($path, $mtime);
check('fingerprint: changes with same mtime but different size', fingerprint($data, $cfg) !== $fp1);

write_csv($data, '200101', $csvA);
touch($path, $mtime);
$fpBase = fingerprint($data, $cfg);
$extra = write_csv($data, '200102', $csvA);
check('fingerprint: changes when a file is added', fingerprint($data, $cfg) !== $fpBase);
unlink($extra);
check('fingerprint: back to base when the file is removed', fingerprint($data, $cfg) === $fpBase);
remove_dir($root);

// --- Cache behaviour ----------------------------------------------------------
$root = make_dir();
$data = $root . '/datos';
$cache = $root . '/cache/serie.json';
$path = write_csv($data, '200101', $csvA);
$mtime = filemtime($path);

$json1 = series_cached_json($data, $cache, $cfg);
check('cache: first call returns the built series', json_decode($json1)->data->{'06007'}->value === [10]);
check('cache: file written', is_file($cache));

// Tamper with the cached payload only; a reused cache returns the tampered value.
$raw = file_get_contents($cache);
file_put_contents($cache, str_replace('"value":[10]', '"value":[777]', $raw));
$json2 = series_cached_json($data, $cache, $cfg);
check('cache: reused when nothing changed', strpos($json2, '[777]') !== false);

$json2b = series_cached_json($data, $cache, ['integerValues' => false] + $cfg);
check('cache: rebuilt when the config changes', strpos($json2b, '[777]') === false);

// Same mtime, different content (and size): must rebuild.
write_csv($data, '200101', $csvB . "02007,1,0\n");
touch($path, $mtime);
@touch($data, $mtime);
touch($cache, $mtime + 5); // cache looks newer than every CSV
clearstatcache();
$json3 = series_cached_json($data, $cache, $cfg);
check('cache: rebuilt when a CSV changes with the same mtime', json_decode($json3)->data->{'06007'}->value === [20]);
check('cache: served JSON is plain series JSON', is_array(json_decode($json3, true)['months'] ?? null));
remove_dir($root);

// --- Bad header ---------------------------------------------------------------
$root = make_dir();
$data = $root . '/datos';
$cache = $root . '/cache/serie.json';
write_csv($data, '200101', $csvA);
write_csv($data, '200102', "in1,focos,anomaly\n06007,5,0\n");
$thrown = null;
try {
    series_cached_json($data, $cache, $cfg);
} catch (RuntimeException $e) {
    $thrown = $e;
}
check('bad header: throws RuntimeException', $thrown !== null);
check('bad header: message names the file', $thrown !== null && strpos($thrown->getMessage(), 'focos_200102.csv') !== false);
check('bad header: message does not expose the directory', $thrown !== null && strpos($thrown->getMessage(), $data) === false);
check('bad header: no cache written', !is_file($cache));
remove_dir($root);

// --- Config file --------------------------------------------------------------
$real = visor_config(__DIR__ . '/../../visor_deptos/config.json');
check('config.json: loads and matches the SEPA contract',
    $real['filePrefix'] === 'focos' && $real['columns'] === ['value' => 'focos', 'anomaly' => 'anomalia']);

$root = make_dir();
$file = $root . '/config.json';
file_put_contents($file, "\xEF\xBB\xBF" . json_encode($real));
$withBom = null;
try {
    $withBom = visor_config($file);
} catch (VisorConfigException $e) {
}
check('config: a UTF-8 BOM is accepted', $withBom === $real);

$invalid = [
    'not JSON' => '{',
    'path in prefix' => ['filePrefix' => '../x'],
    'column equal to in1' => ['columns' => ['value' => 'in1', 'anomaly' => 'anomalia']],
    'duplicate columns' => ['columns' => ['value' => 'a', 'anomaly' => 'a']],
    'non-string title' => ['title' => 5],
    'non-boolean integerValues' => ['integerValues' => 'yes'],
    'bad climatology month' => ['climatology' => ['from' => '2001', 'to' => '202012']],
    'climatology from after to' => ['climatology' => ['from' => '202012', 'to' => '200101']],
    'climatology month 13' => ['climatology' => ['from' => '200113', 'to' => '202012']],
    'climatology month 00' => ['climatology' => ['from' => '200101', 'to' => '202000']],
];
foreach ($invalid as $case => $change) {
    file_put_contents($file, is_string($change) ? $change : json_encode(array_replace($real, $change)));
    $thrown = null;
    try {
        visor_config($file);
    } catch (VisorConfigException $e) {
        $thrown = $e;
    }
    check("config: rejects $case", $thrown !== null && strpos($thrown->getMessage(), 'config.json') !== false
        && strpos($thrown->getMessage(), $root) === false);
}
remove_dir($root);

// --- Endpoints ----------------------------------------------------------------
// listar.php and serie.php run as subprocesses on a copy of the viewer with fixture
// data; the CLI keeps the code set by http_response_code(), reported on stderr.

/** Runs $script with $query as $_GET; returns [HTTP status, stdout]. */
function run_endpoint($dir, $script, $query = '')
{
    $runner = $dir . '/run_endpoint.php';
    file_put_contents($runner, '<?php
parse_str($argv[2], $_GET);
register_shutdown_function(function () {
    fwrite(STDERR, "\nHTTP_STATUS=" . (http_response_code() ?: 200) . "\n");
});
require __DIR__ . "/" . $argv[1];
');
    $proc = proc_open([PHP_BINARY, $runner, $script, $query], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    $out = stream_get_contents($pipes[1]);
    $err = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    proc_close($proc);
    return [preg_match('/HTTP_STATUS=(\d+)/', $err, $m) ? (int) $m[1] : 0, $out];
}

$viewer = __DIR__ . '/../../visor_deptos';
$root = make_dir();
mkdir($root . '/lib');
mkdir($root . '/partials');
$copied = ['index.php', 'listar.php', 'serie.php', 'config.json', 'lib/config.php', 'lib/series.php',
    'partials/header.php', 'partials/footer.php'];
foreach ($copied as $file) {
    copy("$viewer/$file", "$root/$file");
}
write_csv($root . '/datos', '200102', "in1,focos,anomalia\n06007,5,0\n");
write_csv($root . '/datos', '200101', $csvA);
write_csv($root . '/datos', '200103', $csvA, 'viirs');

list($status, $out) = run_endpoint($root, 'listar.php');
check('listar.php: 200', $status === 200);
check('listar.php: sorted AAAAMM strings of the configured prefix', json_decode($out, true) === ['200101', '200102']);

list($status, $out) = run_endpoint($root, 'serie.php', 'in1=06007');
$one = json_decode($out, true);
check('serie.php?in1: 200', $status === 200);
check('serie.php?in1: keys in1, months, value, anomaly, clim',
    is_array($one) && array_keys($one) === ['in1', 'months', 'value', 'anomaly', 'clim']);
check('serie.php?in1: values', is_array($one) && $one['in1'] === '06007' && $one['value'] === [10, 5]
    && $one['anomaly'] === [1.5, 0] && count($one['clim']) === 12);

list($status, $out) = run_endpoint($root, 'serie.php');
$all = json_decode($out, true);
check('serie.php: 200 with keys months, data, clim', $status === 200 && is_array($all)
    && array_keys($all) === ['months', 'data', 'clim'] && array_keys($all['data']['06007']) === ['value', 'anomaly']);

check('serie.php?in1=abc: 400', run_endpoint($root, 'serie.php', 'in1=abc')[0] === 400);
check('serie.php?in1=99999: 404', run_endpoint($root, 'serie.php', 'in1=99999')[0] === 404);

list($status, $out) = run_endpoint($root, 'index.php');
preg_match('#<script type="application/json" id="visor-config">(.*?)</script>#s', $out, $m);
check('index.php: 200', $status === 200);
check('index.php: embeds config.json for app.js', isset($m[1]) && json_decode($m[1], true) === $real);
check('index.php: title and chart label come from the config',
    strpos($out, '<h1 class="visor-title">' . htmlspecialchars($real['title']) . '</h1>') !== false
    && strpos($out, 'aria-label="Serie mensual de ' . htmlspecialchars($real['unit']) . ' del departamento"') !== false);

file_put_contents($root . '/config.json', json_encode(array_replace($real, ['filePrefix' => '../x'])));
foreach (['listar.php', 'serie.php'] as $script) {
    list($status, $out) = run_endpoint($root, $script);
    check("$script: invalid config is a 500 naming config.json",
        $status === 500 && strpos((string) (json_decode($out, true)['error'] ?? ''), 'config.json') !== false);
}
list($status, $out) = run_endpoint($root, 'index.php');
check('index.php: invalid config is a 500 naming config.json', $status === 500 && strpos($out, 'config.json') !== false);
remove_dir($root);

echo "\n$checks checks, $failures failed\n";
exit($failures === 0 ? 0 : 1);
