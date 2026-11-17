<?php
// =========================================================================
// Water_System2 — Direct API Collectors (Sequential & Parallel curl_multi)
// Uses shared transformers in collectors_transform.php + unified logging in system_log.php.
// Pulls directly from:
//   1. https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/rain24?province_code=52
//   2. https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/rain3d?province_code=52
//   3. https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/waterlevel?province_code=52
//   4. https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/dam?province_code=52
//   5. https://api-v3.thaiwater.net/api/v1/thaiwater30/public/thaiwater/weather
//   6. https://publicapi.traffy.in.th/teamchadchart-stat-api/geojson/v1?text=%E0%B8%A5%E0%B8%B3%E0%B8%9B%E0%B8%B2%E0%B8%87
// =========================================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/collectors_transform.php';
require_once __DIR__ . '/system_log.php';
require_once __DIR__ . '/notifier.php';
require_once __DIR__ . '/backup_manager.php';

/**
 * Spools transformed rows to local disk if MySQL write fails during an outage.
 */
function try_spool_failed_module_save(string $module, array $rawJson, array $extra = []): array {
    $rows = [];
    if ($module === 'rainfall') {
        $rows = transform_rainfall_items($rawJson)['rows'] ?? [];
    } elseif ($module === 'water') {
        $rows = transform_water_level_items($rawJson, $extra['rainResult'] ?? [], $extra['rain3dResult'] ?? [])['rows'] ?? [];
    } elseif ($module === 'drought') {
        $rows = transform_drought_items($rawJson)['rows'] ?? [];
    } elseif ($module === 'pm25') {
        $rows = transform_pm25_items($rawJson)['rows'] ?? [];
    } elseif ($module === 'complaints') {
        $rows = transform_traffy_complaints($rawJson, 100);
    }
    return db_spool_enqueue_module($module, $rows);
}

function build_curl_handle(string $url, array $extraHeaders = [], int $timeoutSec = 25) {
    $ch = curl_init($url);
    $headers = array_merge([
        'Accept: application/json, text/plain, */*',
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Origin: https://lampang.thaiwater.net',
        'Referer: https://lampang.thaiwater.net/'
    ], $extraHeaders);

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeoutSec,
        CURLOPT_CONNECTTIMEOUT => min(10, $timeoutSec),
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_HTTPHEADER     => $headers
    ]);
    return $ch;
}

function http_get_json(string $url, array $extraHeaders = [], int $timeoutSec = 25): ?array {
    $ch = build_curl_handle($url, $extraHeaders, $timeoutSec);
    $body = curl_exec($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);

    if ($body === false || $httpCode < 200 || $httpCode >= 300) {
        throw new RuntimeException("HTTP ({$httpCode}): " . ($err ?: $url));
    }

    $decoded = json_decode($body, true);
    if (!is_array($decoded)) {
        throw new RuntimeException("Invalid JSON response from {$url}");
    }
    return $decoded;
}

/**
 * Parallel HTTP JSON fetcher using curl_multi_init().
 * Supports per-request timeout, headers, and accurate per-handle duration metrics.
 *
 * @param array<string, array{url:string, headers?:array, timeout?:int}> $requests
 * @return array<string, array{ok:bool, data:?array, error:?string, httpCode:int, durationMs:int}>
 */
function http_get_json_multi(array $requests, int $defaultTimeoutSec = 25): array {
    $mh = curl_multi_init();
    $handles = [];
    $results = [];
    $startTimes = [];

    foreach ($requests as $key => $cfg) {
        $to = (int)($cfg['timeout'] ?? $defaultTimeoutSec);
        $ch = build_curl_handle($cfg['url'], $cfg['headers'] ?? [], $to);
        $handles[$key] = $ch;
        $startTimes[$key] = microtime(true);
        curl_multi_add_handle($mh, $ch);
    }

    $running = null;
    do {
        $status = curl_multi_exec($mh, $running);
        if ($running > 0) {
            curl_multi_select($mh, 0.2);
        }
    } while ($running > 0 && $status === CURLM_OK);

    foreach ($handles as $key => $ch) {
        $body = curl_multi_getcontent($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $totalTimeMs = (int)round(((float)curl_getinfo($ch, CURLINFO_TOTAL_TIME) ?: (microtime(true) - $startTimes[$key])) * 1000);
        $err = curl_error($ch);

        if ($body === false || $httpCode < 200 || $httpCode >= 300) {
            $results[$key] = [
                'ok'         => false,
                'data'       => null,
                'error'      => "HTTP ({$httpCode}): " . ($err ?: $requests[$key]['url']),
                'httpCode'   => $httpCode,
                'durationMs' => $totalTimeMs
            ];
        } else {
            $decoded = json_decode($body, true);
            if (!is_array($decoded)) {
                $results[$key] = [
                    'ok'         => false,
                    'data'       => null,
                    'error'      => "Invalid JSON from {$requests[$key]['url']}",
                    'httpCode'   => $httpCode,
                    'durationMs' => $totalTimeMs
                ];
            } else {
                $results[$key] = [
                    'ok'         => true,
                    'data'       => $decoded,
                    'error'      => null,
                    'httpCode'   => $httpCode,
                    'durationMs' => $totalTimeMs
                ];
            }
        }

        curl_multi_remove_handle($mh, $ch);
        curl_close($ch);
    }

    curl_multi_close($mh);
    return $results;
}

function record_ingest_batch(PDO $pdo, string $kind, array $payload, ?string $customKey = null): string {
    ensure_ingest_tables($pdo);
    $batchId = $kind . ':' . ($customKey ?: ('php7000-' . date('YmdHis') . '-' . substr(bin2hex(random_bytes(4)), 0, 8)));
    $batchId = substr($batchId, 0, 128);
    $fingerprint = hash('sha256', json_encode($payload, JSON_UNESCAPED_UNICODE));

    $chk = $pdo->prepare("SELECT fingerprint, row_count FROM app_ingest_batches WHERE batch_id = ? LIMIT 1");
    $chk->execute([$batchId]);
    $existing = $chk->fetch();
    if ($existing) {
        if ($existing['fingerprint'] === $fingerprint) {
            return $batchId;
        }
        throw new RuntimeException("Duplicate batch_id conflict ({$batchId})");
    }

    $stmt = $pdo->prepare("INSERT INTO app_ingest_batches (batch_id, kind, fingerprint, row_count) VALUES (?, ?, ?, ?)");
    $stmt->execute([$batchId, $kind, $fingerprint, count($payload)]);
    return $batchId;
}

// =========================================================================
// 1. Direct Collector: Rainfall (197+ Stations in Lampang)
// =========================================================================
function save_rainfall_from_json(array $json, bool $standaloneLog = true, array $logCtx = []): array {
    $pdo = get_db();
    $transformed = transform_rainfall_items($json);
    $rowsToInsert = $transformed['rows'];
    if (empty($rowsToInsert)) {
        throw new RuntimeException('ไม่พบข้อมูลสถานีน้ำฝนจาก ThaiWater30 API');
    }

    $pdo->beginTransaction();
    try {
        $batchId = record_ingest_batch($pdo, 'rainfall', $rowsToInsert);
        $stmt = $pdo->prepare("INSERT INTO tbl_rainfall_monitoring
            (station_name, location, river_basin, rain_mm, rain_status, measured_time, record_date, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW())");
        foreach ($rowsToInsert as $r) {
            $stmt->execute([
                $r['station_name'],
                $r['location'],
                $r['river_basin'],
                $r['rain_mm'],
                $r['rain_status'],
                $r['measured_time'],
                $r['record_date']
            ]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    $count = count($rowsToInsert);
    retry_queue_clear('rainfall');
    $freshness = check_upstream_freshness('rainfall', $transformed['observations']);

    if ($standaloneLog) {
        log_task_run('ดึงข้อมูลน้ำฝน', 'db', 'success', $count, "Direct API บันทึกลง MySQL สำเร็จ {$count} สถานี; batch: {$batchId}");
    }
    sys_log_record([
        'run_group_id'   => $logCtx['run_group_id'] ?? null,
        'module'         => 'rainfall',
        'action'         => 'ดึงข้อมูลปริมาณน้ำฝน 24 ชม.',
        'status'         => 'success',
        'trigger_source' => $logCtx['trigger_source'] ?? ($standaloneLog ? 'manual' : 'system'),
        'scheduled_slot' => $logCtx['scheduled_slot'] ?? null,
        'started_at'     => $logCtx['started_at'] ?? date('Y-m-d H:i:s'),
        'finished_at'    => date('Y-m-d H:i:s'),
        'duration_ms'    => (int)($logCtx['duration_ms'] ?? 0),
        'row_count'      => $count,
        'summary'        => "บันทึกข้อมูลน้ำฝน จ.ลำปาง {$count} สถานี ลง MySQL (Batch: {$batchId})",
        'meta'           => ['batchId' => $batchId, 'staleStations' => $freshness['staleCount'] ?? 0]
    ]);

    return [
        'success'            => true,
        'count'              => $count,
        'batchId'            => $batchId,
        'subdistrictRainAvg' => $transformed['subdistrictRainAvg'],
        'districtRainAvg'    => $transformed['districtRainAvg'],
        'freshness'          => $freshness,
    ];
}

function collect_rainfall_direct(bool $standaloneLog = true, string $triggerSource = 'manual', ?string $scheduledSlot = null): array {
    $startedAt = date('Y-m-d H:i:s');
    $t0 = microtime(true);
    try {
        $json = http_get_json('https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/rain24?province_code=52');
        return save_rainfall_from_json($json, $standaloneLog, [
            'trigger_source' => $triggerSource,
            'scheduled_slot' => $scheduledSlot,
            'started_at'     => $startedAt,
            'duration_ms'    => (int)round((microtime(true) - $t0) * 1000)
        ]);
    } catch (Throwable $e) {
        $dur = (int)round((microtime(true) - $t0) * 1000);
        if ($standaloneLog) {
            log_task_run('ดึงข้อมูลน้ำฝน', 'db', 'failed', 0, 'ล้มเหลว: ' . $e->getMessage());
        }
        sys_log_record([
            'module'         => 'rainfall',
            'action'         => 'ดึงข้อมูลปริมาณน้ำฝน 24 ชม.',
            'status'         => 'failed',
            'trigger_source' => $triggerSource,
            'scheduled_slot' => $scheduledSlot,
            'started_at'     => $startedAt,
            'finished_at'    => date('Y-m-d H:i:s'),
            'duration_ms'    => $dur,
            'row_count'      => 0,
            'summary'        => 'ดึงข้อมูลน้ำฝนไม่สำเร็จ',
            'error_detail'   => $e->getMessage(),
        ]);
        throw $e;
    }
}

// =========================================================================
// 2. Direct Collector: Water Level + Rainfall 24h & 3d Mapping (25 Stations)
// =========================================================================
function save_water_level_from_json(array $json, array $rainResult, string $mode = 'db', array $rain3dResult = [], array $logCtx = []): array {
    $pdo = get_db();
    $transformed = transform_water_level_items($json, $rainResult, $rain3dResult);
    $rowsToInsert = $transformed['rows'];
    if (empty($rowsToInsert)) {
        throw new RuntimeException('ไม่พบข้อมูลระดับน้ำจาก ThaiWater30 API');
    }

    $pdo->beginTransaction();
    try {
        $batchId = record_ingest_batch($pdo, 'water', $rowsToInsert);
        $stmt = $pdo->prepare("INSERT INTO tbl_water_disaster_monitoring
            (station_name, river, amphoe, province, current_water_level_m, left_bank_level_m, bank_difference_m, trend, status, current_rain_mm, forecast_rain_24h_mm, risk_level, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())");
        foreach ($rowsToInsert as $r) {
            $stmt->execute([
                $r['station_name'],
                $r['river'],
                $r['amphoe'],
                $r['province'],
                $r['current_water_level_m'],
                $r['left_bank_level_m'],
                $r['bank_difference_m'],
                $r['trend'],
                $r['status'],
                $r['current_rain_mm'],
                $r['forecast_rain_24h_mm'],
                $r['risk_level']
            ]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    $count = count($rowsToInsert);
    $rainCount = (int)($rainResult['count'] ?? 0);
    $rain3dCount = (int)($rain3dResult['count'] ?? 0);
    $msg = "DB: committed ({$count} สถานีน้ำ + {$rainCount} สถานีฝน24ชม." . ($rain3dCount > 0 ? " + {$rain3dCount} สถานีฝน3วัน" : '') . "); Direct API; batch: {$batchId}";
    log_task_run('ดึงข้อมูลระดับน้ำ', $mode, 'success', $count, $msg);

    retry_queue_clear('water');
    $freshness = check_upstream_freshness('water', $transformed['observations']);

    sys_log_record([
        'run_group_id'   => $logCtx['run_group_id'] ?? null,
        'module'         => 'water',
        'action'         => 'ดึงข้อมูลระดับน้ำรายสถานี',
        'status'         => 'success',
        'trigger_source' => $logCtx['trigger_source'] ?? 'manual',
        'scheduled_slot' => $logCtx['scheduled_slot'] ?? null,
        'started_at'     => $logCtx['started_at'] ?? date('Y-m-d H:i:s'),
        'finished_at'    => date('Y-m-d H:i:s'),
        'duration_ms'    => (int)($logCtx['duration_ms'] ?? 0),
        'row_count'      => $count,
        'summary'        => "บันทึกข้อมูลระดับน้ำ จ.ลำปาง {$count} สถานี ลง MySQL (ฝน3วัน " . ($rain3dCount > 0 ? "{$rain3dCount} จุด" : 'ไม่มีข้อมูล') . ")",
        'meta'           => ['batchId' => $batchId, 'staleStations' => $freshness['staleCount'] ?? 0]
    ]);

    return [
        'success'       => true,
        'count'         => $count,
        'rainfallCount' => $rainCount,
        'rain3dCount'   => $rain3dCount,
        'batchId'       => $batchId,
        'freshness'     => $freshness,
    ];
}

function collect_water_level_direct(string $mode = 'db', string $triggerSource = 'manual', ?string $scheduledSlot = null): array {
    $startedAt = date('Y-m-d H:i:s');
    $t0 = microtime(true);
    try {
        $res = http_get_json_multi([
            'rain'   => ['url' => 'https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/rain24?province_code=52'],
            'rain3d' => ['url' => 'https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/rain3d?province_code=52', 'timeout' => 20],
            'water'  => ['url' => 'https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/waterlevel?province_code=52'],
        ]);

        $rainResult = ['subdistrictRainAvg' => [], 'districtRainAvg' => [], 'count' => 0];
        if (!empty($res['rain']['ok'])) {
            try {
                $rainResult = save_rainfall_from_json($res['rain']['data'], false, [
                    'trigger_source' => $triggerSource,
                    'scheduled_slot' => $scheduledSlot,
                    'started_at'     => $startedAt,
                    'duration_ms'    => $res['rain']['durationMs'] ?? 0
                ]);
            } catch (Throwable $rainErr) {
                sys_log_record([
                    'module' => 'rainfall', 'action' => 'ดึงข้อมูลปริมาณน้ำฝน 24 ชม.', 'status' => 'failed',
                    'trigger_source' => $triggerSource, 'scheduled_slot' => $scheduledSlot,
                    'started_at' => $startedAt, 'duration_ms' => $res['rain']['durationMs'] ?? 0,
                    'summary' => 'ดึงน้ำฝนประกอบระดับน้ำไม่สำเร็จ', 'error_detail' => $rainErr->getMessage()
                ]);
            }
        }

        $rain3dResult = (!empty($res['rain3d']['ok'])) ? transform_rain3d_maps($res['rain3d']['data']) : ['subdistrictRain3dAvg' => [], 'districtRain3dAvg' => [], 'count' => 0];

        if (empty($res['water']['ok'])) {
            throw new RuntimeException($res['water']['error'] ?? 'ดึงข้อมูลระดับน้ำไม่สำเร็จ');
        }

        return save_water_level_from_json($res['water']['data'], $rainResult, $mode, $rain3dResult, [
            'trigger_source' => $triggerSource,
            'scheduled_slot' => $scheduledSlot,
            'started_at'     => $startedAt,
            'duration_ms'    => (int)round((microtime(true) - $t0) * 1000)
        ]);
    } catch (Throwable $e) {
        $dur = (int)round((microtime(true) - $t0) * 1000);
        log_task_run('ดึงข้อมูลระดับน้ำ', $mode, 'failed', 0, 'ล้มเหลว: ' . $e->getMessage());
        sys_log_record([
            'module'         => 'water',
            'action'         => 'ดึงข้อมูลระดับน้ำรายสถานี',
            'status'         => 'failed',
            'trigger_source' => $triggerSource,
            'scheduled_slot' => $scheduledSlot,
            'started_at'     => $startedAt,
            'finished_at'    => date('Y-m-d H:i:s'),
            'duration_ms'    => $dur,
            'row_count'      => 0,
            'summary'        => 'ดึงข้อมูลระดับน้ำไม่สำเร็จ',
            'error_detail'   => $e->getMessage(),
        ]);
        throw $e;
    }
}

// =========================================================================
// 3. Direct Collector: Drought / Dam Storage (36 Dams in Lampang)
// =========================================================================
function save_drought_from_json(array $json, string $mode = 'db', array $logCtx = []): array {
    $pdo = get_db();
    $transformed = transform_drought_items($json);
    $rowsToInsert = $transformed['rows'];
    if (empty($rowsToInsert)) {
        throw new RuntimeException('ไม่พบรายการอ่างเก็บน้ำในจังหวัดลำปางที่มีข้อมูล');
    }

    $pdo->beginTransaction();
    try {
        $batchId = record_ingest_batch($pdo, 'drought', $rowsToInsert);
        $stmt = $pdo->prepare("INSERT INTO tbl_drought_monitoring
            (record_date, dam_type, dam_name, capacity_m_cum, inflow_m_cum, water_volume_m_cum, water_percent, usable_water_m_cum, discharge_m_cum, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())");
        foreach ($rowsToInsert as $r) {
            $stmt->execute([
                $r['record_date'],
                $r['dam_type'],
                $r['dam_name'],
                $r['capacity_m_cum'],
                $r['inflow_m_cum'],
                $r['water_volume_m_cum'],
                $r['water_percent'],
                $r['usable_water_m_cum'],
                $r['discharge_m_cum']
            ]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    $count = count($rowsToInsert);
    $msg = "DB: committed ({$count} อ่างเก็บน้ำ); Direct API; batch: {$batchId}";
    log_task_run('ดึงข้อมูลภัยแล้ง', $mode, 'success', $count, $msg);

    retry_queue_clear('drought');
    $freshness = check_upstream_freshness('drought', $transformed['observations']);

    sys_log_record([
        'run_group_id'   => $logCtx['run_group_id'] ?? null,
        'module'         => 'drought',
        'action'         => 'ดึงข้อมูลอ่างเก็บน้ำ/ภัยแล้ง',
        'status'         => 'success',
        'trigger_source' => $logCtx['trigger_source'] ?? 'manual',
        'scheduled_slot' => $logCtx['scheduled_slot'] ?? null,
        'started_at'     => $logCtx['started_at'] ?? date('Y-m-d H:i:s'),
        'finished_at'    => date('Y-m-d H:i:s'),
        'duration_ms'    => (int)($logCtx['duration_ms'] ?? 0),
        'row_count'      => $count,
        'summary'        => "บันทึกข้อมูลอ่างเก็บน้ำ จ.ลำปาง {$count} แห่ง ลง MySQL เรียบร้อย",
        'meta'           => ['batchId' => $batchId, 'staleStations' => $freshness['staleCount'] ?? 0]
    ]);

    return [
        'success'   => true,
        'count'     => $count,
        'batchId'   => $batchId,
        'freshness' => $freshness,
    ];
}

function collect_drought_direct(string $mode = 'db', string $triggerSource = 'manual', ?string $scheduledSlot = null): array {
    $startedAt = date('Y-m-d H:i:s');
    $t0 = microtime(true);
    try {
        $json = http_get_json('https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/dam?province_code=52');
        return save_drought_from_json($json, $mode, [
            'trigger_source' => $triggerSource,
            'scheduled_slot' => $scheduledSlot,
            'started_at'     => $startedAt,
            'duration_ms'    => (int)round((microtime(true) - $t0) * 1000)
        ]);
    } catch (Throwable $e) {
        $dur = (int)round((microtime(true) - $t0) * 1000);
        log_task_run('ดึงข้อมูลภัยแล้ง', $mode, 'failed', 0, 'ล้มเหลว: ' . $e->getMessage());
        sys_log_record([
            'module'         => 'drought',
            'action'         => 'ดึงข้อมูลอ่างเก็บน้ำ/ภัยแล้ง',
            'status'         => 'failed',
            'trigger_source' => $triggerSource,
            'scheduled_slot' => $scheduledSlot,
            'started_at'     => $startedAt,
            'finished_at'    => date('Y-m-d H:i:s'),
            'duration_ms'    => $dur,
            'row_count'      => 0,
            'summary'        => 'ดึงข้อมูลอ่างเก็บน้ำ/ภัยแล้งไม่สำเร็จ',
            'error_detail'   => $e->getMessage(),
        ]);
        throw $e;
    }
}

// =========================================================================
// 4. Direct Collector: PM 2.5 Air Quality (~33 Stations in Lampang)
// =========================================================================
function save_pm25_from_json(array $json, string $mode = 'db', array $logCtx = []): array {
    $pdo = get_db();
    $transformed = transform_pm25_items($json);
    $rowsToInsert = $transformed['rows'];
    if (empty($rowsToInsert)) {
        throw new RuntimeException('ไม่พบสถานีตรวจวัด PM 2.5 ในจังหวัดลำปาง');
    }

    $pdo->beginTransaction();
    try {
        $batchId = record_ingest_batch($pdo, 'pm25', $rowsToInsert);
        $stmt = $pdo->prepare("INSERT INTO tbl_pm25_monitoring
            (record_date, station_name, tambon, amphoe, province, time_label, pm25_value, pm25_avg_24h, air_quality_status, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())");
        foreach ($rowsToInsert as $r) {
            $stmt->execute([
                $r['record_date'],
                $r['station_name'],
                $r['tambon'],
                $r['amphoe'],
                $r['province'],
                $r['time_label'],
                $r['pm25_value'],
                $r['pm25_avg_24h'],
                $r['air_quality_status']
            ]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    $count = count($rowsToInsert);
    $msg = "DB: committed ({$count} สถานี PM 2.5); Direct API; batch: {$batchId}";
    log_task_run('ดึงข้อมูล PM 2.5', $mode, 'success', $count, $msg);

    retry_queue_clear('pm25');
    $freshness = check_upstream_freshness('pm25', $transformed['observations']);

    sys_log_record([
        'run_group_id'   => $logCtx['run_group_id'] ?? null,
        'module'         => 'pm25',
        'action'         => 'ดึงข้อมูลคุณภาพอากาศ PM 2.5',
        'status'         => 'success',
        'trigger_source' => $logCtx['trigger_source'] ?? 'manual',
        'scheduled_slot' => $logCtx['scheduled_slot'] ?? null,
        'started_at'     => $logCtx['started_at'] ?? date('Y-m-d H:i:s'),
        'finished_at'    => date('Y-m-d H:i:s'),
        'duration_ms'    => (int)($logCtx['duration_ms'] ?? 0),
        'row_count'      => $count,
        'summary'        => "บันทึกข้อมูลฝุ่น PM 2.5 จ.ลำปาง {$count} สถานี ลง MySQL เรียบร้อย",
        'meta'           => ['batchId' => $batchId, 'staleStations' => $freshness['staleCount'] ?? 0]
    ]);

    return [
        'success'   => true,
        'count'     => $count,
        'batchId'   => $batchId,
        'freshness' => $freshness,
    ];
}

function collect_pm25_direct(string $mode = 'db', string $triggerSource = 'manual', ?string $scheduledSlot = null): array {
    $startedAt = date('Y-m-d H:i:s');
    $t0 = microtime(true);
    try {
        $json = http_get_json('https://api-v3.thaiwater.net/api/v1/thaiwater30/public/thaiwater/weather', [], 30);
        return save_pm25_from_json($json, $mode, [
            'trigger_source' => $triggerSource,
            'scheduled_slot' => $scheduledSlot,
            'started_at'     => $startedAt,
            'duration_ms'    => (int)round((microtime(true) - $t0) * 1000)
        ]);
    } catch (Throwable $e) {
        $dur = (int)round((microtime(true) - $t0) * 1000);
        log_task_run('ดึงข้อมูล PM 2.5', $mode, 'failed', 0, 'ล้มเหลว: ' . $e->getMessage());
        sys_log_record([
            'module'         => 'pm25',
            'action'         => 'ดึงข้อมูลคุณภาพอากาศ PM 2.5',
            'status'         => 'failed',
            'trigger_source' => $triggerSource,
            'scheduled_slot' => $scheduledSlot,
            'started_at'     => $startedAt,
            'finished_at'    => date('Y-m-d H:i:s'),
            'duration_ms'    => $dur,
            'row_count'      => 0,
            'summary'        => 'ดึงข้อมูล PM 2.5 ไม่สำเร็จ',
            'error_detail'   => $e->getMessage(),
        ]);
        throw $e;
    }
}

// =========================================================================
// 5. Direct Collector & Bridge: Traffy Fondue Complaints + Cookie/Session Test
// =========================================================================
function decode_traffy_jwt_info(string $token): ?array {
    $token = trim(preg_replace('/^Bearer\s+/i', '', trim($token)), " \t\n\r\"'");
    if ($token === '' || substr_count($token, '.') !== 2) {
        return null;
    }
    $parts = explode('.', $token);
    $payloadRaw = base64_decode(strtr($parts[1], '-_', '+/'));
    $decoded = json_decode((string)$payloadRaw, true);
    if (!is_array($decoded)) {
        return null;
    }
    $exp = isset($decoded['exp']) ? (int)$decoded['exp'] : null;
    $now = time();
    $remSec = $exp !== null ? ($exp - $now) : null;
    return [
        'exp'            => $exp,
        'expAt'          => $exp ? date('Y-m-d H:i:s', $exp) : null,
        'isExpired'      => $exp ? ($exp <= $now) : false,
        'remainingHours' => $remSec !== null ? round($remSec / 3600, 1) : null,
        'remainingDays'  => $remSec !== null ? round($remSec / 86400, 1) : null,
        'role'           => $decoded['role'] ?? null,
        'email'          => $decoded['email'] ?? ($decoded['username'] ?? null),
    ];
}

function build_traffy_headers(): array {
    $cfg = get_app_config();
    $ta = $cfg['traffyAuth'] ?? [];
    $headers = [
        'Origin: https://citydata.traffy.in.th',
        'Referer: https://citydata.traffy.in.th/'
    ];
    if (!empty($ta['cookie'])) {
        $headers[] = 'Cookie: ' . $ta['cookie'];
    }
    if (!empty($ta['token'])) {
        $headers[] = 'Authorization: Bearer ' . $ta['token'];
    }
    return $headers;
}

function fetch_traffy_timeline_direct(string $ticketId): ?array {
    $url = 'https://publicapi.traffy.in.th/teamchadchart-stat-api/detail-timeline/v1?ticket_id=' . rawurlencode($ticketId);
    try {
        return http_get_json($url, build_traffy_headers(), 10);
    } catch (Throwable $e) {
        return null;
    }
}

/**
 * Persist normalized complaint rows (shared by Direct Public API and Extension 04ext_TraffyLP).
 */
function save_complaints_rows_to_db(array $prepared, string $mode = 'db', array $logCtx = []): array {
    if (empty($prepared)) {
        throw new RuntimeException('ไม่พบรายการเรื่องร้องเรียนที่จะบันทึก');
    }

    $pdo = get_db();
    // Fetch timeline for up to 5 new/changed tickets in PARALLEL (5s cap so slow upstream never stalls web requests)
    $tlRequests = [];
    $tlHeaders = build_traffy_headers();
    $checkStmt = $pdo->prepare("SELECT state_name, raw_timeline FROM tbl_complaints_monitoring WHERE ticket_id = ? LIMIT 1");
    foreach ($prepared as &$row) {
        $checkStmt->execute([$row['ticket_id']]);
        $existing = $checkStmt->fetch();
        $row['raw_timeline'] = $existing['raw_timeline'] ?? null;
        if ((!$existing || ($existing['state_name'] !== $row['state_name'] && $row['state_name'] !== 'เสร็จสิ้น')) && count($tlRequests) < 5) {
            $tid = $row['ticket_id'];
            $tlRequests[$tid] = [
                'url'     => 'https://publicapi.traffy.in.th/teamchadchart-stat-api/detail-timeline/v1?ticket_id=' . urlencode($tid),
                'headers' => $tlHeaders,
                'timeout' => 5,
            ];
        }
    }
    unset($row);

    if (!empty($tlRequests)) {
        $tlResponses = http_get_json_multi($tlRequests, 5);
        foreach ($prepared as &$row) {
            $tid = $row['ticket_id'];
            if (!empty($tlResponses[$tid]['ok']) && is_array($tlResponses[$tid]['data'])) {
                $row['raw_timeline'] = json_encode($tlResponses[$tid]['data'], JSON_UNESCAPED_UNICODE);
            }
        }
        unset($row);
    }

    $pdo->beginTransaction();
    try {
        $batchId = record_ingest_batch($pdo, 'complaints', $prepared, $logCtx['custom_batch_key'] ?? null);
        $selectExisting = $pdo->prepare("SELECT state_name, org_name FROM tbl_complaints_monitoring WHERE ticket_id = ? LIMIT 1");
        $upsertStmt = $pdo->prepare("INSERT INTO tbl_complaints_monitoring
            (ticket_id, state_name, problem_type, description, photo_url, location, org_name, ticket_datetime, satisfaction_stars, raw_timeline, is_in_scope, agency_status, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                state_name = VALUES(state_name),
                problem_type = VALUES(problem_type),
                description = VALUES(description),
                photo_url = VALUES(photo_url),
                location = VALUES(location),
                org_name = VALUES(org_name),
                ticket_datetime = VALUES(ticket_datetime),
                satisfaction_stars = VALUES(satisfaction_stars),
                raw_timeline = COALESCE(VALUES(raw_timeline), raw_timeline),
                is_in_scope = VALUES(is_in_scope),
                agency_status = VALUES(agency_status),
                recorded_at = NOW()");
        $eventStmt = $pdo->prepare("INSERT INTO app_complaint_events (ticket_id, state_name, org_name, batch_id) VALUES (?, ?, ?, ?)");

        foreach ($prepared as $r) {
            $selectExisting->execute([$r['ticket_id']]);
            $old = $selectExisting->fetch();

            $agency = compute_traffy_agency_status((string)$r['org_name'], (string)$r['state_name']);

            $upsertStmt->execute([
                $r['ticket_id'],
                $r['state_name'],
                $r['problem_type'],
                $r['description'],
                $r['photo_url'],
                $r['location'],
                $r['org_name'],
                $r['ticket_datetime'],
                $r['satisfaction_stars'],
                $r['raw_timeline'],
                $r['is_in_scope'],
                $agency
            ]);

            if (!$old || $old['state_name'] !== $r['state_name'] || $old['org_name'] !== $r['org_name']) {
                $eventStmt->execute([$r['ticket_id'], $r['state_name'], $r['org_name'], $batchId]);
            }
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }

    $count = count($prepared);
    $sourceLabel = $logCtx['trigger_source'] ?? 'direct_api';
    $msg = "DB: committed ({$count} เรื่องร้องเรียน); {$sourceLabel}; batch: {$batchId}";
    log_task_run('ดึงข้อมูลเรื่องร้องเรียน', $mode, 'success', $count, $msg);

    retry_queue_clear('complaints');

    sys_log_record([
        'run_group_id'   => $logCtx['run_group_id'] ?? null,
        'module'         => 'complaints',
        'action'         => 'ดึงข้อมูลเรื่องร้องเรียน Traffy Fondue',
        'status'         => 'success',
        'trigger_source' => $logCtx['trigger_source'] ?? 'manual',
        'scheduled_slot' => $logCtx['scheduled_slot'] ?? null,
        'started_at'     => $logCtx['started_at'] ?? date('Y-m-d H:i:s'),
        'finished_at'    => date('Y-m-d H:i:s'),
        'duration_ms'    => (int)($logCtx['duration_ms'] ?? 0),
        'row_count'      => $count,
        'summary'        => "บันทึกเรื่องร้องเรียน จ.ลำปาง {$count} รายการ ลง MySQL สำเร็จ",
        'meta'           => ['batchId' => $batchId]
    ]);

    return [
        'success' => true,
        'count'   => $count,
        'batchId' => $batchId
    ];
}

function save_complaints_from_json(array $json, string $mode = 'db', array $logCtx = []): array {
    $prepared = transform_traffy_complaints($json, 60);
    if (empty($prepared)) {
        throw new RuntimeException('ไม่พบเรื่องร้องเรียนในเขตจังหวัดลำปางจาก Traffy API');
    }
    return save_complaints_rows_to_db($prepared, $mode, $logCtx);
}

/**
 * Resolve direct Server-to-Server Traffy endpoint plan (no Chrome Extension required).
 */
function get_traffy_request_plan(): array {
    $cfg = get_app_config();
    $ta = $cfg['traffyAuth'] ?? [];
    $hasAuth = (!empty($ta['token']) || !empty($ta['cookie']));
    $orgId = trim((string)($ta['orgId'] ?? ''));
    $headers = build_traffy_headers();
    $plan = [];

    if ($hasAuth) {
        // Primary authenticated feed matching citydata.traffy.in.th/recent-post after LINE login
        $plan[] = [
            'label'   => 'Authenticated PostgREST Feed (api.traffy.in.th)',
            'url'     => 'https://api.traffy.in.th/postgrest/rpc/get_user_all_orgs_feed?p_province=' . rawurlencode('ลำปาง') . '&p_limit=60&p_offset=0',
            'headers' => $headers,
            'timeout' => 12,
        ];
        if ($orgId !== '' && ctype_digit($orgId)) {
            $plan[] = [
                'label'   => 'Authenticated Org Feed (view_private_post_info)',
                'url'     => 'https://api.traffy.in.th/postgrest/view_private_post_info?limit=60&offset=0&org_id=eq.' . rawurlencode($orgId),
                'headers' => $headers,
                'timeout' => 12,
            ];
        }
    }

    if ($orgId !== '') {
        $isUuid = (bool)preg_match('/^[0-9a-f-]{16,}$/i', $orgId);
        $qs = $isUuid ? ('uuid=' . rawurlencode($orgId)) : ('org_id=' . rawurlencode($orgId));
        $plan[] = [
            'label'   => 'Public RPC GeoJSON (api.traffy.in.th)',
            'url'     => 'https://api.traffy.in.th/public/rpc/geojson?' . $qs,
            'headers' => $headers,
            'timeout' => 10,
        ];
    }

    // Standard open fallback (publicapi.traffy.in.th)
    $plan[] = [
        'label'   => 'Public Stat GeoJSON (publicapi.traffy.in.th)',
        'url'     => 'https://publicapi.traffy.in.th/teamchadchart-stat-api/geojson/v1?text=' . rawurlencode('ลำปาง'),
        'headers' => $headers,
        'timeout' => 14,
    ];

    return $plan;
}

function collect_complaints_direct(string $mode = 'db', string $triggerSource = 'manual', ?string $scheduledSlot = null): array {
    $startedAt = date('Y-m-d H:i:s');
    $t0 = microtime(true);
    $plan = get_traffy_request_plan();
    $lastErr = null;

    foreach ($plan as $step) {
        try {
            $json = http_get_json($step['url'], $step['headers'], (int)$step['timeout']);
            return save_complaints_from_json($json, $mode, [
                'trigger_source' => $triggerSource,
                'scheduled_slot' => $scheduledSlot,
                'started_at'     => $startedAt,
                'duration_ms'    => (int)round((microtime(true) - $t0) * 1000)
            ]);
        } catch (Throwable $e) {
            $lastErr = $e;
        }
    }

    $dur = (int)round((microtime(true) - $t0) * 1000);
    $errMsg = $lastErr ? $lastErr->getMessage() : 'ไม่สามารถดึงข้อมูล Traffy API ได้';
    log_task_run('ดึงข้อมูลเรื่องร้องเรียน', $mode, 'failed', 0, 'ล้มเหลว: ' . $errMsg);
    sys_log_record([
        'module'         => 'complaints',
        'action'         => 'ดึงข้อมูลเรื่องร้องเรียน Traffy Fondue',
        'status'         => 'failed',
        'trigger_source' => $triggerSource,
        'scheduled_slot' => $scheduledSlot,
        'started_at'     => $startedAt,
        'finished_at'    => date('Y-m-d H:i:s'),
        'duration_ms'    => $dur,
        'row_count'      => 0,
        'summary'        => 'ดึงข้อมูลเรื่องร้องเรียน Traffy Fondue ไม่สำเร็จ',
        'error_detail'   => $errMsg,
    ]);
    throw ($lastErr ?: new RuntimeException($errMsg));
}

/**
 * Comprehensive live Cookie, Session, JWT & API test for both Water_System2 Auth
 * and Traffy Fondue (citydata.traffy.in.th + publicapi.traffy.in.th + Extension bridge).
 */
function test_traffy_connection_and_session(bool $logResult = true): array {
    $startedAt = date('Y-m-d H:i:s');
    $tStart = microtime(true);
    $cfg = get_app_config();
    $ta = $cfg['traffyAuth'] ?? [];

    // 1. Internal Water_System2 Session & Cookie Check (water_session_7000)
    $sessionsPath = LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'sessions.json';
    $sessionWritable = is_dir(dirname($sessionsPath)) && is_writable(dirname($sessionsPath));
    $curCookie = $_COOKIE[SESSION_COOKIE_NAME] ?? '';
    $appSessionCheck = [
        'cookieName'          => SESSION_COOKIE_NAME,
        'authEnforce'         => AUTH_ENFORCE,
        'browserCookieSent'   => $curCookie !== '',
        'sessionsFileReady'   => $sessionWritable,
        'loopbackAuthRoundtrip' => null,
        'ok'                  => false,
    ];

    // Perform an actual non-destructive session store roundtrip test in runtime storage + loopback check if running over HTTP
    try {
        $testTok = bin2hex(random_bytes(12));
        $testHash = hash('sha256', $testTok);
        $sessions = read_json_file($sessionsPath, []);
        $sessions[$testHash] = ['user' => ['id' => 'diag', 'username' => 'diag', 'role' => 'viewer'], 'csrfToken' => 'diag', 'expires' => time() + 30];
        $writeOk = write_json_file($sessionsPath, $sessions);
        $reloaded = read_json_file($sessionsPath, []);
        $readOk = isset($reloaded[$testHash]);
        unset($sessions[$testHash]);
        write_json_file($sessionsPath, $sessions);
        $appSessionCheck['ok'] = $writeOk && $readOk;
        $appSessionCheck['message'] = $appSessionCheck['ok']
            ? 'ระบบ Session & Cookie (' . SESSION_COOKIE_NAME . ') อ่าน-เขียน-ตรวจสอบ Hash ได้สมบูรณ์'
            : 'ไม่สามารถเขียนไฟล์ sessions.json ได้';
    } catch (Throwable $e) {
        $appSessionCheck['message'] = 'Session error: ' . $e->getMessage();
    }

    // 2. Check User-Configured Traffy Cookie / Token Session
    $traffyCookie = trim((string)($ta['cookie'] ?? ''));
    $traffyToken  = trim((string)($ta['token'] ?? ''));
    $jwtInfo = decode_traffy_jwt_info($traffyToken);
    if ($jwtInfo && $jwtInfo['remainingHours'] !== null) {
        if ($jwtInfo['remainingHours'] <= 0 && function_exists('php_send_operational_alert')) {
            php_send_operational_alert('traffy_token_expired', 'Traffy LINE Token (local_login_data) หมดอายุแล้ว', "Token หมดอายุเมื่อ {$jwtInfo['expAt']} กรุณาเข้าสู่ระบบ LINE ใน citydata.traffy.in.th เพื่อวาง Token ใหม่");
        } elseif ($jwtInfo['remainingHours'] <= 48 && function_exists('php_send_operational_alert')) {
            php_send_operational_alert('traffy_token_expiring', "Traffy LINE Token ใกล้หมดอายุ (เหลือ {$jwtInfo['remainingHours']} ชม.)", "หมดอายุวันที่ {$jwtInfo['expAt']} กรุณาเตรียมต่ออายุ Token");
        }
    }

    $traffyAuthTest = [
        'configured'  => ($traffyCookie !== '' || $traffyToken !== ''),
        'hasCookie'   => ($traffyCookie !== ''),
        'hasToken'    => ($traffyToken !== ''),
        'jwtInfo'     => $jwtInfo,
        'httpCode'    => null,
        'durationMs'  => 0,
        'ok'          => false,
        'statusLabel' => 'ไม่ได้ตั้งค่า Traffy Cookie/Token',
    ];

    if ($traffyAuthTest['configured']) {
        $tAuth = microtime(true);
        $probeHeaders = [
            'Accept: application/json, text/plain, */*',
            'Origin: https://citydata.traffy.in.th',
            'Referer: https://citydata.traffy.in.th/',
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0'
        ];
        if ($traffyCookie !== '') $probeHeaders[] = 'Cookie: ' . $traffyCookie;
        if ($traffyToken !== '')  $probeHeaders[] = 'Authorization: Bearer ' . $traffyToken;

        $probeUrl = 'https://api.traffy.in.th/postgrest/rpc/get_user_all_orgs_feed?p_province=' . rawurlencode('ลำปาง') . '&p_limit=5&p_offset=0';
        $ch = curl_init($probeUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_HTTPHEADER     => $probeHeaders
        ]);
        $respBody = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr  = curl_error($ch);
        curl_close($ch);

        $traffyAuthTest['httpCode'] = $httpCode;
        $traffyAuthTest['durationMs'] = (int)round((microtime(true) - $tAuth) * 1000);
        if ($httpCode >= 200 && $httpCode < 300) {
            $decodedFeed = json_decode((string)$respBody, true);
            $feedCount = is_array($decodedFeed) ? count(transform_traffy_complaints($decodedFeed, 60)) : 0;
            $traffyAuthTest['ok'] = true;
            $traffyAuthTest['feedCount'] = $feedCount;
            $traffyAuthTest['statusLabel'] = '✅ Cookie/Session ของ Traffy ใช้งานได้จริง (HTTP ' . $httpCode . ($feedCount > 0 ? ", ดึงลำปางได้ {$feedCount} เรื่อง" : '') . ')';
        } elseif ($httpCode === 401 || $httpCode === 403 || ($jwtInfo && !empty($jwtInfo['isExpired']))) {
            $traffyAuthTest['statusLabel'] = '❌ Cookie/Token หมดอายุหรือไม่ถูกต้อง (HTTP ' . $httpCode . ') — กรุณาคัดลอก Token ใหม่หลังล็อกอิน LINE ใน citydata.traffy.in.th';
        } else {
            $traffyAuthTest['statusLabel'] = '⚠️ ตรวจสอบไม่สำเร็จ (HTTP ' . $httpCode . ($curlErr ? ": {$curlErr}" : '') . ')';
        }
    }

    // 3. Test Traffy Public APIs (geojson/v1 + detail-timeline/v1) in parallel
    $pubRes = http_get_json_multi([
        'geojson' => [
            'url'     => 'https://publicapi.traffy.in.th/teamchadchart-stat-api/geojson/v1?text=%E0%B8%A5%E0%B8%B3%E0%B8%9B%E0%B8%B2%E0%B8%87',
            'headers' => build_traffy_headers(),
            'timeout' => 12
        ],
        'timeline' => [
            'url'     => 'https://publicapi.traffy.in.th/teamchadchart-stat-api/detail-timeline/v1?ticket_id=2026-NVU2MU',
            'headers' => build_traffy_headers(),
            'timeout' => 10
        ],
        'citydata_spa' => [
            'url'     => 'https://citydata.traffy.in.th/recent-post',
            'headers' => ['Accept: text/html'],
            'timeout' => 8
        ]
    ], 12);

    $geoOk = !empty($pubRes['geojson']['ok']);
    $lampangCount = $geoOk ? count(transform_traffy_complaints($pubRes['geojson']['data'], 100)) : 0;

    $publicApiCheck = [
        'geojson' => [
            'ok'           => $geoOk,
            'httpCode'     => $pubRes['geojson']['httpCode'] ?? 0,
            'durationMs'   => $pubRes['geojson']['durationMs'] ?? 0,
            'lampangCount' => $lampangCount,
            'error'        => $pubRes['geojson']['error'] ?? null,
        ],
        'timeline' => [
            'ok'         => !empty($pubRes['timeline']['ok']),
            'httpCode'   => $pubRes['timeline']['httpCode'] ?? 0,
            'durationMs' => $pubRes['timeline']['durationMs'] ?? 0,
            'error'      => $pubRes['timeline']['error'] ?? null,
        ],
        'citydataReachable' => (($pubRes['citydata_spa']['httpCode'] ?? 0) === 200),
    ];

    $pdo = get_db();
    $dbCount = (int)$pdo->query("SELECT COUNT(*) FROM tbl_complaints_monitoring WHERE (is_in_scope = 1 OR is_in_scope IS NULL)")->fetchColumn();
    $latestComp = $pdo->query("SELECT MAX(recorded_at) FROM tbl_complaints_monitoring")->fetchColumn();

    $overallOk = $appSessionCheck['ok'] && ($traffyAuthTest['ok'] || $geoOk);
    $status = $overallOk ? (($traffyAuthTest['configured'] && !$traffyAuthTest['ok']) || !$geoOk ? 'partial' : 'success') : 'failed';

    $summaryParts = [];
    $summaryParts[] = 'App Cookie: ' . ($appSessionCheck['ok'] ? 'ผ่าน' : 'ล้มเหลว');
    $summaryParts[] = 'Traffy Session: ' . ($traffyAuthTest['configured'] ? ($traffyAuthTest['ok'] ? 'ใช้งานได้' : 'หมดอายุ/ล้มเหลว') : 'ยังไม่ใส่ Cookie/Token');
    $summaryParts[] = 'Public API: ' . ($geoOk ? "OK ({$lampangCount} เรื่อง)" : "HTTP " . ($publicApiCheck['geojson']['httpCode'] ?? 0) . " ({$publicApiCheck['geojson']['error']})");

    $result = [
        'success'     => $overallOk,
        'status'      => $status,
        'testedAt'    => date('Y-m-d H:i:s'),
        'durationMs'  => (int)round((microtime(true) - $tStart) * 1000),
        'appSession'  => $appSessionCheck,
        'traffyAuth'  => $traffyAuthTest,
        'publicApi'   => $publicApiCheck,
        'database'    => ['totalInScope' => $dbCount, 'lastRecordedAt' => $latestComp],
        'summary'     => implode(' | ', $summaryParts),
    ];

    if ($logResult) {
        sys_log_record([
            'module'         => 'traffy_auth',
            'action'         => 'ทดสอบ Cookie & Session + Traffy API',
            'status'         => $status,
            'trigger_source' => 'test',
            'started_at'     => $startedAt,
            'finished_at'    => date('Y-m-d H:i:s'),
            'duration_ms'    => $result['durationMs'],
            'row_count'      => $lampangCount,
            'summary'        => $result['summary'],
            'error_detail'   => $geoOk ? null : ($publicApiCheck['geojson']['error'] ?? null),
            'meta'           => $result,
        ]);
    }

    return $result;
}

// =========================================================================
// 6. Single-Module Runner & Non-Blocking Auto-Retry Processor (Add-on 2)
// =========================================================================
function run_single_module_collector(string $module, string $triggerSource = 'manual', ?string $scheduledSlot = null): array {
    switch ($module) {
        case 'rainfall':
            return collect_rainfall_direct(true, $triggerSource, $scheduledSlot);
        case 'water':
            return collect_water_level_direct('db', $triggerSource, $scheduledSlot);
        case 'drought':
            return collect_drought_direct('db', $triggerSource, $scheduledSlot);
        case 'pm25':
            return collect_pm25_direct('db', $triggerSource, $scheduledSlot);
        case 'complaints':
            return collect_complaints_direct('db', $triggerSource, $scheduledSlot);
        case 'github_sync':
            require_once __DIR__ . '/github_sync_to_mysql.php';
            return sync_github_snapshots_to_mysql();
        case 'notification':
            return php_check_and_notify(false);
        default:
            throw new InvalidArgumentException("Unknown module: {$module}");
    }
}

function retry_queue_process_due(): array {
    $q = retry_queue_get();
    if (empty($q)) return ['processed' => 0, 'results' => []];

    $now = time();
    $processed = [];
    foreach ($q as $module => $item) {
        $nextAt = (int)($item['nextRetryAt'] ?? 0);
        if ($now < $nextAt) continue;

        $attempt = (int)($item['attempt'] ?? 1);
        $maxAttempts = (int)($item['maxAttempts'] ?? 3);
        $slot = $item['scheduledSlot'] ?? null;

        try {
            $res = run_single_module_collector($module, 'auto_retry', $slot);
            retry_queue_clear($module);
            $processed[$module] = ['success' => true, 'attempt' => $attempt, 'result' => $res];
        } catch (Throwable $e) {
            if ($attempt >= $maxAttempts) {
                retry_queue_clear($module);
                sys_log_record([
                    'module'         => $module,
                    'action'         => "ซ่อมงานอัตโนมัติครบ {$maxAttempts} ครั้งแล้ว (หยุดรอ)",
                    'status'         => 'failed',
                    'trigger_source' => 'auto_retry',
                    'scheduled_slot' => $slot,
                    'summary'        => "Auto-Retry ({$attempt}/{$maxAttempts}) ล้มเหลวถาวรสำหรับ {$module}",
                    'error_detail'   => $e->getMessage(),
                ]);
                if (function_exists('php_send_operational_alert')) {
                    php_send_operational_alert(
                        "retry_perm_{$module}",
                        "ระบบ Auto-Retry ล้มเหลวครบ {$maxAttempts} ครั้ง ({$module})",
                        "รอบเวลา: " . ($slot ?: 'N/A') . " | สาเหตุล่าสุด: " . $e->getMessage()
                    );
                }
            } else {
                retry_queue_enqueue($module, $slot, $e->getMessage(), 120, $maxAttempts);
            }
            $processed[$module] = ['success' => false, 'attempt' => $attempt, 'error' => $e->getMessage()];
        }
    }

    return ['processed' => count($processed), 'results' => $processed];
}

// =========================================================================
// 7. Parallel Collector: Fetch ALL 6 APIs simultaneously (Isolated Traffy timeout!)
// =========================================================================
function collect_all_parallel_direct(array $activeFlags = [], string $triggerSource = 'manual', ?string $scheduledSlot = null): array {
    $lockedResult = with_file_lock('collect_cycle', function () use ($activeFlags, $triggerSource, $scheduledSlot) {
        return _collect_all_parallel_direct_locked($activeFlags, $triggerSource, $scheduledSlot);
    }, true);

    if ($lockedResult === null) {
        return [
            'success'       => false,
            'skipped'       => true,
            'reason'        => 'concurrent_cycle_locked',
            'status'        => 'skipped',
            'elapsedSec'    => 0,
            'okCount'       => 0,
            'failCount'     => 0,
            'results'       => [],
            'notifications' => null,
        ];
    }

    return $lockedResult;
}

function _collect_all_parallel_direct_locked(array $activeFlags = [], string $triggerSource = 'manual', ?string $scheduledSlot = null): array {
    $tStart = microtime(true);
    $batchStartedAt = date('Y-m-d H:i:s');
    $runGroupId = ($scheduledSlot ? date('Ymd_') . str_replace(':', '', $scheduledSlot) : 'run_' . date('YmdHis')) . '_' . substr(bin2hex(random_bytes(2)), 0, 4);

    $active = array_merge([
        'water'      => true,
        'drought'    => true,
        'pm25'       => true,
        'complaints' => true
    ], $activeFlags);

    $requests = [];
    if (!empty($active['water'])) {
        $requests['rain']   = ['url' => 'https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/rain24?province_code=52', 'timeout' => 25];
        $requests['rain3d'] = ['url' => 'https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/rain3d?province_code=52', 'timeout' => 20];
        $requests['water']  = ['url' => 'https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/waterlevel?province_code=52', 'timeout' => 25];
    }
    if (!empty($active['drought'])) {
        $requests['drought'] = ['url' => 'https://api-v3.thaiwater.net/api/v1/thaiwater30/provinces/dam?province_code=52', 'timeout' => 25];
    }
    if (!empty($active['pm25'])) {
        $requests['pm25'] = ['url' => 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/thaiwater/weather', 'timeout' => 30];
    }
    if (!empty($active['complaints'])) {
        // Use authenticated api.traffy.in.th feed when LINE Token/Cookie or Org UUID is configured,
        // otherwise use open stat API with 14s timeout so Kong instability never stalls ThaiWater pipelines
        $traffyPlan = get_traffy_request_plan();
        $primary = $traffyPlan[0];
        $requests['complaints'] = [
            'url'     => $primary['url'],
            'headers' => $primary['headers'],
            'timeout' => (int)$primary['timeout'],
        ];
    }

    if (empty($requests)) {
        return ['success' => true, 'elapsedSec' => 0, 'results' => []];
    }

    $responses = http_get_json_multi($requests, 25);

    $results = [];
    $okCount = 0;
    $failCount = 0;
    $totalRows = 0;
    $failedModules = [];

    $rainResult = ['subdistrictRainAvg' => [], 'districtRainAvg' => [], 'count' => 0];
    if (!empty($responses['rain']['ok'])) {
        try {
            $rainResult = save_rainfall_from_json($responses['rain']['data'], false, [
                'run_group_id'   => $runGroupId,
                'trigger_source' => $triggerSource,
                'scheduled_slot' => $scheduledSlot,
                'started_at'     => $batchStartedAt,
                'duration_ms'    => $responses['rain']['durationMs']
            ]);
            $results['rainfall'] = ['success' => true, 'count' => $rainResult['count']];
            $okCount++;
            $totalRows += $rainResult['count'];
        } catch (Throwable $e) {
            $err = $e->getMessage();
            $sp = try_spool_failed_module_save('rainfall', $responses['rain']['data']);
            $results['rainfall'] = ['success' => false, 'spooled' => !empty($sp['spooled']), 'error' => $err];
            $failCount++;
            $failedModules[] = 'น้ำฝน';
            log_task_run('ดึงข้อมูลน้ำฝน', 'db', 'failed', 0, 'ล้มเหลว: ' . $err);
            sys_log_record([
                'run_group_id' => $runGroupId, 'module' => 'rainfall', 'action' => 'ดึงข้อมูลปริมาณน้ำฝน 24 ชม.',
                'status' => 'failed', 'trigger_source' => $triggerSource, 'scheduled_slot' => $scheduledSlot,
                'started_at' => $batchStartedAt, 'duration_ms' => $responses['rain']['durationMs'] ?? 0,
                'summary' => !empty($sp['spooled']) ? "DB ขัดข้อง — พักน้ำฝนลง Local Spool ({$sp['rows']} แถว)" : 'ดึงข้อมูลน้ำฝนไม่สำเร็จ', 'error_detail' => $err
            ]);
            retry_queue_enqueue('rainfall', $scheduledSlot, $err);
        }
    } elseif (isset($requests['rain'])) {
        $err = $responses['rain']['error'] ?? 'Fetch failed';
        $results['rainfall'] = ['success' => false, 'error' => $err];
        $failCount++;
        $failedModules[] = 'น้ำฝน';
        log_task_run('ดึงข้อมูลน้ำฝน', 'db', 'failed', 0, 'ล้มเหลว: ' . $err);
        sys_log_record([
            'run_group_id' => $runGroupId, 'module' => 'rainfall', 'action' => 'ดึงข้อมูลปริมาณน้ำฝน 24 ชม.',
            'status' => 'failed', 'trigger_source' => $triggerSource, 'scheduled_slot' => $scheduledSlot,
            'started_at' => $batchStartedAt, 'duration_ms' => $responses['rain']['durationMs'] ?? 0,
            'summary' => 'เชื่อมต่อ API น้ำฝนไม่สำเร็จ', 'error_detail' => $err
        ]);
        retry_queue_enqueue('rainfall', $scheduledSlot, $err);
    }

    $rain3dResult = (!empty($responses['rain3d']['ok'])) ? transform_rain3d_maps($responses['rain3d']['data']) : ['subdistrictRain3dAvg' => [], 'districtRain3dAvg' => [], 'count' => 0];

    if (!empty($responses['water']['ok'])) {
        try {
            $results['water'] = save_water_level_from_json($responses['water']['data'], $rainResult, 'db', $rain3dResult, [
                'run_group_id'   => $runGroupId,
                'trigger_source' => $triggerSource,
                'scheduled_slot' => $scheduledSlot,
                'started_at'     => $batchStartedAt,
                'duration_ms'    => $responses['water']['durationMs']
            ]);
            $okCount++;
            $totalRows += (int)($results['water']['count'] ?? 0);
        } catch (Throwable $e) {
            $err = $e->getMessage();
            $sp = try_spool_failed_module_save('water', $responses['water']['data'], ['rainResult' => $rainResult, 'rain3dResult' => $rain3dResult]);
            $results['water'] = ['success' => false, 'spooled' => !empty($sp['spooled']), 'error' => $err];
            $failCount++;
            $failedModules[] = 'ระดับน้ำ';
            log_task_run('ดึงข้อมูลระดับน้ำ', 'db', 'failed', 0, 'ล้มเหลว: ' . $err);
            sys_log_record([
                'run_group_id' => $runGroupId, 'module' => 'water', 'action' => 'ดึงข้อมูลระดับน้ำรายสถานี',
                'status' => 'failed', 'trigger_source' => $triggerSource, 'scheduled_slot' => $scheduledSlot,
                'started_at' => $batchStartedAt, 'duration_ms' => $responses['water']['durationMs'] ?? 0,
                'summary' => !empty($sp['spooled']) ? "DB ขัดข้อง — พักระดับน้ำลง Local Spool ({$sp['rows']} แถว)" : 'บันทึกระดับน้ำไม่สำเร็จ', 'error_detail' => $err
            ]);
            retry_queue_enqueue('water', $scheduledSlot, $err);
        }
    } elseif (isset($requests['water'])) {
        $err = $responses['water']['error'] ?? 'Fetch failed';
        $results['water'] = ['success' => false, 'error' => $err];
        $failCount++;
        $failedModules[] = 'ระดับน้ำ';
        log_task_run('ดึงข้อมูลระดับน้ำ', 'db', 'failed', 0, 'ล้มเหลว: ' . $err);
        sys_log_record([
            'run_group_id' => $runGroupId, 'module' => 'water', 'action' => 'ดึงข้อมูลระดับน้ำรายสถานี',
            'status' => 'failed', 'trigger_source' => $triggerSource, 'scheduled_slot' => $scheduledSlot,
            'started_at' => $batchStartedAt, 'duration_ms' => $responses['water']['durationMs'] ?? 0,
            'summary' => 'เชื่อมต่อ API ระดับน้ำไม่สำเร็จ', 'error_detail' => $err
        ]);
        retry_queue_enqueue('water', $scheduledSlot, $err);
    }

    if (!empty($responses['drought']['ok'])) {
        try {
            $results['drought'] = save_drought_from_json($responses['drought']['data'], 'db', [
                'run_group_id'   => $runGroupId,
                'trigger_source' => $triggerSource,
                'scheduled_slot' => $scheduledSlot,
                'started_at'     => $batchStartedAt,
                'duration_ms'    => $responses['drought']['durationMs']
            ]);
            $okCount++;
            $totalRows += (int)($results['drought']['count'] ?? 0);
        } catch (Throwable $e) {
            $err = $e->getMessage();
            $sp = try_spool_failed_module_save('drought', $responses['drought']['data']);
            $results['drought'] = ['success' => false, 'spooled' => !empty($sp['spooled']), 'error' => $err];
            $failCount++;
            $failedModules[] = 'ภัยแล้ง/อ่างเก็บน้ำ';
            log_task_run('ดึงข้อมูลภัยแล้ง', 'db', 'failed', 0, 'ล้มเหลว: ' . $err);
            sys_log_record([
                'run_group_id' => $runGroupId, 'module' => 'drought', 'action' => 'ดึงข้อมูลอ่างเก็บน้ำ/ภัยแล้ง',
                'status' => 'failed', 'trigger_source' => $triggerSource, 'scheduled_slot' => $scheduledSlot,
                'started_at' => $batchStartedAt, 'duration_ms' => $responses['drought']['durationMs'] ?? 0,
                'summary' => !empty($sp['spooled']) ? "DB ขัดข้อง — พักอ่างเก็บน้ำลง Local Spool ({$sp['rows']} แถว)" : 'บันทึกข้อมูลอ่างเก็บน้ำไม่สำเร็จ', 'error_detail' => $err
            ]);
            retry_queue_enqueue('drought', $scheduledSlot, $err);
        }
    } elseif (isset($requests['drought'])) {
        $err = $responses['drought']['error'] ?? 'Fetch failed';
        $results['drought'] = ['success' => false, 'error' => $err];
        $failCount++;
        $failedModules[] = 'ภัยแล้ง/อ่างเก็บน้ำ';
        log_task_run('ดึงข้อมูลภัยแล้ง', 'db', 'failed', 0, 'ล้มเหลว: ' . $err);
        sys_log_record([
            'run_group_id' => $runGroupId, 'module' => 'drought', 'action' => 'ดึงข้อมูลอ่างเก็บน้ำ/ภัยแล้ง',
            'status' => 'failed', 'trigger_source' => $triggerSource, 'scheduled_slot' => $scheduledSlot,
            'started_at' => $batchStartedAt, 'duration_ms' => $responses['drought']['durationMs'] ?? 0,
            'summary' => 'เชื่อมต่อ API อ่างเก็บน้ำไม่สำเร็จ', 'error_detail' => $err
        ]);
        retry_queue_enqueue('drought', $scheduledSlot, $err);
    }

    if (!empty($responses['pm25']['ok'])) {
        try {
            $results['pm25'] = save_pm25_from_json($responses['pm25']['data'], 'db', [
                'run_group_id'   => $runGroupId,
                'trigger_source' => $triggerSource,
                'scheduled_slot' => $scheduledSlot,
                'started_at'     => $batchStartedAt,
                'duration_ms'    => $responses['pm25']['durationMs']
            ]);
            $okCount++;
            $totalRows += (int)($results['pm25']['count'] ?? 0);
        } catch (Throwable $e) {
            $err = $e->getMessage();
            $sp = try_spool_failed_module_save('pm25', $responses['pm25']['data']);
            $results['pm25'] = ['success' => false, 'spooled' => !empty($sp['spooled']), 'error' => $err];
            $failCount++;
            $failedModules[] = 'PM 2.5';
            log_task_run('ดึงข้อมูล PM 2.5', 'db', 'failed', 0, 'ล้มเหลว: ' . $err);
            sys_log_record([
                'run_group_id' => $runGroupId, 'module' => 'pm25', 'action' => 'ดึงข้อมูลคุณภาพอากาศ PM 2.5',
                'status' => 'failed', 'trigger_source' => $triggerSource, 'scheduled_slot' => $scheduledSlot,
                'started_at' => $batchStartedAt, 'duration_ms' => $responses['pm25']['durationMs'] ?? 0,
                'summary' => !empty($sp['spooled']) ? "DB ขัดข้อง — พัก PM 2.5 ลง Local Spool ({$sp['rows']} แถว)" : 'บันทึกข้อมูล PM 2.5 ไม่สำเร็จ', 'error_detail' => $err
            ]);
            retry_queue_enqueue('pm25', $scheduledSlot, $err);
        }
    } elseif (isset($requests['pm25'])) {
        $err = $responses['pm25']['error'] ?? 'Fetch failed';
        $results['pm25'] = ['success' => false, 'error' => $err];
        $failCount++;
        $failedModules[] = 'PM 2.5';
        log_task_run('ดึงข้อมูล PM 2.5', 'db', 'failed', 0, 'ล้มเหลว: ' . $err);
        sys_log_record([
            'run_group_id' => $runGroupId, 'module' => 'pm25', 'action' => 'ดึงข้อมูลคุณภาพอากาศ PM 2.5',
            'status' => 'failed', 'trigger_source' => $triggerSource, 'scheduled_slot' => $scheduledSlot,
            'started_at' => $batchStartedAt, 'duration_ms' => $responses['pm25']['durationMs'] ?? 0,
            'summary' => 'เชื่อมต่อ API PM 2.5 ไม่สำเร็จ', 'error_detail' => $err
        ]);
        retry_queue_enqueue('pm25', $scheduledSlot, $err);
    }

    if (!empty($responses['complaints']['ok'])) {
        try {
            $results['complaints'] = save_complaints_from_json($responses['complaints']['data'], 'db', [
                'run_group_id'   => $runGroupId,
                'trigger_source' => $triggerSource,
                'scheduled_slot' => $scheduledSlot,
                'started_at'     => $batchStartedAt,
                'duration_ms'    => $responses['complaints']['durationMs']
            ]);
            $okCount++;
            $totalRows += (int)($results['complaints']['count'] ?? 0);
        } catch (Throwable $e) {
            $err = $e->getMessage();
            $sp = try_spool_failed_module_save('complaints', $responses['complaints']['data']);
            $results['complaints'] = ['success' => false, 'spooled' => !empty($sp['spooled']), 'error' => $err];
            $failCount++;
            $failedModules[] = 'ร้องเรียน Traffy';
            log_task_run('ดึงข้อมูลเรื่องร้องเรียน', 'db', 'failed', 0, 'ล้มเหลว: ' . $err);
            sys_log_record([
                'run_group_id' => $runGroupId, 'module' => 'complaints', 'action' => 'ดึงข้อมูลเรื่องร้องเรียน Traffy Fondue',
                'status' => 'failed', 'trigger_source' => $triggerSource, 'scheduled_slot' => $scheduledSlot,
                'started_at' => $batchStartedAt, 'duration_ms' => $responses['complaints']['durationMs'] ?? 0,
                'summary' => !empty($sp['spooled']) ? "DB ขัดข้อง — พักเรื่องร้องเรียนลง Local Spool ({$sp['rows']} แถว)" : 'บันทึกเรื่องร้องเรียน Traffy ไม่สำเร็จ', 'error_detail' => $err
            ]);
            retry_queue_enqueue('complaints', $scheduledSlot, $err);
        }
    } elseif (isset($requests['complaints'])) {
        $err = $responses['complaints']['error'] ?? 'Fetch failed';
        $results['complaints'] = ['success' => false, 'error' => $err];
        $failCount++;
        $failedModules[] = 'ร้องเรียน Traffy';
        log_task_run('ดึงข้อมูลเรื่องร้องเรียน', 'db', 'failed', 0, 'ล้มเหลว: ' . $err);
        sys_log_record([
            'run_group_id' => $runGroupId, 'module' => 'complaints', 'action' => 'ดึงข้อมูลเรื่องร้องเรียน Traffy Fondue',
            'status' => 'failed', 'trigger_source' => $triggerSource, 'scheduled_slot' => $scheduledSlot,
            'started_at' => $batchStartedAt, 'duration_ms' => $responses['complaints']['durationMs'] ?? 0,
            'summary' => 'เชื่อมต่อ Traffy API ไม่สำเร็จ (ตั้งคิว Auto-Retry ใน 2 นาที)', 'error_detail' => $err
        ]);
        retry_queue_enqueue('complaints', $scheduledSlot, $err);
    }

    $elapsedMs = (int)round((microtime(true) - $tStart) * 1000);
    $elapsedSec = round($elapsedMs / 1000, 2);

    $overallStatus = ($failCount === 0) ? 'success' : ($okCount > 0 ? 'partial' : 'failed');
    $slotInfo = $scheduledSlot ? "รอบ {$scheduledSlot} น." : 'สั่งดึงข้อมูลทันที';
    $overallSummary = ($failCount === 0)
        ? "ดึงข้อมูลครบทุกด้าน ({$okCount} ด้าน, {$totalRows} รายการ) {$slotInfo} สำเร็จภายใน {$elapsedSec} วินาที"
        : "ดึงข้อมูล {$slotInfo}: สำเร็จ {$okCount} ด้าน, ไม่สำเร็จ {$failCount} ด้าน (" . implode(', ', $failedModules) . ") ใช้เวลา {$elapsedSec} วินาที";

    sys_log_record([
        'run_group_id'   => $runGroupId,
        'module'         => 'system',
        'action'         => 'รอบดึงข้อมูลบูรณาการรวม (Parallel Fetch)',
        'status'         => $overallStatus,
        'trigger_source' => $triggerSource,
        'scheduled_slot' => $scheduledSlot,
        'started_at'     => $batchStartedAt,
        'finished_at'    => date('Y-m-d H:i:s'),
        'duration_ms'    => $elapsedMs,
        'row_count'      => $totalRows,
        'summary'        => $overallSummary,
        'error_detail'   => !empty($failedModules) ? 'ด้านที่ไม่สำเร็จ: ' . implode(', ', $failedModules) : null,
        'meta'           => ['okCount' => $okCount, 'failCount' => $failCount, 'results' => $results]
    ]);

    // Automatically evaluate crisis thresholds and send Gmail SMTP + LINE alerts
    $notifResult = null;
    try {
        if ($okCount === 0 && $failCount > 0 && function_exists('php_send_operational_alert')) {
            php_send_operational_alert(
                'total_collector_failure',
                'การดึงข้อมูลทุกระบบล้มเหลวพร้อมกัน',
                "รอบ: {$slotInfo} ({$triggerSource}) | ด้านที่ไม่สำเร็จ: " . implode(', ', $failedModules)
            );
        }
        $notifResult = php_check_and_notify(false, $triggerSource, $scheduledSlot);
    } catch (Throwable $e) {
        sys_log_record([
            'run_group_id'   => $runGroupId,
            'module'         => 'notification',
            'action'         => 'ตรวจสอบและส่งแจ้งเตือนวิกฤต',
            'status'         => 'failed',
            'trigger_source' => $triggerSource,
            'scheduled_slot' => $scheduledSlot,
            'summary'        => 'ระบบแจ้งเตือนอัตโนมัติเกิดข้อผิดพลาด',
            'error_detail'   => $e->getMessage()
        ]);
    }

    // Daily 24h maintenance (log rotation, session pruning, old snapshot/log cleanup)
    try {
        if (function_exists('run_system_housekeeping')) {
            run_system_housekeeping(false);
        }
    } catch (Throwable $e) {
        // non-fatal
    }

    return [
        'success'       => ($okCount > 0 && $failCount === 0),
        'status'        => $overallStatus,
        'runGroupId'    => $runGroupId,
        'elapsedSec'    => $elapsedSec,
        'okCount'       => $okCount,
        'failCount'     => $failCount,
        'results'       => $results,
        'notifications' => $notifResult
    ];
}
