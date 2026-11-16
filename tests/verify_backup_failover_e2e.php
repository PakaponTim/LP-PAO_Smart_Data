<?php
// =========================================================================
// Water_System2 — 4-Layer Disaster Recovery & Failover E2E Verification
// Usage: php tests/verify_backup_failover_e2e.php
// =========================================================================

date_default_timezone_set('Asia/Bangkok');
ini_set('display_errors', '1');
error_reporting(E_ALL);

require_once __DIR__ . '/../php_server/config.php';
require_once __DIR__ . '/../php_server/backup_manager.php';

$pass = 0;
$fail = 0;

function t_assert(bool $cond, string $label, string $detail = ''): void {
    global $pass, $fail;
    if ($cond) {
        $pass++;
        echo "[PASS] {$label}" . ($detail !== '' ? " -> {$detail}" : '') . "\n";
    } else {
        $fail++;
        echo "[FAIL] {$label}" . ($detail !== '' ? " -> {$detail}" : '') . "\n";
    }
}

echo "=================================================================\n";
echo "Water_System2 Backup, Local Spool & Cloud Failover E2E Test\n";
echo "=================================================================\n\n";

// 1. Approach 1: Local Disk Spool enqueue + flush roundtrip (cleaned up cleanly afterward)
$spRes = db_spool_enqueue_module('pm25', [[
    'record_date'        => 'TEST_SPOOL_ROW',
    'station_name'       => '__E2E_SPOOL_TEST__',
    'tambon'             => 'เมืองลำปาง',
    'amphoe'             => 'เมืองลำปาง',
    'province'           => 'ลำปาง',
    'time_label'         => '20:00',
    'pm25_value'         => 12.3,
    'pm25_avg_24h'       => null,
    'air_quality_status' => 'ดีมาก',
]], date('Y-m-d H:i:s'));

t_assert(!empty($spRes['spooled']) && db_spool_count() >= 1, 'Approach 1: Local DB Spool writes snapshot file when DB unavailable', $spRes['file'] ?? '');

$flushRes = flush_db_spool(50);
t_assert(($flushRes['flushed'] ?? 0) >= 1 && db_spool_count() === 0, 'Approach 1: flush_db_spool() replays buffered files into MySQL cleanly', "flushed={$flushRes['flushed']}, remaining={$flushRes['remaining']}");

// Clean synthetic row + batch created during test so production table stays clean
try {
    $pdo = get_db();
    $pdo->prepare("DELETE FROM tbl_pm25_monitoring WHERE station_name = ? AND record_date = ?")->execute(['__E2E_SPOOL_TEST__', 'TEST_SPOOL_ROW']);
    if (!empty($spRes['id'])) {
        $pdo->prepare("DELETE FROM app_ingest_batches WHERE batch_id = ?")->execute(['cloud_sync:' . $spRes['id']]);
    }
    $pdo->prepare("DELETE FROM tbl_system_logs WHERE module = 'db_spool' AND started_at >= NOW() - INTERVAL 1 MINUTE")->execute();
} catch (Throwable $e) {
    // ignore cleanup notice
}

// 2. Approach 2: Pure-PHP Full MySQL Backup (.sql.gz across all 10 tables)
$bk = run_full_mysql_backup(false, 'e2e_test');
t_assert(!empty($bk['success']) && ($bk['tables'] ?? 0) >= 10 && file_exists($bk['path'] ?? ''), 'Approach 2: Pure-PHP MySQL backup generates archive covering all 10 tables', "{$bk['filename']} ({$bk['sizeKb']} KB, {$bk['rows']} rows)");

$bkPath = (string)($bk['path'] ?? '');
$foundTables = [];
$hasFooter = false;
if ($bkPath !== '' && file_exists($bkPath)) {
    $isGz = substr($bkPath, -3) === '.gz' && function_exists('gzopen');
    $fpRead = $isGz ? @gzopen($bkPath, 'rb') : @fopen($bkPath, 'rb');
    if ($fpRead) {
        while (!($isGz ? gzeof($fpRead) : feof($fpRead))) {
            $line = $isGz ? gzgets($fpRead, 65536) : fgets($fpRead, 65536);
            if ($line === false) break;
            if (strpos($line, 'CREATE TABLE') !== false) {
                if (preg_match('/CREATE TABLE\s+`([^`]+)`/', $line, $m)) {
                    $foundTables[$m[1]] = true;
                }
            }
            if (strpos($line, 'FOREIGN_KEY_CHECKS = 1') !== false) {
                $hasFooter = true;
            }
        }
        if ($isGz) gzclose($fpRead); else fclose($fpRead);
    }
}
t_assert(
    isset($foundTables['tbl_water_disaster_monitoring']) && isset($foundTables['tbl_system_logs']) && $hasFooter,
    'Approach 2: Decompressed SQL dump contains valid DDL + data integrity footer',
    'tablesInSql=' . count($foundTables)
);

// 3. Approach 3: GitHub Failover Alert script CLI check
$tmpSnapPath = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'e2e_failover_snap.json';
write_json_file($tmpSnapPath, [
    'recorded_at' => date('Y-m-d H:i:s'),
    'water'       => [['station_name' => 'TestStation', 'amphoe' => 'เมืองลำปาง', 'current_water_level_m' => 9.9, 'status' => 'น้ำล้นตลิ่ง', 'risk_level' => 'วิกฤต']],
    'rainfall'    => [['station_name' => 'RainStation', 'rain_mm' => 95.5]],
    'drought'     => [['dam_name' => 'TestDam', 'water_percent' => 15.0]],
    'pm25'        => [['station_name' => 'AirStation', 'pm25_value' => 88.0]],
    'complaints'  => []
]);
$cmdOut = [];
$cmdRc = 0;
exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__DIR__ . '/../php_server/github_failover_alert.php') . ' --snapshot=' . escapeshellarg($tmpSnapPath) . ' --server-status=down 2>&1', $cmdOut, $cmdRc);
@unlink($tmpSnapPath);
t_assert($cmdRc === 0 && strpos(implode("\n", $cmdOut), 'ServerStatus=down') !== false, 'Approach 3: github_failover_alert.php evaluates crisis thresholds cleanly on failover', implode(' | ', $cmdOut));

// 4. Live HTTP Endpoints on 127.0.0.1:7000
$base = 'http://127.0.0.1:7000';
$httpChecks = [
    '/endpoint.php?r=/api/backup/status',
    '/endpoint.php?r=/api/cloud-fallback',
    '/endpoint.php?r=/api/health',
    '/endpoint.php?r=/api/analytics/risk-index',
    '/endpoint.php?r=/api/gis/map-data',
    '/emergency_cloud.html',
    '/server_setup.php',
];

foreach ($httpChecks as $p) {
    $ch = curl_init($base . $p);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8]);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $ok = ($code === 200 && is_string($body) && strlen($body) > 50);
    if ($p === '/endpoint.php?r=/api/gis/map-data') {
        $j = json_decode((string)$body, true);
        $ok = $ok && !empty($j['success']) && array_key_exists('cloudFallback', $j);
    } elseif ($p === '/endpoint.php?r=/api/backup/status') {
        $j = json_decode((string)$body, true);
        $ok = $ok && !empty($j['success']) && !empty($j['backups']);
    } elseif ($p === '/endpoint.php?r=/api/cloud-fallback') {
        $j = json_decode((string)$body, true);
        $ok = $ok && !empty($j['success']) && !empty($j['snapshot']);
    } elseif ($p === '/server_setup.php') {
        $ok = $ok && strpos($body, 'emergency_cloud.html') !== false && strpos($body, 'DB_PASS') !== false;
    }
    t_assert($ok, "HTTP 200 Check: {$p}", "code={$code}, bytes=" . strlen((string)$body));
}

// Download stream header check
$chDl = curl_init($base . '/endpoint.php?r=/api/backup/download');
curl_setopt_array($chDl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_NOBODY => true, CURLOPT_TIMEOUT => 8]);
curl_exec($chDl);
$dlCode = (int)curl_getinfo($chDl, CURLINFO_HTTP_CODE);
$dlLen  = (int)curl_getinfo($chDl, CURLINFO_CONTENT_LENGTH_DOWNLOAD);
curl_close($chDl);
t_assert($dlCode === 200 && $dlLen > 1000, 'Approach 2: GET /api/backup/download streams archive headers cleanly', "HTTP {$dlCode}, bytes={$dlLen}");

echo "\n=================================================================\n";
echo "BACKUP & FAILOVER E2E SUMMARY: PASS={$pass}, FAIL={$fail}\n";
echo "=================================================================\n";

exit($fail > 0 ? 1 : 0);
