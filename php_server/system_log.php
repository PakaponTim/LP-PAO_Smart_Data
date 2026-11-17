<?php
// =========================================================================
// LP-PAO Smart Data — Unified System Log, 48-Slot Heatmap, Auto-Retry Queue,
// Upstream Data Freshness Monitor (6h/36h), & CSV Audit Exporter
// =========================================================================

require_once __DIR__ . '/config.php';

const SYSTEM_LOG_STALE_THRESHOLDS_SEC = [
    'water'    => 6 * 3600,   // 6 hours
    'rainfall' => 6 * 3600,   // 6 hours
    'pm25'     => 6 * 3600,   // 6 hours
    'drought'  => 36 * 3600,  // 36 hours (daily reservoir reporting)
];

const SYSTEM_LOG_MODULE_LABELS = [
    'water'        => 'ระดับน้ำ',
    'rainfall'     => 'ปริมาณน้ำฝน',
    'drought'      => 'อ่างเก็บน้ำ/ภัยแล้ง',
    'pm25'         => 'ฝุ่น PM 2.5',
    'complaints'   => 'ร้องเรียน Traffy',
    'notification' => 'แจ้งเตือนวิกฤต',
    'github_sync'  => 'ซิงค์ GitHub',
    'report'       => 'ออกรายงาน/ส่งออก',
    'freshness'    => 'ความสดข้อมูลต้นทาง',
    'traffy_auth'  => 'ทดสอบ Cookie/Session',
    'system'       => 'ระบบรวม',
];

const SYSTEM_LOG_TRIGGER_LABELS = [
    'smart_sleep' => 'อัตโนมัติ (Smart Sleep)',
    'manual'      => 'เจ้าหน้าที่กดสั่งเอง',
    'github_sync' => 'ซิงค์จาก GitHub Cloud',
    'auto_retry'  => 'ซ่อมงานอัตโนมัติ (Auto-Retry)',
    'web_cron'    => 'Web Cron / Endpoint',
    'cli_once'    => 'CLI One-Shot',
    'extension'   => 'Chrome Extension',
    'user'        => 'ผู้ใช้งานดาวน์โหลด',
    'test'        => 'ทดสอบระบบ',
    'system'      => 'ระบบอัตโนมัติ',
];

function sys_log_push_realtime_event(string $eventName, $data, ?string $plainLogLine = null): void {
    $eventsFile = LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'socketio_events.json';
    update_json_file_atomic($eventsFile, ['seq' => 0, 'events' => []], function (array $eventsData) use ($eventName, $data) {
        $seq = (int)($eventsData['seq'] ?? 0) + 1;
        $events = $eventsData['events'] ?? [];
        $events[] = [
            'seq'   => $seq,
            'event' => $eventName,
            'data'  => $data,
            'ts'    => microtime(true)
        ];
        if (count($events) > 150) {
            $events = array_slice($events, -150);
        }
        return ['seq' => $seq, 'events' => $events];
    });

    if ($plainLogLine !== null) {
        $logsFile = LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'recent_logs.json';
        update_json_file_atomic($logsFile, [], function (array $logs) use ($plainLogLine) {
            array_unshift($logs, $plainLogLine);
            if (count($logs) > 80) {
                $logs = array_slice($logs, 0, 80);
            }
            return $logs;
        });

        $fetchLogPath = LP_PAO_ROOT . DIRECTORY_SEPARATOR . 'fetch_history.log';
        rotate_log_if_needed($fetchLogPath, 5242880, 3);
        @file_put_contents($fetchLogPath, $plainLogLine . PHP_EOL, FILE_APPEND | LOCK_EX);
    }
}

/**
 * Record a structured System Log entry to MySQL tbl_system_logs and real-time feed.
 */
function sys_log_record(array $entry): ?int {
    $module        = substr(trim((string)($entry['module'] ?? 'system')), 0, 32);
    $action        = mb_substr(trim((string)($entry['action'] ?? 'System Activity')), 0, 120);
    $status        = strtolower(trim((string)($entry['status'] ?? 'success')));
    if (!in_array($status, ['running', 'success', 'partial', 'warning', 'failed'], true)) {
        $status = 'success';
    }
    $triggerSource = substr(trim((string)($entry['trigger_source'] ?? 'system')), 0, 32);
    $scheduledSlot = isset($entry['scheduled_slot']) && $entry['scheduled_slot'] !== ''
        ? substr(trim((string)$entry['scheduled_slot']), 0, 16)
        : null;
    $startedAt     = trim((string)($entry['started_at'] ?? date('Y-m-d H:i:s')));
    $finishedAt    = isset($entry['finished_at']) && $entry['finished_at'] !== ''
        ? trim((string)$entry['finished_at'])
        : ($status === 'running' ? null : date('Y-m-d H:i:s'));
    $durationMs    = max(0, (int)($entry['duration_ms'] ?? 0));
    $rowCount      = max(0, (int)($entry['row_count'] ?? 0));
    $summary       = mb_substr(trim((string)($entry['summary'] ?? '')), 0, 500);
    $errorDetail   = isset($entry['error_detail']) && $entry['error_detail'] !== ''
        ? (string)$entry['error_detail']
        : null;
    $runGroupId    = isset($entry['run_group_id']) && $entry['run_group_id'] !== ''
        ? substr(trim((string)$entry['run_group_id']), 0, 64)
        : null;
    $metaJson      = isset($entry['meta'])
        ? json_encode($entry['meta'], JSON_UNESCAPED_UNICODE)
        : (isset($entry['meta_json']) ? (string)$entry['meta_json'] : null);

    $insertedId = null;
    try {
        $pdo = get_db();
        ensure_system_logs_table($pdo);
        $stmt = $pdo->prepare(
            "INSERT INTO tbl_system_logs
             (run_group_id, module, action, status, trigger_source, scheduled_slot, started_at, finished_at, duration_ms, row_count, summary, error_detail, meta_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        );
        $stmt->execute([
            $runGroupId,
            $module,
            $action,
            $status,
            $triggerSource,
            $scheduledSlot,
            $startedAt,
            $finishedAt,
            $durationMs,
            $rowCount,
            $summary,
            $errorDetail,
            $metaJson
        ]);
        $insertedId = (int)$pdo->lastInsertId();
    } catch (Throwable $e) {
        // Fallback cleanly to file log if DB is unavailable
        error_log('[sys_log_record] ' . $e->getMessage());
    }

    $iconMap = [
        'success' => '✅ สำเร็จ',
        'failed'  => '❌ ไม่สำเร็จ',
        'partial' => '🟡 สำเร็จบางส่วน',
        'warning' => '⚠️ เฝ้าระวัง',
        'running' => '⏳ กำลังทำงาน',
    ];
    $statusLabel = $iconMap[$status] ?? $status;
    $modLabel = SYSTEM_LOG_MODULE_LABELS[$module] ?? $module;
    $slotTag = $scheduledSlot ? " [รอบ {$scheduledSlot}]" : '';
    $durStr = $durationMs > 0 ? ' (' . round($durationMs / 1000, 2) . ' วินาที)' : '';
    $errTag = ($status === 'failed' && $errorDetail) ? " | สาเหตุ: {$errorDetail}" : '';
    $plainLine = "[{$startedAt}] [{$modLabel}]{$slotTag} [{$statusLabel}] {$summary}{$durStr}{$errTag}";

    $recordPayload = [
        'id'             => $insertedId,
        'run_group_id'   => $runGroupId,
        'module'         => $module,
        'module_label'   => $modLabel,
        'action'         => $action,
        'status'         => $status,
        'trigger_source' => $triggerSource,
        'trigger_label'  => SYSTEM_LOG_TRIGGER_LABELS[$triggerSource] ?? $triggerSource,
        'scheduled_slot' => $scheduledSlot,
        'started_at'     => $startedAt,
        'finished_at'    => $finishedAt,
        'duration_ms'    => $durationMs,
        'row_count'      => $rowCount,
        'summary'        => $summary,
        'error_detail'   => $errorDetail,
        'meta'           => $entry['meta'] ?? null,
    ];

    if (empty($entry['skipRealtime'])) {
        sys_log_push_realtime_event('server_log', $plainLine, $plainLine);
        sys_log_push_realtime_event('system_log', $recordPayload, null);
    }

    return $insertedId;
}

/**
 * Query structured System Logs with filtering and aggregate statistics.
 */
function sys_log_query(array $filters = []): array {
    $pdo = get_db();
    ensure_system_logs_table($pdo);

    $where = [];
    $params = [];

    $module = trim((string)($filters['module'] ?? ''));
    if ($module !== '' && $module !== 'all') {
        if ($module === 'water_all') {
            $where[] = "module IN ('water', 'rainfall')";
        } elseif (strpos($module, ',') !== false) {
            $mods = array_values(array_filter(array_map('trim', explode(',', $module))));
            if (!empty($mods)) {
                $ph = implode(',', array_fill(0, count($mods), '?'));
                $where[] = "module IN ({$ph})";
                $params = array_merge($params, $mods);
            }
        } else {
            $where[] = "module = ?";
            $params[] = $module;
        }
    }

    $status = trim((string)($filters['status'] ?? ''));
    if ($status !== '' && $status !== 'all') {
        $where[] = "status = ?";
        $params[] = $status;
    }

    $trigger = trim((string)($filters['trigger_source'] ?? ''));
    if ($trigger !== '' && $trigger !== 'all') {
        $where[] = "trigger_source = ?";
        $params[] = $trigger;
    }

    $startDate = trim((string)($filters['startDate'] ?? ''));
    $endDate   = trim((string)($filters['endDate'] ?? ''));
    if ($startDate !== '' && $endDate !== '') {
        $where[] = "started_at BETWEEN ? AND ?";
        $params[] = "{$startDate} 00:00:00";
        $params[] = "{$endDate} 23:59:59";
    } elseif ($startDate !== '') {
        $where[] = "started_at >= ?";
        $params[] = "{$startDate} 00:00:00";
    } elseif ($endDate !== '') {
        $where[] = "started_at <= ?";
        $params[] = "{$endDate} 23:59:59";
    }

    $search = trim((string)($filters['search'] ?? ''));
    if ($search !== '') {
        $where[] = "(summary LIKE ? OR error_detail LIKE ? OR action LIKE ? OR scheduled_slot LIKE ?)";
        $like = "%{$search}%";
        $params[] = $like;
        $params[] = $like;
        $params[] = $like;
        $params[] = $like;
    }

    $whereSql = !empty($where) ? ('WHERE ' . implode(' AND ', $where)) : '';

    $limit  = max(1, min((int)($filters['limit'] ?? 100), 500));
    $offset = max(0, (int)($filters['offset'] ?? 0));

    $stmt = $pdo->prepare("SELECT * FROM tbl_system_logs {$whereSql} ORDER BY started_at DESC, id DESC LIMIT {$limit} OFFSET {$offset}");
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    foreach ($rows as &$r) {
        $r['module_label'] = SYSTEM_LOG_MODULE_LABELS[$r['module']] ?? $r['module'];
        $r['trigger_label'] = SYSTEM_LOG_TRIGGER_LABELS[$r['trigger_source']] ?? $r['trigger_source'];
        $r['meta'] = !empty($r['meta_json']) ? json_decode($r['meta_json'], true) : null;
        unset($r['meta_json']);
    }
    unset($r);

    $statStmt = $pdo->prepare("
        SELECT COUNT(*) AS total,
               SUM(status = 'success') AS success_count,
               SUM(status = 'failed') AS failed_count,
               SUM(status = 'partial') AS partial_count,
               SUM(status = 'warning') AS warning_count,
               ROUND(AVG(NULLIF(duration_ms, 0))) AS avg_duration_ms
        FROM tbl_system_logs {$whereSql}
    ");
    $statStmt->execute($params);
    $stats = $statStmt->fetch() ?: [];

    return [
        'logs' => $rows,
        'stats' => [
            'total'         => (int)($stats['total'] ?? 0),
            'success'       => (int)($stats['success_count'] ?? 0),
            'failed'        => (int)($stats['failed_count'] ?? 0),
            'partial'       => (int)($stats['partial_count'] ?? 0),
            'warning'       => (int)($stats['warning_count'] ?? 0),
            'avgDurationMs' => (int)($stats['avg_duration_ms'] ?? 0),
        ],
        'retryQueue' => retry_queue_get(),
        'freshness'  => get_latest_freshness_summary($pdo),
    ];
}

/**
 * Add-on 1: Build the Daily 48-Slot Execution Heatmap for YYYY-MM-DD.
 */
function sys_log_daily_heatmap(?string $dateYmd = null): array {
    if (!$dateYmd || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateYmd)) {
        $dateYmd = date('Y-m-d');
    }

    $cfg = get_app_config();
    $configuredSlots = array_filter(array_map('trim', (array)($cfg['scheduledTasks'] ?? [])));

    // Build canonical 48 half-hour slots and merge any custom configured HH:mm
    $allSlots = [];
    for ($h = 0; $h < 24; $h++) {
        foreach ([0, 30] as $m) {
            $allSlots[] = sprintf('%02d:%02d', $h, $m);
        }
    }
    foreach ($configuredSlots as $cs) {
        if (preg_match('/^\d{2}:\d{2}$/', $cs) && !in_array($cs, $allSlots, true)) {
            $allSlots[] = $cs;
        }
    }
    sort($allSlots);

    $pdo = get_db();
    ensure_system_logs_table($pdo);

    $stmt = $pdo->prepare(
        "SELECT id, run_group_id, module, action, status, trigger_source, scheduled_slot,
                started_at, finished_at, duration_ms, row_count, summary, error_detail
         FROM tbl_system_logs
         WHERE DATE(started_at) = ?
           AND module IN ('system','water','rainfall','drought','pm25','complaints','github_sync')
         ORDER BY started_at ASC, id ASC"
    );
    $stmt->execute([$dateYmd]);
    $logs = $stmt->fetchAll();

    // Also inspect legacy data timestamps on tbl_water_disaster_monitoring so pre-upgrade slots today are visible too
    $dbSlotStmt = $pdo->prepare(
        "SELECT DATE_FORMAT(recorded_at, '%H:%i') AS hm, MAX(recorded_at) AS rec_at, COUNT(*) AS cnt
         FROM tbl_water_disaster_monitoring
         WHERE DATE(recorded_at) = ?
         GROUP BY DATE_FORMAT(recorded_at, '%H:%i')"
    );
    $dbSlotStmt->execute([$dateYmd]);
    $waterSlotHits = $dbSlotStmt->fetchAll();

    $now = time();
    $todayYmd = date('Y-m-d', $now);
    $slotsOut = [];
    $counts = ['success' => 0, 'partial' => 0, 'failed' => 0, 'missed' => 0, 'pending' => 0];

    foreach ($allSlots as $hm) {
        $slotTs = strtotime("{$dateYmd} {$hm}:00");
        $slotLogs = [];
        foreach ($logs as $l) {
            if ($l['scheduled_slot'] === $hm) {
                $slotLogs[] = $l;
                continue;
            }
            $logHm = substr((string)$l['started_at'], 11, 5);
            if ($l['module'] === 'system' || $l['module'] === 'github_sync') {
                $logTs = strtotime((string)$l['started_at']);
                if ($logTs && abs($logTs - $slotTs) <= 180) {
                    $slotLogs[] = $l;
                }
            }
        }

        // Group statuses inside this slot
        $hasSuccess = false;
        $hasFailed  = false;
        $hasPartial = false;
        $latestSummary = '';
        $startedAt = null;
        $finishedAt = null;
        $totalRows = 0;
        $durationMs = 0;
        $moduleDetails = [];

        foreach ($slotLogs as $sl) {
            if ($startedAt === null || $sl['started_at'] < $startedAt) $startedAt = $sl['started_at'];
            if (!empty($sl['finished_at']) && ($finishedAt === null || $sl['finished_at'] > $finishedAt)) $finishedAt = $sl['finished_at'];
            if ($sl['module'] === 'system') {
                $durationMs = max($durationMs, (int)$sl['duration_ms']);
                $latestSummary = $sl['summary'];
            } else {
                $totalRows += (int)$sl['row_count'];
                $moduleDetails[$sl['module']] = [
                    'module'  => SYSTEM_LOG_MODULE_LABELS[$sl['module']] ?? $sl['module'],
                    'status'  => $sl['status'],
                    'rows'    => (int)$sl['row_count'],
                    'error'   => $sl['error_detail'],
                    'trigger' => $sl['trigger_source'],
                ];
            }
            if ($sl['status'] === 'success') $hasSuccess = true;
            elseif ($sl['status'] === 'partial') $hasPartial = true;
            elseif ($sl['status'] === 'failed') $hasFailed = true;
        }

        // Legacy pre-upgrade fallback check: if tbl_water_disaster_monitoring recorded within +/- 3 min of this slot today
        if (empty($slotLogs)) {
            foreach ($waterSlotHits as $wh) {
                $wTs = strtotime((string)$wh['rec_at']);
                if ($wTs && abs($wTs - $slotTs) <= 180) {
                    $hasSuccess = true;
                    $startedAt = $wh['rec_at'];
                    $totalRows = (int)$wh['cnt'];
                    $latestSummary = "ดึงข้อมูลระดับน้ำเข้า DB สำเร็จ ({$wh['cnt']} สถานี)";
                    break;
                }
            }
        }

        $isConfigured = empty($configuredSlots) || in_array($hm, $configuredSlots, true);

        if ($hasPartial || ($hasSuccess && $hasFailed)) {
            $slotStatus = 'partial';
        } elseif ($hasSuccess) {
            $slotStatus = 'success';
        } elseif ($hasFailed) {
            $slotStatus = 'failed';
        } elseif ($dateYmd > $todayYmd || ($dateYmd === $todayYmd && $slotTs > ($now + 60))) {
            $slotStatus = 'pending';
        } elseif (!$isConfigured) {
            $slotStatus = 'pending';
        } else {
            $slotStatus = 'missed';
        }

        $counts[$slotStatus] = ($counts[$slotStatus] ?? 0) + 1;

        $slotsOut[] = [
            'slot'          => $hm,
            'configured'    => $isConfigured,
            'status'        => $slotStatus,
            'startedAt'     => $startedAt,
            'finishedAt'    => $finishedAt,
            'durationMs'    => $durationMs,
            'rowCount'      => $totalRows,
            'summary'       => $latestSummary ?: ($slotStatus === 'pending' ? 'รอถึงรอบเวลา' : ($slotStatus === 'missed' ? 'ไม่มีบันทึกการทำงานในรอบนี้' : 'ทำงานเรียบร้อย')),
            'modules'       => array_values($moduleDetails),
        ];
    }

    return [
        'date'   => $dateYmd,
        'counts' => $counts,
        'slots'  => $slotsOut,
    ];
}

/**
 * Add-on 5: Generate UTF-8 BOM CSV string for Audit Log Export.
 */
function sys_log_export_csv(array $filters = []): string {
    $filters['limit'] = 500;
    $filters['offset'] = 0;
    $data = sys_log_query($filters);
    $rows = $data['logs'] ?? [];

    $statusText = [
        'success' => 'สำเร็จ',
        'failed'  => 'ไม่สำเร็จ',
        'partial' => 'สำเร็จบางส่วน',
        'warning' => 'เฝ้าระวัง',
        'running' => 'กำลังทำงาน',
    ];

    $csv = "\xEF\xBB\xBF";
    $csv .= "ID,วันเวลาที่เริ่ม,วันเวลาที่เสร็จ,รอบตารางเวลา,สถานะ,หมวดหมู่,กิจกรรม,ช่องทางสั่งงาน,ระยะเวลา(วินาที),จำนวนรายการ,สรุปผล,สาเหตุข้อผิดพลาด\n";

    $esc = function ($v) {
        return '"' . str_replace('"', '""', (string)$v) . '"';
    };

    foreach ($rows as $r) {
        $sec = $r['duration_ms'] > 0 ? number_format($r['duration_ms'] / 1000, 2, '.', '') : '0.00';
        $csv .= implode(',', [
            $r['id'],
            $esc($r['started_at']),
            $esc($r['finished_at'] ?? ''),
            $esc($r['scheduled_slot'] ?? '-'),
            $esc($statusText[$r['status']] ?? $r['status']),
            $esc($r['module_label']),
            $esc($r['action']),
            $esc($r['trigger_label']),
            $sec,
            (int)$r['row_count'],
            $esc($r['summary']),
            $esc($r['error_detail'] ?? ''),
        ]) . "\n";
    }

    return $csv;
}

// =========================================================================
// Add-on 2: Non-blocking Smart Auto-Retry Queue
// =========================================================================

function retry_queue_file(): string {
    return LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'retry_queue.json';
}

function retry_queue_get(): array {
    $q = read_json_file(retry_queue_file(), []);
    return is_array($q) ? $q : [];
}

function retry_queue_enqueue(string $module, ?string $scheduledSlot, string $error, int $delaySec = 120, int $maxAttempts = 3): array {
    $res = ['queued' => false, 'reason' => 'unknown'];
    update_json_file_atomic(retry_queue_file(), [], function (array $q) use ($module, $scheduledSlot, $error, $delaySec, $maxAttempts, &$res) {
        $existing = $q[$module] ?? null;
        $attempt = $existing ? (int)($existing['attempt'] ?? 1) : 0;
        if ($attempt >= $maxAttempts) {
            $res = ['queued' => false, 'reason' => 'max_attempts_reached', 'attempt' => $attempt];
            return $q;
        }

        $nextAttempt = $attempt + 1;
        $wait = $delaySec * $nextAttempt;
        $q[$module] = [
            'module'        => $module,
            'scheduledSlot' => $scheduledSlot,
            'attempt'       => $nextAttempt,
            'maxAttempts'   => $maxAttempts,
            'nextRetryAt'   => time() + $wait,
            'nextRetryIso'  => date('Y-m-d H:i:s', time() + $wait),
            'lastError'     => mb_substr($error, 0, 300),
            'enqueuedAt'    => date('Y-m-d H:i:s'),
        ];
        $res = ['queued' => true, 'item' => $q[$module]];
        return $q;
    });
    return $res;
}

function retry_queue_clear(string $module): void {
    update_json_file_atomic(retry_queue_file(), [], function (array $q) use ($module) {
        if (isset($q[$module])) {
            unset($q[$module]);
        }
        return $q;
    });
}

// =========================================================================
// Add-on 3: Upstream Data Freshness Monitor (6h / 36h thresholds)
// =========================================================================

function freshness_state_file(): string {
    return LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'freshness_state.json';
}

function freshness_latest_file(): string {
    return LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'freshness_latest.json';
}

/**
 * Check upstream observation timestamps against stale thresholds (6h water/rain/pm25, 36h drought).
 *
 * @param string $module water|rainfall|drought|pm25
 * @param array<int, array{station:string, datetime:string, ts:?int, value:mixed}> $observations
 */
function check_upstream_freshness(string $module, array $observations, ?int $nowTs = null): array {
    if ($nowTs === null) $nowTs = time();
    $thresholdSec = SYSTEM_LOG_STALE_THRESHOLDS_SEC[$module] ?? (6 * 3600);
    $thresholdHours = round($thresholdSec / 3600, 1);

    $staleStations = [];
    $freshCount = 0;
    $unknownCount = 0;
    $newestTs = 0;
    $oldestTs = PHP_INT_MAX;

    foreach ($observations as $obs) {
        $ts = $obs['ts'] ?? null;
        if (!$ts) {
            $unknownCount++;
            continue;
        }
        if ($ts > $newestTs) $newestTs = $ts;
        if ($ts < $oldestTs) $oldestTs = $ts;

        $ageSec = $nowTs - $ts;
        if ($ageSec > $thresholdSec) {
            $staleStations[] = [
                'station'  => $obs['station'],
                'datetime' => $obs['datetime'],
                'ageHours' => round($ageSec / 3600, 1),
            ];
        } else {
            $freshCount++;
        }
    }

    usort($staleStations, function ($a, $b) {
        return $b['ageHours'] <=> $a['ageHours'];
    });

    $maxLagHours = !empty($staleStations)
        ? (float)$staleStations[0]['ageHours']
        : ($newestTs > 0 ? round(($nowTs - $newestTs) / 3600, 1) : 0.0);
    $latestObsAt = !empty($staleStations)
        ? (string)$staleStations[0]['datetime']
        : ($newestTs > 0 ? date('Y-m-d H:i:s', $newestTs) : null);

    $report = [
        'module'         => $module,
        'moduleLabel'    => SYSTEM_LOG_MODULE_LABELS[$module] ?? $module,
        'checkedAt'      => date('Y-m-d H:i:s', $nowTs),
        'thresholdHours' => $thresholdHours,
        'totalStations'  => count($observations),
        'freshCount'     => $freshCount,
        'staleCount'     => count($staleStations),
        'unknownCount'   => $unknownCount,
        'isStale'        => !empty($staleStations),
        'maxLagHours'    => $maxLagHours,
        'latestObsAt'    => $latestObsAt,
        'newestUpstream' => $newestTs > 0 ? date('Y-m-d H:i:s', $newestTs) : null,
        'staleStations'  => array_slice($staleStations, 0, 15),
    ];

    update_json_file_atomic(freshness_latest_file(), [], function (array $allLatest) use ($module, $report) {
        $allLatest[$module] = $report;
        return $allLatest;
    });

    // Log warning with 6-hour anti-spam cooldown per module when stale stations exist
    if (!empty($staleStations)) {
        $shouldWarn = false;
        update_json_file_atomic(freshness_state_file(), [], function (array $state) use ($module, $nowTs, $staleStations, &$shouldWarn) {
            $lastWarnTs = (int)($state[$module]['lastWarnAt'] ?? 0);
            if (($nowTs - $lastWarnTs) >= (6 * 3600)) {
                $shouldWarn = true;
                $state[$module] = ['lastWarnAt' => $nowTs, 'staleCount' => count($staleStations)];
            }
            return $state;
        });

        if ($shouldWarn) {
            $topNames = array_map(function ($s) {
                return "{$s['station']} (ค้าง {$s['ageHours']} ชม., ล่าสุด {$s['datetime']})";
            }, array_slice($staleStations, 0, 5));
            $moreCount = max(0, count($staleStations) - 5);
            $extra = $moreCount > 0 ? " และอีก {$moreCount} สถานี" : '';

            // 6. Auto daily full MySQL dump (.sql.gz) + retention pruning
        if (file_exists(__DIR__ . '/backup_manager.php')) {
            require_once __DIR__ . '/backup_manager.php';
            try {
                $bk = run_daily_db_backup_if_due();
                $stats['dailyBackup'] = $bk['filename'] ?? ($bk['reason'] ?? 'ok');
            } catch (Throwable $e) {
                $stats['dailyBackup'] = 'error: ' . $e->getMessage();
            }
        }

        sys_log_record([
                'module'         => 'freshness',
                'action'         => 'ตรวจความสดข้อมูลต้นทาง: ' . ($report['moduleLabel']),
                'status'         => 'warning',
                'trigger_source' => 'system',
                'started_at'     => date('Y-m-d H:i:s', $nowTs),
                'finished_at'    => date('Y-m-d H:i:s', $nowTs),
                'duration_ms'    => 1,
                'row_count'      => count($staleStations),
                'summary'        => "พบ {$report['moduleLabel']} ต้นทางไม่อัปเดตเกิน {$thresholdHours} ชม. จำนวน " . count($staleStations) . "/" . count($observations) . " สถานี: " . implode(', ', $topNames) . $extra,
                'meta'           => $report,
            ]);
        }
    }

    return $report;
}

function get_latest_freshness_summary(PDO $pdo): array {
    $cached = read_json_file(freshness_latest_file(), []);
    if (!empty($cached)) {
        return $cached;
    }

    // Fallback DB age summary before first post-upgrade collection cycle runs
    $out = [];
    foreach ([
        'water'    => 'tbl_water_disaster_monitoring',
        'rainfall' => 'tbl_rainfall_monitoring',
        'drought'  => 'tbl_drought_monitoring',
        'pm25'     => 'tbl_pm25_monitoring',
    ] as $mod => $tbl) {
        try {
            $rec = $pdo->query("SELECT MAX(recorded_at) AS last_rec, COUNT(*) AS total FROM {$tbl}")->fetch();
            $out[$mod] = [
                'module'         => $mod,
                'moduleLabel'    => SYSTEM_LOG_MODULE_LABELS[$mod] ?? $mod,
                'checkedAt'      => date('Y-m-d H:i:s'),
                'thresholdHours' => round((SYSTEM_LOG_STALE_THRESHOLDS_SEC[$mod] ?? 21600) / 3600, 1),
                'totalStations'  => 0,
                'freshCount'     => 0,
                'staleCount'     => 0,
                'unknownCount'   => 0,
                'isStale'        => false,
                'maxLagHours'    => 0,
                'latestObsAt'    => $rec['last_rec'] ?? null,
                'newestUpstream' => $rec['last_rec'] ?? null,
                'staleStations'  => [],
            ];
        } catch (Throwable $e) {
            // ignore
        }
    }
    return $out;
}

/**
 * 24/7 Server Sustainability: Daily log rotation, snapshot retention, session cleanup, & DB log pruning.
 */
function run_system_housekeeping(bool $force = false): array {
    $stateFile = LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'runtime_state.json';
    $now = time();
    if (!$force) {
        $st = read_json_file($stateFile, []);
        if (($now - (int)($st['lastHousekeepingAt'] ?? 0)) < 86400) {
            return ['ran' => false, 'reason' => 'cooldown_24h'];
        }
    }

    $result = with_file_lock('housekeeping', function () use ($stateFile, $now, $force) {
        $st = read_json_file($stateFile, []);
        if (!$force && ($now - (int)($st['lastHousekeepingAt'] ?? 0)) < 86400) {
            return ['ran' => false, 'reason' => 'cooldown_24h'];
        }

        update_json_file_atomic($stateFile, [], function (array $s) use ($now) {
            $s['lastHousekeepingAt'] = $now;
            return $s;
        });

        $stats = [
            'ran'              => true,
            'rotatedLogs'      => 0,
            'deletedSysLogs'   => 0,
            'prunedSnapDirs'   => 0,
            'cleanedTmpFiles'  => 0,
            'cleanedSessions'  => 0,
        ];

        // 1. Rotate fetch_history.log > 5MB (keep .1 .. .3)
        $fetchLogPath = LP_PAO_ROOT . DIRECTORY_SEPARATOR . 'fetch_history.log';
        if (file_exists($fetchLogPath) && (@filesize($fetchLogPath) ?: 0) >= 5242880) {
            rotate_log_if_needed($fetchLogPath, 5242880, 3);
            $stats['rotatedLogs'] = 1;
        }

        // 2. Clean orphaned *.tmp.* files > 1h old inside runtime dir
        $tmpFiles = glob(LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . '*.tmp.*') ?: [];
        foreach ($tmpFiles as $tf) {
            if (($now - (@filemtime($tf) ?: $now)) > 3600) {
                if (@unlink($tf)) $stats['cleanedTmpFiles']++;
            }
        }

        // 3. Remove expired sessions
        $sessPath = LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'sessions.json';
        if (file_exists($sessPath)) {
            update_json_file_atomic($sessPath, [], function (array $sessions) use ($now, &$stats) {
                $kept = [];
                foreach ($sessions as $k => $v) {
                    if (($v['expires'] ?? 0) > $now) {
                        $kept[$k] = $v;
                    } else {
                        $stats['cleanedSessions']++;
                    }
                }
                return $kept;
            });
        }

        // 4. Prune tbl_system_logs older than retention policy (default 90 days)
        $keepDays = max(7, (int)env_val('SYSTEM_LOG_RETENTION_DAYS', '90'));
        try {
            $pdo = get_db();
            ensure_system_logs_table($pdo);
            $cutoff = date('Y-m-d H:i:s', $now - ($keepDays * 86400));
            $delStmt = $pdo->prepare("DELETE FROM tbl_system_logs WHERE started_at < ?");
            $delStmt->execute([$cutoff]);
            $stats['deletedSysLogs'] = $delStmt->rowCount();
        } catch (Throwable $e) {
            // keep running
        }

        // 5. Prune local snapshot date folders older than SNAPSHOT_LOCAL_RETENTION_DAYS (default 30 days)
        $snapDays = max(7, (int)env_val('SNAPSHOT_LOCAL_RETENTION_DAYS', '30'));
        $snapBase = LP_PAO_ROOT . DIRECTORY_SEPARATOR . 'cloud_snapshots';
        $cutoffYmd = date('Y-m-d', $now - ($snapDays * 86400));
        if (is_dir($snapBase)) {
            foreach ((scandir($snapBase) ?: []) as $entry) {
                if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $entry)) continue;
                if ($entry < $cutoffYmd) {
                    $dirPath = $snapBase . DIRECTORY_SEPARATOR . $entry;
                    if (is_dir($dirPath)) {
                        foreach ((scandir($dirPath) ?: []) as $f) {
                            if ($f !== '.' && $f !== '..') @unlink($dirPath . DIRECTORY_SEPARATOR . $f);
                        }
                        if (@rmdir($dirPath)) $stats['prunedSnapDirs']++;
                    }
                }
            }
        }

        // 6. Auto daily full MySQL dump (.sql.gz) + retention pruning
        if (file_exists(__DIR__ . '/backup_manager.php')) {
            require_once __DIR__ . '/backup_manager.php';
            try {
                $bk = run_daily_db_backup_if_due();
                $stats['dailyBackup'] = $bk['filename'] ?? ($bk['reason'] ?? 'ok');
            } catch (Throwable $e) {
                $stats['dailyBackup'] = 'error: ' . $e->getMessage();
            }
        }

        sys_log_record([
            'module'         => 'system',
            'action'         => 'Daily Housekeeping & Log Rotation',
            'status'         => 'success',
            'trigger_source' => 'system',
            'row_count'      => $stats['deletedSysLogs'] + $stats['prunedSnapDirs'],
            'summary'        => "บำรุงรักษาระบบรายวัน: Rotate Log={$stats['rotatedLogs']}, ลบ SysLog เก่าเกิน {$keepDays} วัน={$stats['deletedSysLogs']} แถว, ลบไฟล์ Temp={$stats['cleanedTmpFiles']}, ล้าง Session หมดอายุ={$stats['cleanedSessions']}",
            'meta'           => $stats,
        ]);

        return $stats;
    }, true);

    return is_array($result) ? $result : ['ran' => false, 'reason' => 'locked'];
}

/**
 * Lightweight 24/7 Health Check for Uptime Monitoring (GET /api/health).
 */
function get_system_health_report(): array {
    $t0 = microtime(true);
    $dbConnected = false;
    $dbLatencyMs = 0;
    $dbErr = null;
    $latestWaterAt = null;
    $latestDroughtAt = null;
    $latestPm25At = null;
    $waterAgeMin = null;
    $recentFailed24h = 0;

    try {
        $p0 = microtime(true);
        $pdo = get_db();
        $pdo->query('SELECT 1');
        $dbLatencyMs = (int)round((microtime(true) - $p0) * 1000);
        $dbConnected = true;

        $latestWaterAt   = $pdo->query("SELECT MAX(recorded_at) FROM tbl_water_disaster_monitoring")->fetchColumn() ?: null;
        $latestDroughtAt = $pdo->query("SELECT MAX(recorded_at) FROM tbl_drought_monitoring")->fetchColumn() ?: null;
        $latestPm25At    = $pdo->query("SELECT MAX(recorded_at) FROM tbl_pm25_monitoring")->fetchColumn() ?: null;

        if ($latestWaterAt) {
            $ts = strtotime((string)$latestWaterAt);
            if ($ts) $waterAgeMin = (int)max(0, round((time() - $ts) / 60));
        }

        ensure_system_logs_table($pdo);
        $recentFailed24h = (int)$pdo->query("SELECT COUNT(*) FROM tbl_system_logs WHERE status = 'failed' AND started_at >= NOW() - INTERVAL 24 HOUR")->fetchColumn();
    } catch (Throwable $e) {
        $dbErr = $e->getMessage();
    }

    $wState = read_json_file(LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'smart_worker_state.json', []);
    $lastHb = (int)($wState['lastHeartbeat'] ?? 0);
    $stopFlag = file_exists(LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'smart_worker.stop');
    $workerAlive = ($lastHb > 0) && ((time() - $lastHb) <= 60) && !$stopFlag;

    $fetchLogPath = LP_PAO_ROOT . DIRECTORY_SEPARATOR . 'fetch_history.log';
    $fetchLogKb = file_exists($fetchLogPath) ? round((@filesize($fetchLogPath) ?: 0) / 1024, 1) : 0.0;
    $freeBytes = @disk_free_space(LP_PAO_ROOT);
    $freeMb = ($freeBytes !== false) ? (int)round($freeBytes / 1048576) : null;

    $spoolCnt = 0;
    $backupsList = [];
    if (file_exists(__DIR__ . '/backup_manager.php')) {
        require_once __DIR__ . '/backup_manager.php';
        $spoolCnt = db_spool_count();
        $backupsList = list_db_backups();
    }

    $cfg = get_app_config();
    $anyScheduleActive = !empty($cfg['isScheduleActive']['water']) || !empty($cfg['isScheduleActive']['drought']);
    $retryQ = retry_queue_get();

    $status = 'healthy';
    $httpCode = 200;
    $issues = [];

    if (!$dbConnected) {
        $status = 'critical';
        $httpCode = 503;
        $issues[] = 'MySQL disconnected: ' . ($dbErr ?: 'unknown');
    }
    if ($freeMb !== null && $freeMb < 250) {
        $status = 'critical';
        $httpCode = 503;
        $issues[] = "Low disk space: {$freeMb} MB free";
    }
    if ($dbConnected && $anyScheduleActive && $waterAgeMin !== null && $waterAgeMin > 240 && !$workerAlive) {
        $status = 'degraded';
        $httpCode = 503;
        $issues[] = "No new water data for {$waterAgeMin}m and background worker inactive";
    }
    if (!empty($retryQ)) {
        if ($status === 'healthy') $status = 'warning';
        $issues[] = 'Pending auto-retry modules: ' . implode(', ', array_keys($retryQ));
    }

    return [
        'status'     => $status,
        'httpCode'   => $httpCode,
        'timestamp'  => date('Y-m-d H:i:s'),
        'elapsedMs'  => (int)round((microtime(true) - $t0) * 1000),
        'issues'     => $issues,
        'database'   => [
            'connected'  => $dbConnected,
            'latencyMs'  => $dbLatencyMs,
            'error'      => $dbErr,
        ],
        'latestData' => [
            'waterRecordedAt'   => $latestWaterAt,
            'waterAgeMinutes'   => $waterAgeMin,
            'droughtRecordedAt' => $latestDroughtAt,
            'pm25RecordedAt'    => $latestPm25At,
        ],
        'worker'     => [
            'alive'         => $workerAlive,
            'mode'          => $wState['mode'] ?? 'idle',
            'lastHeartbeat' => $lastHb ? date('Y-m-d H:i:s', $lastHb) : null,
            'stopFlag'      => $stopFlag,
        ],
        'storage'    => [
            'diskFreeMb'     => $freeMb,
            'fetchLogSizeKb' => $fetchLogKb,
            'retryQueueCount'=> count($retryQ),
            'dbSpoolCount'   => $spoolCnt,
            'failedLast24h'  => $recentFailed24h,
        ],
        'backup'     => [
            'count'       => count($backupsList),
            'latestFile'  => $backupsList[0]['filename'] ?? null,
            'latestAt'    => $backupsList[0]['createdAt'] ?? null,
            'latestSizeKb'=> $backupsList[0]['sizeKb'] ?? 0,
        ],
        'security'   => [
            'hasRootHtaccess'    => file_exists(LP_PAO_ROOT . DIRECTORY_SEPARATOR . '.htaccess'),
            'hasRuntimeHtaccess' => file_exists(LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . '.htaccess'),
            'authEnforce'        => AUTH_ENFORCE,
            'setupConfigured'    => file_exists(LP_PAO_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'db_config.json'),
        ],
    ];
}
