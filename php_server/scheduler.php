<?php
// =========================================================================
// Water_System2 — Background Smart-Sleep Scheduler (CLI Daemon or --once)
// Usage:
//   php php_server/scheduler.php         -> Smart Sleep 24/7 loop (0% idle bandwidth)
//   php php_server/scheduler.php --once  -> Run curl_multi parallel fetch immediately
// =========================================================================

require_once __DIR__ . '/smart_worker_lib.php';
require_once __DIR__ . '/backup_manager.php';

@set_time_limit(0);
@ini_set('max_execution_time', '0');

$runOnce = in_array('--once', $argv ?? [], true);

if ($runOnce) {
    add_server_log('Scheduler-7000', '🚀 เริ่มดึงข้อมูลครบทุกโปรเจคพร้อมกัน (One-shot curl_multi)...');
    $cfg = get_app_config();
    $res = collect_all_parallel_direct($cfg['isScheduleActive'] ?? [], 'cli_once', date('H:i'));
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

// Catch up missed Cloud Snapshots & local spool immediately after startup / power outage
try {
    flush_db_spool(20);
    sync_github_snapshots_to_mysql(10);
} catch (Throwable $e) {
    add_server_log('SmartSleep', '⚠️ ข้ามการซิงก์ย้อนหลังตอนเริ่มต้น: ' . $e->getMessage());
}
$lastCloudSyncAt = time();

while (!file_exists(smart_worker_stop_flag_file())) {
    try {
        $now = time();
        $wState = read_json_file(smart_worker_state_file(), []);
        $wState['mode'] = 'cli_daemon';
        $wState['pid'] = getmypid();
        $wState['lastHeartbeat'] = $now;
        write_json_file(smart_worker_state_file(), $wState);

        // Flush any spooled rows once DB comes back online
        if (db_spool_count() > 0) {
            flush_db_spool(15);
        }

        // Run only when current HH:mm matches a configured scheduled slot
        smart_check_and_run_if_due(true, 'smart_sleep');

        // Process any queued non-blocking auto-retries whose backoff elapsed
        if (function_exists('retry_queue_process_due')) {
            retry_queue_process_due();
        }

        // Every 30 min catch up any new GitHub Actions snapshots if internet/scheduler recovered
        if ((time() - $lastCloudSyncAt) >= 1800) {
            $lastCloudSyncAt = time();
            sync_github_snapshots_to_mysql(5);
        }

        // Restore unlimited CLI execution time in case a subtask (e.g. daily backup) called set_time_limit(300)
        @set_time_limit(0);

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
