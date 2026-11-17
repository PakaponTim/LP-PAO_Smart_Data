<?php
// =========================================================================
// Water_System2 — Web Cron Endpoint (http://server/Water_System2/cron.php)
// Safe for 24/7 Subdomain / Shared Hosting:
//   - Optional CRON_SECRET verification (if set in .env)
//   - 90-second cooldown + exclusive collect_cycle mutex prevents duplicate runs
//   - Syncs GitHub snapshots, runs parallel API collection, & processes Auto-Retry
// =========================================================================

$phpServerDir = is_dir(__DIR__ . '/php_server') ? __DIR__ . '/php_server' : dirname(__DIR__) . '/php_server';
require_once $phpServerDir . '/smart_worker_lib.php';
require_once $phpServerDir . '/auth.php';
require_once $phpServerDir . '/backup_manager.php';

@ignore_user_abort(true);
@set_time_limit(180);

security_apply_http_headers(true);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$forceRun = !empty($_GET['force']);
$cronSecret = env_val('CRON_SECRET', '');
if ($cronSecret !== '') {
    if (!security_verify_cron_or_admin(false)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Forbidden: invalid CRON_SECRET or HMAC signature'], JSON_UNESCAPED_UNICODE);
        exit;
    }
} elseif ($forceRun && !security_verify_cron_or_admin(true)) {
    // Even if CRON_SECRET is unset, external callers cannot bypass 90s cooldown via ?force=1 without admin session
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Forbidden: external force-cron requires admin session or CRON_SECRET'], JSON_UNESCAPED_UNICODE);
    exit;
}
$stateFile = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'runtime_state.json';
$now = time();

$results = [
    'timestamp'   => date('Y-m-d H:i:s'),
    'database'    => env_val('DB_NAME', 'water_system2'),
    'db_spool'    => null,
    'github_sync' => null,
    'parallel'    => null,
    'retry_queue' => null,
];

try {
    $results['db_spool'] = flush_db_spool(20);
} catch (Throwable $e) {
    $results['db_spool'] = ['flushed' => 0, 'error' => $e->getMessage()];
}

try {
    $results['github_sync'] = sync_github_snapshots_to_mysql(10);
} catch (Throwable $e) {
    $results['github_sync'] = ['success' => false, 'error' => $e->getMessage()];
}

$cooldownOk = true;
update_json_file_atomic($stateFile, [], function (array $state) use ($now, $forceRun, &$cooldownOk) {
    $lastCron = (int)($state['lastCronRunAt'] ?? 0);
    if (!$forceRun && ($now - $lastCron) < 90) {
        $cooldownOk = false;
        return $state;
    }
    $state['lastCronRunAt'] = $now;
    $state['lastAutoDirectCollect'] = $now;
    $state['lastGitHubSyncCheck'] = $now;
    $state['lastScheduledSlot'] = date('Y-m-d H:i', $now);
    return $state;
});

if (!$cooldownOk) {
    try {
        $results['retry_queue'] = retry_queue_process_due();
    } catch (Throwable $e) {}
    echo json_encode([
        'success' => true,
        'skipped' => true,
        'reason'  => 'cooldown_90s_active',
        'results' => $results,
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

$cfg = get_app_config();
$active = $cfg['isScheduleActive'] ?? ['water' => true, 'drought' => true, 'pm25' => true, 'complaints' => true];

try {
    $results['parallel'] = collect_all_parallel_direct($active, 'web_cron', date('H:i'));
} catch (Throwable $e) {
    $results['parallel'] = ['success' => false, 'error' => $e->getMessage()];
}

try {
    $results['retry_queue'] = retry_queue_process_due();
} catch (Throwable $e) {}

echo json_encode(['success' => true, 'results' => $results], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
