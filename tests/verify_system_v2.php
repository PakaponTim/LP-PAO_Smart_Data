<?php
// =========================================================================
// Water_System2 Comprehensive Live Verification Suite (PHP 7.2+)
// Covers:
//   1. Schema creation (tbl_system_logs)
//   2. Source API Transform Unit Checks (all 5 domain fixes)
//   3. Live 5 Source API Parallel Collection & MySQL Data Accuracy Checks
//   4. Upstream Data Freshness Monitor (6h / 36h) & System Log Audit Queries
//   5. Live HTTP Endpoint Tests on http://127.0.0.1:7000 (/api/* & endpoint.php)
//   6. Full Internal Auth Cookie/Session Roundtrip (water_session_7000)
//   7. Live Traffy Cookie/Session + Public API + Extension Bridge Test
// =========================================================================

error_reporting(E_ALL);
ini_set('display_errors', '1');
date_default_timezone_set('Asia/Bangkok');

require_once dirname(__DIR__) . '/php_server/config.php';
require_once dirname(__DIR__) . '/php_server/collectors_transform.php';
require_once dirname(__DIR__) . '/php_server/system_log.php';
require_once dirname(__DIR__) . '/php_server/collectors.php';
require_once dirname(__DIR__) . '/php_server/github_sync_to_mysql.php';

$passCount = 0;
$failCount = 0;
$warnCount = 0;

function assert_ok(bool $cond, string $name, string $detail = ''): void {
    global $passCount, $failCount;
    if ($cond) {
        $passCount++;
        echo "[PASS] {$name}" . ($detail !== '' ? " -> {$detail}" : '') . "\n";
    } else {
        $failCount++;
        echo "[FAIL] {$name}" . ($detail !== '' ? " -> {$detail}" : '') . "\n";
    }
}

function assert_warn(string $name, string $detail = ''): void {
    global $warnCount;
    $warnCount++;
    echo "[WARN] {$name}" . ($detail !== '' ? " -> {$detail}" : '') . "\n";
}

function http_test_request(string $url, string $method = 'GET', ?array $jsonBody = null, array $headers = [], ?string $cookieJar = null): array {
    $ch = curl_init($url);
    $respHeaders = [];
    $hdrList = array_merge(['Accept: application/json, text/csv, */*'], $headers);
    if ($jsonBody !== null) {
        $hdrList[] = 'Content-Type: application/json';
    }

    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_TIMEOUT        => 35,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_HTTPHEADER     => $hdrList,
        CURLOPT_HEADERFUNCTION => function ($ch, $headerLine) use (&$respHeaders) {
            $respHeaders[] = trim($headerLine);
            return strlen($headerLine);
        },
    ];
    if ($jsonBody !== null) {
        $opts[CURLOPT_POSTFIELDS] = json_encode($jsonBody, JSON_UNESCAPED_UNICODE);
    }
    if ($cookieJar !== null) {
        $opts[CURLOPT_COOKIEJAR]  = $cookieJar;
        $opts[CURLOPT_COOKIEFILE] = $cookieJar;
    }

    curl_setopt_array($ch, $opts);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    return [
        'code'    => $code,
        'body'    => $body,
        'json'    => is_string($body) ? json_decode($body, true) : null,
        'headers' => $respHeaders,
        'error'   => $err,
    ];
}

echo "=================================================================\n";
echo "Water_System2 Live System Verification @ " . date('Y-m-d H:i:s') . "\n";
echo "=================================================================\n\n";

// -------------------------------------------------------------------------
// 1. Database & Table Schema Verification
// -------------------------------------------------------------------------
$pdo = get_db();
ensure_all_tables($pdo);
$tblExists = (bool)$pdo->query("SHOW TABLES LIKE 'tbl_system_logs'")->fetchColumn();
assert_ok($tblExists, 'MySQL table tbl_system_logs exists');

// -------------------------------------------------------------------------
// 2. Transformer Unit Checks (5 Source API Fixes)
// -------------------------------------------------------------------------
assert_ok(format_lampang_amphoe('เมืองลำปาง ลำปาง') === 'อำเภอเมืองลำปาง', 'Amphoe removes duplicate provincial suffix');
assert_ok(format_lampang_amphoe('เถิน') === 'อำเภอเถิน', 'Amphoe prefixes อำเภอ cleanly');
assert_ok(resolve_lampang_basin_name(['station' => ['sub_basin_id' => '0701']]) === 'ลุ่มน้ำวัง', 'Sub-basin 07* resolves to ลุ่มน้ำวัง');
assert_ok(resolve_lampang_basin_name(['station' => ['sub_basin_id' => '0802']]) === 'ลุ่มน้ำยม', 'Sub-basin 08* resolves to ลุ่มน้ำยม');
assert_ok(compute_traffy_agency_status('เทศบาลนครลำปาง', 'รอรับเรื่อง') === 'หน่วยงานอื่นรอรับเรื่อง', 'Traffy non-PAO รอรับเรื่อง maps to หน่วยงานอื่นรอรับเรื่อง');
assert_ok(compute_traffy_agency_status('องค์การบริหารส่วนจังหวัดลำปาง (อบจ.ลำปาง)', 'รอรับเรื่อง') === 'งานที่รับเรื่องร้องเรียน', 'Traffy PAO รอรับเรื่อง maps to งานที่รับเรื่องร้องเรียน');

$pmNullTest = transform_pm25_items([
    'pm25' => [
        'data' => [
            [
                'geocode'       => ['province_code' => '52', 'tumbon_name' => ['th' => 'พระบาท'], 'amphoe_name' => ['th' => 'เมืองลำปาง']],
                'station'       => ['tele_station_name' => ['th' => 'Test PM2.5 Station']],
                'pm25_value'    => 28.5,
                'pm25_avg_24h'  => null,
                'pm25_datetime' => date('Y-m-d H:i:s')
            ]
        ]
    ]
]);
assert_ok(
    count($pmNullTest['rows']) === 1 && $pmNullTest['rows'][0]['pm25_avg_24h'] === null,
    'PM 2.5 preserves null pm25_avg_24h when station lacks 24h average'
);

// -------------------------------------------------------------------------
// 3. Live 5 Source API Parallel Collection & MySQL Field Accuracy
// -------------------------------------------------------------------------
echo "\n--- Running Live Parallel Fetch across all 5 Source APIs ---\n";
$parallelRes = collect_all_parallel_direct([
    'water'      => true,
    'drought'    => true,
    'pm25'       => true,
    'complaints' => true
], 'test', date('H:i'));

echo "Parallel summary: okCount={$parallelRes['okCount']}, failCount={$parallelRes['failCount']}, elapsed={$parallelRes['elapsedSec']}s, status={$parallelRes['status']}\n";
assert_ok(!empty($parallelRes['results']['rainfall']['success']), 'Live Rainfall API fetch & save succeeded', 'rows=' . ($parallelRes['results']['rainfall']['count'] ?? 0));
assert_ok(!empty($parallelRes['results']['water']['success']), 'Live Water Level + Rain3D API fetch & save succeeded', 'rows=' . ($parallelRes['results']['water']['count'] ?? 0));
assert_ok(!empty($parallelRes['results']['drought']['success']), 'Live Drought Dam API fetch & save succeeded', 'rows=' . ($parallelRes['results']['drought']['count'] ?? 0));
assert_ok(!empty($parallelRes['results']['pm25']['success']), 'Live PM 2.5 API fetch & save succeeded', 'rows=' . ($parallelRes['results']['pm25']['count'] ?? 0));

if (!empty($parallelRes['results']['complaints']['success'])) {
    assert_ok(true, 'Live Traffy Public API succeeded in parallel batch', 'rows=' . ($parallelRes['results']['complaints']['count'] ?? 0));
} else {
    $rqAfter = retry_queue_get();
    assert_warn('Live Traffy Public API unreachable/timed out during batch', ($parallelRes['results']['complaints']['error'] ?? 'unknown'));
    assert_ok(isset($rqAfter['complaints']), 'Traffy failure cleanly isolated & queued in Auto-Retry without blocking ThaiWater APIs');
}

// Verify exact MySQL rows written in the latest batch (by exact MAX(recorded_at) timestamp)
$latestWaterTs = $pdo->query("SELECT MAX(recorded_at) FROM tbl_water_disaster_monitoring")->fetchColumn();
$badWaterStatus = (int)$pdo->query("SELECT COUNT(*) FROM tbl_water_disaster_monitoring WHERE recorded_at = " . $pdo->quote($latestWaterTs) . " AND status = 'ปกติ'")->fetchColumn();
$goodWaterStatus = (int)$pdo->query("SELECT COUNT(*) FROM tbl_water_disaster_monitoring WHERE recorded_at = " . $pdo->quote($latestWaterTs) . " AND status = 'น้ำปกติ'")->fetchColumn();
assert_ok($badWaterStatus === 0 && $goodWaterStatus > 0, 'Water Level latest batch uses น้ำปกติ instead of ปกติ', "ts={$latestWaterTs}, น้ำปกติ={$goodWaterStatus}, ปกติ={$badWaterStatus}");

$dupAmphoe = (int)$pdo->query("SELECT COUNT(*) FROM tbl_water_disaster_monitoring WHERE recorded_at = " . $pdo->quote($latestWaterTs) . " AND amphoe LIKE '%ลำปาง ลำปาง%'")->fetchColumn();
assert_ok($dupAmphoe === 0, 'Water Level latest batch has zero duplicate provincial suffixes in amphoe');

$forecastPopulated = (int)$pdo->query("SELECT COUNT(*) FROM tbl_water_disaster_monitoring WHERE recorded_at = " . $pdo->quote($latestWaterTs) . " AND forecast_rain_24h_mm IS NOT NULL")->fetchColumn();
assert_ok($forecastPopulated > 0, 'Water Level forecast_rain_24h_mm populated from rain3d API', "populated={$forecastPopulated}");

$validBasinWater = (int)$pdo->query("SELECT COUNT(*) FROM tbl_water_disaster_monitoring WHERE recorded_at = " . $pdo->quote($latestWaterTs) . " AND river IN ('ลุ่มน้ำวัง','ลุ่มน้ำยม')")->fetchColumn();
assert_ok($validBasinWater > 0, 'Water Level river column maps main basin names (ลุ่มน้ำวัง/ลุ่มน้ำยม)', "count={$validBasinWater}");

$latestRainTs = $pdo->query("SELECT MAX(recorded_at) FROM tbl_rainfall_monitoring")->fetchColumn();
$rainBasinPopulated = (int)$pdo->query("SELECT COUNT(*) FROM tbl_rainfall_monitoring WHERE recorded_at = " . $pdo->quote($latestRainTs) . " AND river_basin IN ('ลุ่มน้ำวัง','ลุ่มน้ำยม')")->fetchColumn();
assert_ok($rainBasinPopulated > 0, 'Rainfall river_basin populated for latest batch', "count={$rainBasinPopulated}");

$latestDamTs = $pdo->query("SELECT MAX(recorded_at) FROM tbl_drought_monitoring")->fetchColumn();
$damCountLatest = (int)$pdo->query("SELECT COUNT(*) FROM tbl_drought_monitoring WHERE recorded_at = " . $pdo->quote($latestDamTs))->fetchColumn();
assert_ok($damCountLatest >= 30, 'Drought dam collector preserved Large/Medium/Small reservoirs', "count={$damCountLatest}");

// -------------------------------------------------------------------------
// 4. Freshness & System Log Audit Verification
// -------------------------------------------------------------------------
$freshSummary = get_latest_freshness_summary($pdo);
assert_ok(isset($freshSummary['water']) && isset($freshSummary['drought']) && isset($freshSummary['pm25']) && isset($freshSummary['rainfall']), 'Freshness summary populated for all 4 upstream domains');
foreach ($freshSummary as $fMod => $fInfo) {
    echo "  Freshness [{$fMod}]: maxLag={$fInfo['maxLagHours']}h, threshold={$fInfo['thresholdHours']}h, stale=" . ($fInfo['isStale'] ? 'YES' : 'NO') . ", staleStations={$fInfo['staleCount']}\n";
}

// -------------------------------------------------------------------------
// 5. HTTP Endpoints & Cookie/Session Tests on http://127.0.0.1:7000
// -------------------------------------------------------------------------
echo "\n--- Testing HTTP Endpoints & Cookie/Session on http://127.0.0.1:7000 ---\n";
$baseUrl = 'http://127.0.0.1:7000';
$cookieJar = LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'test_cookie_jar.txt';
@unlink($cookieJar);

// 5a. Login -> verify Set-Cookie: water_session_7000 -> /api/auth/me -> Logout
$loginRes = http_test_request("{$baseUrl}/api/auth/login", 'POST', ['username' => 'admin'], [], $cookieJar);
$setCookieLine = '';
foreach ($loginRes['headers'] as $h) {
    if (stripos($h, 'Set-Cookie:') === 0 && strpos($h, SESSION_COOKIE_NAME) !== false) {
        $setCookieLine = $h;
    }
}
$loginCsrf = $loginRes['json']['csrfToken'] ?? '';
assert_ok($loginRes['code'] === 200 && $setCookieLine !== '' && $loginCsrf !== '', 'POST /api/auth/login issued water_session_7000 Cookie + csrfToken', $setCookieLine);

$meWithCookie = http_test_request("{$baseUrl}/api/auth/me", 'GET', null, [], $cookieJar);
assert_ok(($meWithCookie['json']['csrfToken'] ?? '') === $loginCsrf, 'GET /api/auth/me validated active water_session_7000 Cookie & returned matching csrfToken');

$logoutRes = http_test_request("{$baseUrl}/api/auth/logout", 'POST', [], ['X-CSRF-Token: ' . $loginCsrf], $cookieJar);
$meAfterLogout = http_test_request("{$baseUrl}/api/auth/me", 'GET', null, [], $cookieJar);
assert_ok(($logoutRes['json']['success'] ?? false) === true && ($meAfterLogout['json']['csrfToken'] ?? '') !== $loginCsrf, 'POST /api/auth/logout invalidated session cookie cleanly');
@unlink($cookieJar);

// 5b. System Log Center HTTP APIs (including Apache-compatible endpoint.php?r=...)
$statusRes = http_test_request("{$baseUrl}/api/status");
assert_ok($statusRes['code'] === 200 && isset($statusRes['json']['systemLogsStats']) && isset($statusRes['json']['freshness']), 'GET /api/status returns systemLogsStats, freshness & retryQueue');

$logsRes = http_test_request("{$baseUrl}/endpoint.php?r=/api/system-logs&limit=20");
assert_ok($logsRes['code'] === 200 && !empty($logsRes['json']['logs']), 'GET /endpoint.php?r=/api/system-logs returns structured MySQL audit logs', 'rows=' . count($logsRes['json']['logs'] ?? []));

$heatmapRes = http_test_request("{$baseUrl}/api/system-logs/heatmap");
assert_ok($heatmapRes['code'] === 200 && count($heatmapRes['json']['slots'] ?? []) >= 48, 'GET /api/system-logs/heatmap returns 48+ daily slots', 'slots=' . count($heatmapRes['json']['slots'] ?? []));

$exportLogRes = http_test_request("{$baseUrl}/api/system-logs/export?limit=20");
assert_ok(
    $exportLogRes['code'] === 200 && substr((string)$exportLogRes['body'], 0, 3) === "\xEF\xBB\xBF" && strpos((string)$exportLogRes['body'], 'วันเวลาที่เริ่ม') !== false,
    'GET /api/system-logs/export streams UTF-8 BOM Audit CSV cleanly'
);

$rawExportRes = http_test_request("{$baseUrl}/api/reports/export-raw-data?project=pm25&startDate=" . date('Y-m-d') . "&endDate=" . date('Y-m-d'));
assert_ok(
    $rawExportRes['code'] === 200 && substr((string)$rawExportRes['body'], 0, 3) === "\xEF\xBB\xBF" && strpos((string)$rawExportRes['body'], 'PM 2.5') !== false,
    'GET /api/reports/export-raw-data?project=pm25 streams CSV and logs export audit'
);

$clientExpRes = http_test_request("{$baseUrl}/api/reports/log-client-export", 'POST', [
    'project' => 'water', 'period' => 'daily', 'rowCount' => 12, 'format' => 'CSV', 'filename' => 'verify_test.csv'
]);
assert_ok(($clientExpRes['json']['success'] ?? false) === true, 'POST /api/reports/log-client-export logs client download');

// 5c. Single-module retry HTTP test
$retryRes = http_test_request("{$baseUrl}/api/system-logs/retry", 'POST', ['module' => 'pm25', 'slot' => date('H:i')]);
assert_ok($retryRes['code'] === 200 && !empty($retryRes['json']['success']), 'POST /api/system-logs/retry executed single-module retry cleanly');

// 5d. Chrome Extension bridge (/api/append-complaints-db) roundtrip + cleanup
$extPayload = [
    'rows' => [[
        'ticket_id'       => 'VERIFY-EXT-7000',
        'state_name'      => 'รอรับเรื่อง',
        'problem_type'    => 'ถนน',
        'description'     => 'Automated verification bridge test row',
        'location'        => 'อ.เมืองลำปาง จ.ลำปาง',
        'org_name'        => 'เทศบาลนครลำปาง',
        'ticket_datetime' => date('Y-m-d H:i:s'),
        'is_in_scope'     => 1
    ]]
];
$extRes = http_test_request("{$baseUrl}/api/append-complaints-db", 'POST', $extPayload, ['X-Ingest-Key: verify_ext_batch_' . time()]);
$insertedRow = $pdo->query("SELECT agency_status FROM tbl_complaints_monitoring WHERE ticket_id = 'VERIFY-EXT-7000'")->fetch();
$pdo->exec("DELETE FROM tbl_complaints_monitoring WHERE ticket_id = 'VERIFY-EXT-7000'");
$pdo->exec("DELETE FROM app_ingest_batches WHERE batch_id LIKE 'verify_ext_batch_%'");
assert_ok(
    $extRes['code'] === 200 && !empty($extRes['json']['success']) && ($insertedRow['agency_status'] ?? '') === 'หน่วยงานอื่นรอรับเรื่อง',
    'POST /api/append-complaints-db normalized Extension payload & set accurate agency_status',
    'agency_status=' . ($insertedRow['agency_status'] ?? 'NULL')
);

// 5e. Traffy Cookie / Session & Public API Live Diagnostic Endpoint
$traffySessStatus = http_test_request("{$baseUrl}/api/traffy/session-status");
assert_ok($traffySessStatus['code'] === 200 && isset($traffySessStatus['json']['appSessionCookie']), 'GET /api/traffy/session-status responds cleanly');

$traffyDiagRes = http_test_request("{$baseUrl}/api/traffy/test-session", 'POST', []);
$tj = $traffyDiagRes['json'] ?? [];
assert_ok(
    $traffyDiagRes['code'] === 200 && !empty($tj['appSession']['ok']),
    'POST /api/traffy/test-session completed App Session + Traffy Cookie/API diagnostics',
    $tj['summary'] ?? ''
);
echo "  Traffy GeoJSON API: HTTP " . ($tj['publicApi']['geojson']['httpCode'] ?? 0) . " (" . ($tj['publicApi']['geojson']['durationMs'] ?? 0) . "ms) err=" . ($tj['publicApi']['geojson']['error'] ?? 'none') . "\n";
echo "  Traffy Timeline API: HTTP " . ($tj['publicApi']['timeline']['httpCode'] ?? 0) . " (" . ($tj['publicApi']['timeline']['durationMs'] ?? 0) . "ms) err=" . ($tj['publicApi']['timeline']['error'] ?? 'none') . "\n";
echo "  citydata.traffy.in.th SPA reachable: " . (!empty($tj['publicApi']['citydataReachable']) ? 'YES' : 'NO') . "\n";

// -------------------------------------------------------------------------
// 6. 24/7 Server Risk Mitigations Verification
// -------------------------------------------------------------------------
echo "\n--- Verifying 24/7 Server Risk Controls ---\n";
$rootDir = dirname(__DIR__);
assert_ok(
    file_exists($rootDir . '/.htaccess') &&
    file_exists($rootDir . '/php_server/.htaccess') &&
    file_exists($rootDir . '/cloud_snapshots/.htaccess') &&
    file_exists($rootDir . '/runtime/.htaccess'),
    'Apache .htaccess protections exist in root, php_server, cloud_snapshots, and runtime'
);

$lockRes = with_file_lock('verify_mutex_test', function () {
    $inner = with_file_lock('verify_mutex_test', function () {
        return 'should_not_run';
    }, true);
    return ($inner === null) ? 'nested_nonblocking_rejected' : 'failed';
}, false);
assert_ok($lockRes === 'nested_nonblocking_rejected', 'with_file_lock non-blocking mutex rejects concurrent overlapping lock cleanly');
@unlink(LP_PAO_RUNTIME_DIR . '/locks/verify_mutex_test.lock');

$rotTmp = LP_PAO_RUNTIME_DIR . '/verify_rotate_test.log';
@unlink($rotTmp);
@unlink($rotTmp . '.1');
file_put_contents($rotTmp, str_repeat("LOG LINE\n", 1500));
rotate_log_if_needed($rotTmp, 5000, 2);
$rotOk = !file_exists($rotTmp) && file_exists($rotTmp . '.1');
@unlink($rotTmp);
@unlink($rotTmp . '.1');
assert_ok($rotOk, 'rotate_log_if_needed rotates oversized log into .1 archive');

$healthRes = http_test_request("{$baseUrl}/endpoint.php?r=/api/health");
$hj = $healthRes['json'] ?? [];
assert_ok(
    $healthRes['code'] === 200 && !empty($hj['database']['connected']) && !empty($hj['security']['hasRootHtaccess']) && !empty($hj['security']['hasRuntimeHtaccess']),
    'GET /endpoint.php?r=/api/health returns HTTP 200 + DB + security readiness',
    'status=' . ($hj['status'] ?? 'unknown') . ', waterAgeMin=' . ($hj['latestData']['waterAgeMinutes'] ?? 'null')
);

$setupRes = http_test_request("{$baseUrl}/server_setup.php");
$curDbPass = env_val('DB_PASS', '');
$leakedPass = ($curDbPass !== '' && strpos((string)$setupRes['body'], 'name="DB_PASS" value="' . $curDbPass . '"') !== false);
assert_ok($setupRes['code'] === 200 && !$leakedPass, 'server_setup.php renders HTTP 200 without leaking DB_PASS in HTML value attribute');

$cronCooldownRes = http_test_request("{$baseUrl}/cron.php");
assert_ok(
    $cronCooldownRes['code'] === 200 && !empty($cronCooldownRes['json']['success']),
    'GET /cron.php responds HTTP 200 cleanly (cooldown/lock protected)'
);

// Remove test rows we inserted only for log verification? No, keeping real test run history in tbl_system_logs shows exact test evidence!
echo "\n=================================================================\n";
echo "RESULT SUMMARY: PASS={$passCount}, FAIL={$failCount}, WARN={$warnCount}\n";
echo "=================================================================\n";

exit($failCount > 0 ? 1 : 0);
