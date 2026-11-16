<?php
// =========================================================================
// Water_System2 — Smart Sleep Scheduler Library
// "หลับรอจนถึงเวลา (Smart Sleep ตามตารางเวลา)"
//   - Zero Bandwidth & Zero DB queries while waiting for the next slot
//   - Wakes up only at configured HH:mm slots in config.json
//   - Runs all 5 APIs in parallel via curl_multi (~1.5s total)
// =========================================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/collectors.php';
require_once __DIR__ . '/github_sync_to_mysql.php';

function smart_compute_next_slot(array $tasks, ?int $now = null): array {
    if ($now === null) $now = time();
    $clean = [];
    foreach ($tasks as $t) {
        $t = trim((string)$t);
        if (preg_match('/^([01]\d|2[0-3]):([0-5]\d)$/', $t)) {
            $clean[] = $t;
        }
    }
    $clean = array_values(array_unique($clean));
    sort($clean);

    if (empty($clean)) {
        return ['slot' => null, 'timestamp' => null, 'secondsUntil' => 60];
    }

    $todayStr = date('Y-m-d', $now);
    $tomorrowStr = date('Y-m-d', $now + 86400);

    foreach ($clean as $hm) {
        $ts = strtotime("{$todayStr} {$hm}:00");
        if ($ts > $now) {
            return ['slot' => $hm, 'timestamp' => $ts, 'secondsUntil' => max(1, $ts - $now)];
        }
    }

    // Wrap to first slot tomorrow
    $firstHm = $clean[0];
    $ts = strtotime("{$tomorrowStr} {$firstHm}:00");
    return ['slot' => $firstHm, 'timestamp' => $ts, 'secondsUntil' => max(1, $ts - $now)];
}

function smart_worker_state_file(): string {
    return WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'smart_worker_state.json';
}

function smart_worker_stop_flag_file(): string {
    return WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'smart_worker.stop';
}

function smart_worker_lock_file(): string {
    return WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'smart_worker.lock';
}

function smart_worker_status(): array {
    $state = read_json_file(smart_worker_state_file(), []);
    $cfg = get_app_config();
    $next = smart_compute_next_slot($cfg['scheduledTasks'] ?? []);
    $lastHeartbeat = (int)($state['lastHeartbeat'] ?? 0);
    $isRunning = ($lastHeartbeat > 0) && ((time() - $lastHeartbeat) <= 45) && !file_exists(smart_worker_stop_flag_file());

    return [
        'running' => $isRunning,
        'mode' => $state['mode'] ?? 'idle',
        'pid' => $state['pid'] ?? null,
        'lastHeartbeat' => $lastHeartbeat ? format_iso_datetime($lastHeartbeat) : null,
        'lastRunAt' => !empty($state['lastRunAt']) ? format_iso_datetime((int)$state['lastRunAt']) : null,
        'lastSlot' => $state['lastScheduledSlot'] ?? null,
        'nextSlot' => $next['slot'],
        'secondsUntilNext' => $next['secondsUntil'],
        'nextRunAt' => $next['timestamp'] ? format_iso_datetime($next['timestamp']) : null,
        'bandwidthWhileSleeping' => '0 B'
    ];
}

function smart_check_and_run_if_due(bool $allowStartupCatchup = false, string $source = 'smart_sleep'): array {
    $stateFile = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'runtime_state.json';
    $cfg = get_app_config();
    $active = $cfg['isScheduleActive'] ?? [];
    $anyActive = !empty($active['water']) || !empty($active['drought']) || !empty($active['pm25']) || !empty($active['complaints']);

    if (!$anyActive) {
        return ['ran' => false, 'reason' => 'schedule_disabled'];
    }

    $tasks = $cfg['scheduledTasks'] ?? [];
    if (empty($tasks)) {
        return ['ran' => false, 'reason' => 'no_tasks_configured'];
    }

    // Atomic check-and-mark inside mutex so concurrent callers never double-fire the same HH:mm slot
    $claim = with_file_lock('smart_slot_state', function () use ($stateFile, $tasks, $allowStartupCatchup) {
        $state = read_json_file($stateFile, []);
        $now = time();
        $hm = date('H:i', $now);
        $currentSlot = date('Y-m-d H:i', $now);

        $isDue = false;
        $dueSlot = $currentSlot;

        if (in_array($hm, $tasks, true) && (($state['lastScheduledSlot'] ?? '') !== $currentSlot)) {
            $isDue = true;
        } elseif ($allowStartupCatchup) {
            foreach ($tasks as $slotHm) {
                $slotTs = strtotime(date('Y-m-d', $now) . " {$slotHm}:00");
                if ($slotTs !== false && $now >= $slotTs && ($now - $slotTs) <= 180) {
                    $slotKey = date('Y-m-d H:i', $slotTs);
                    if (($state['lastScheduledSlot'] ?? '') !== $slotKey) {
                        $isDue = true;
                        $dueSlot = $slotKey;
                        break;
                    }
                }
            }
        }

        if (!$isDue) {
            return ['due' => false, 'hm' => $hm, 'dueSlot' => null];
        }

        $state['lastScheduledSlot'] = $dueSlot;
        $state['lastAutoDirectCollect'] = $now;
        write_json_file($stateFile, $state);
        return ['due' => true, 'hm' => $hm, 'dueSlot' => $dueSlot];
    }, false);

    if (empty($claim['due'])) {
        return ['ran' => false, 'reason' => 'sleeping_until_next_slot'];
    }

    $hm = $claim['hm'];
    $dueSlot = $claim['dueSlot'];

    @ignore_user_abort(true);
    if (PHP_SAPI !== 'cli') {
        @set_time_limit(120);
    }

    $slotHm = substr($dueSlot, 11, 5);
    add_server_log('SmartSleep', "⏰ ถึงเวลาตามตาราง ({$hm}) — ตื่นขึ้นมาดึง 5 API พร้อมกัน (curl_multi)...");
    $res = collect_all_parallel_direct($active, $source, $slotHm);

    // Retry any queued failed tasks right after scheduled cycle
    if (function_exists('retry_queue_process_due')) {
        retry_queue_process_due();
    }

    // Also update smart worker state
    $wState = read_json_file(smart_worker_state_file(), []);
    $wState['lastRunAt'] = time();
    $wState['lastScheduledSlot'] = $dueSlot;
    write_json_file(smart_worker_state_file(), $wState);

    return ['ran' => true, 'slot' => $dueSlot, 'parallelResult' => $res];
}

function smart_build_self_url(string $scriptName = 'worker.php', string $query = ''): string {
    $proto = $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '';
    $isHttps = (stripos($proto, 'https') !== false) || (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    $scheme = $isHttps ? 'https' : 'http';
    $host = $_SERVER['HTTP_X_FORWARDED_HOST'] ?? ($_SERVER['HTTP_HOST'] ?? '127.0.0.1:7000');
    $scriptDir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/' . $scriptName)), '/');
    $base = "{$scheme}://{$host}{$scriptDir}/{$scriptName}";
    return $query !== '' ? "{$base}?{$query}" : $base;
}

function smart_fire_self_chain(string $url): void {
    $parts = parse_url($url);
    if (!$parts || empty($parts['host'])) return;

    $scheme = $parts['scheme'] ?? 'http';
    $host = $parts['host'];
    $port = $parts['port'] ?? ($scheme === 'https' ? 443 : 80);
    $path = ($parts['path'] ?? '/') . (isset($parts['query']) ? '?' . $parts['query'] : '');

    if (function_exists('fsockopen')) {
        $prefix = ($scheme === 'https') ? 'ssl://' : '';
        $fp = @fsockopen($prefix . $host, (int)$port, $errno, $errstr, 2);
        if ($fp) {
            $req  = "GET {$path} HTTP/1.1\r\n";
            $req .= "Host: {$host}" . (isset($parts['port']) ? ":{$port}" : '') . "\r\n";
            $req .= "Connection: Close\r\n\r\n";
            @fwrite($fp, $req);
            @usleep(50000);
            @fclose($fp);
            return;
        }
    }

    // Fallback: ultra-short timeout curl trigger (supports self-signed / reverse proxy)
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT_MS => 500,
        CURLOPT_CONNECTTIMEOUT_MS => 500,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0
    ]);
    $ok = @curl_exec($ch);
    $errno = curl_errno($ch);
    $err = curl_error($ch);
    curl_close($ch);
    // CURLE_OPERATION_TIMEDOUT (28) after connect is normal for fire-and-forget self-chain
    if ($ok === false && $errno !== 0 && $errno !== 28) {
        add_server_log('SmartSleep', "⚠️ Web self-chain ไม่สามารถเรียกตัวเองได้ ({$url}): {$err}");
    }
}
