<?php
// =========================================================================
// Water_System2 — Web Cron Endpoint (http://server/Water_System2/cron.php)
// Uses curl_multi to fetch all 5 APIs simultaneously in ~1.5 seconds
// and syncs any GitHub Actions backup snapshots into MySQL.
// =========================================================================

$phpServerDir = is_dir(__DIR__ . '/php_server') ? __DIR__ . '/php_server' : dirname(__DIR__) . '/php_server';
require_once $phpServerDir . '/smart_worker_lib.php';

@ignore_user_abort(true);
@set_time_limit(180);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$results = [
    'timestamp'   => date('Y-m-d H:i:s'),
    'database'    => env_val('DB_NAME', 'water_system2'),
    'github_sync' => null,
    'parallel'    => null
];

try {
    $results['github_sync'] = sync_github_snapshots_to_mysql();
} catch (Throwable $e) {
    $results['github_sync'] = ['success' => false, 'error' => $e->getMessage()];
}

$cfg = get_app_config();
$active = $cfg['isScheduleActive'] ?? ['water' => true, 'drought' => true, 'pm25' => true, 'complaints' => true];

try {
    $results['parallel'] = collect_all_parallel_direct($active);
} catch (Throwable $e) {
    $results['parallel'] = ['success' => false, 'error' => $e->getMessage()];
}

$stateFile = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'runtime_state.json';
$state = read_json_file($stateFile, []);
$state['lastAutoDirectCollect'] = time();
$state['lastGitHubSyncCheck'] = time();
$state['lastScheduledSlot'] = date('Y-m-d H:i');
write_json_file($stateFile, $state);

echo json_encode(['success' => true, 'results' => $results], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
