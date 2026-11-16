<?php
// =========================================================================
// Water_System2 — Web Self-Looping Smart Sleep Worker (Zero-Admin Servers)
// Drop this on any standard Apache/Nginx PHP host and trigger once:
//   http://server/Water_System2/worker.php?action=start
//   http://server/Water_System2/worker.php?action=status
//   http://server/Water_System2/worker.php?action=stop
//
// How it works with ZERO OS Cron & ZERO Idle Bandwidth:
//   - Acquires an exclusive flock() so at most 1 worker runs at any time.
//   - Uses Smart Sleep to wait cleanly for the next HH:mm in config.json.
//   - Consumes 0 bytes of API bandwidth and 0 SQL queries while sleeping.
//   - Wakes up only at scheduled times and fetches all 5 APIs in ~1.5s via curl_multi.
// =========================================================================

$phpServerDir = is_dir(__DIR__ . '/php_server') ? __DIR__ . '/php_server' : dirname(__DIR__) . '/php_server';
require_once $phpServerDir . '/smart_worker_lib.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$action = $_GET['action'] ?? 'chain';

if ($action === 'status') {
    echo json_encode(['success' => true, 'worker' => smart_worker_status()], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

if ($action === 'stop') {
    @file_put_contents(smart_worker_stop_flag_file(), date('c'));
    add_server_log('SmartSleep', '⏹️ สั่งหยุด Web Background Worker แล้ว');
    echo json_encode(['success' => true, 'message' => 'Stop signal sent to Smart Sleep Worker', 'worker' => smart_worker_status()], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($action === 'start') {
    @unlink(smart_worker_stop_flag_file());
    $status = smart_worker_status();
    if ($status['running']) {
        echo json_encode(['success' => true, 'message' => 'Smart Sleep Worker ทำงานอยู่แล้ว', 'worker' => $status], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // Build self-URL for non-blocking background chain
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? '127.0.0.1:7000';
    $script = $_SERVER['SCRIPT_NAME'] ?? '/worker.php';
    $selfUrl = "{$scheme}://{$host}{$script}?action=chain";

    smart_fire_self_chain($selfUrl);
    add_server_log('SmartSleep', '🚀 เริ่มระบบ Smart Sleep Worker บน Server แล้ว (พักรอ 0 Byte จนกว่าจะถึงเวลาในตาราง)');
    echo json_encode(['success' => true, 'message' => 'Started Smart Sleep Worker in background', 'worker' => smart_worker_status()], JSON_UNESCAPED_UNICODE);
    exit;
}

// Default: background chain execution
if (file_exists(smart_worker_stop_flag_file())) {
    echo json_encode(['success' => true, 'stopped' => true]);
    exit;
}

$lockFp = @fopen(smart_worker_lock_file(), 'c+');
if (!$lockFp || !@flock($lockFp, LOCK_EX | LOCK_NB)) {
    echo json_encode(['success' => true, 'alreadyRunning' => true]);
    exit;
}

@ignore_user_abort(true);
@set_time_limit(60);

// Flush minimal response early if possible, then work cleanly in background
if (function_exists('fastcgi_finish_request')) {
    echo json_encode(['success' => true, 'accepted' => true]);
    @fastcgi_finish_request();
}

$wState = read_json_file(smart_worker_state_file(), []);
$wState['mode'] = 'web_smart_sleep';
$wState['pid'] = getmypid();
$wState['lastHeartbeat'] = time();
write_json_file(smart_worker_state_file(), $wState);

// Check if a scheduled HH:mm slot is due right now
smart_check_and_run_if_due(true);

// Calculate Smart Sleep duration (sleep up to 20s per HTTP hop so shared hosting never hits 30s timeout)
$cfg = get_app_config();
$next = smart_compute_next_slot($cfg['scheduledTasks'] ?? [], time());
$sleepSec = max(2, min(20, (int)$next['secondsUntil']));
sleep($sleepSec);

// Update heartbeat after sleep
$wState = read_json_file(smart_worker_state_file(), []);
$wState['lastHeartbeat'] = time();
write_json_file(smart_worker_state_file(), $wState);

$shouldChain = !file_exists(smart_worker_stop_flag_file());
@flock($lockFp, LOCK_UN);
@fclose($lockFp);

if ($shouldChain) {
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? '127.0.0.1:7000';
    $script = $_SERVER['SCRIPT_NAME'] ?? '/worker.php';
    $selfUrl = "{$scheme}://{$host}{$script}?action=chain";
    smart_fire_self_chain($selfUrl);
}
