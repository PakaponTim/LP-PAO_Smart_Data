<?php
// =========================================================================
// Water_System2 — Background Smart-Sleep Scheduler (CLI Daemon or --once)
// Usage:
//   php php_server/scheduler.php         -> Smart Sleep 24/7 loop (0% idle bandwidth)
//   php php_server/scheduler.php --once  -> Run curl_multi parallel fetch immediately
// =========================================================================

require_once __DIR__ . '/smart_worker_lib.php';

$runOnce = in_array('--once', $argv ?? [], true);

if ($runOnce) {
    add_server_log('Scheduler-7000', '🚀 เริ่มดึงข้อมูลครบทุกโปรเจคพร้อมกัน (One-shot curl_multi)...');
    $cfg = get_app_config();
    $res = collect_all_parallel_direct($cfg['isScheduleActive'] ?? []);
    add_server_log('Scheduler-7000', "✅ ดึงข้อมูลครบทุกโปรเจคเสร็จสมบูรณ์ ({$res['elapsedSec']} วินาที)");
    exit(0);
}

$lockFp = @fopen(smart_worker_lock_file(), 'c+');
if (!$lockFp || !@flock($lockFp, LOCK_EX | LOCK_NB)) {
    echo "Smart Sleep Scheduler is already running.\n";
    exit(0);
}

@unlink(smart_worker_stop_flag_file());
$cfg = get_app_config();
$next = smart_compute_next_slot($cfg['scheduledTasks'] ?? []);
add_server_log('SmartSleep', '⏰ ระบบ Smart Sleep Scheduler เริ่มทำงาน (พักรอ 0 Byte จนกว่าจะถึงรอบถัดไป: ' . ($next['slot'] ?? 'N/A') . ')');

while (!file_exists(smart_worker_stop_flag_file())) {
    try {
        $now = time();
        $wState = read_json_file(smart_worker_state_file(), []);
        $wState['mode'] = 'cli_daemon';
        $wState['pid'] = getmypid();
        $wState['lastHeartbeat'] = $now;
        write_json_file(smart_worker_state_file(), $wState);

        // Run only when current HH:mm matches a configured scheduled slot
        smart_check_and_run_if_due(true);

        // Calculate Smart Sleep duration until the next slot (capped at 25s so UI edits to config.json take effect promptly)
        $cfg = get_app_config();
        $next = smart_compute_next_slot($cfg['scheduledTasks'] ?? [], time());
        $sleepSec = max(1, min(25, (int)$next['secondsUntil']));
        sleep($sleepSec);
    } catch (Throwable $e) {
        add_server_log('SmartSleep', '⚠️ ข้อผิดพลาดชั่วคราว: ' . $e->getMessage());
        sleep(15);
    }
}

@flock($lockFp, LOCK_UN);
@fclose($lockFp);
