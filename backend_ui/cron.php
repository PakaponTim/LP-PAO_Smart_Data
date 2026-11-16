<?php
// =========================================================================
// Water_System2 — Web Cron Endpoint (http://server/Water_System2/cron.php)
// Can be called by cron-job.org, GitHub Actions, or browser to trigger
// immediate data collection & GitHub snapshot sync on the Server.
// =========================================================================

$phpServerDir = is_dir(__DIR__ . '/php_server') ? __DIR__ . '/php_server' : dirname(__DIR__) . '/php_server';
require_once $phpServerDir . '/config.php';
require_once $phpServerDir . '/collectors.php';
require_once $phpServerDir . '/github_sync_to_mysql.php';

@ignore_user_abort(true);
@set_time_limit(180);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$results = [
    'timestamp' => date('Y-m-d H:i:s'),
    'database'  => env_val('DB_NAME', 'water_system2'),
    'github_sync' => null,
    'collectors'  => []
];

try {
    $results['github_sync'] = sync_github_snapshots_to_mysql();
} catch (Throwable $e) {
    $results['github_sync'] = ['success' => false, 'error' => $e->getMessage()];
}

$cfg = get_app_config();
$active = $cfg['isScheduleActive'] ?? ['water' => true, 'drought' => true, 'pm25' => true, 'complaints' => true];

if (!empty($active['water'])) {
    try {
        $results['collectors']['water'] = collect_water_level_direct('db');
    } catch (Throwable $e) {
        $results['collectors']['water'] = ['success' => false, 'error' => $e->getMessage()];
    }
}

if (!empty($active['drought'])) {
    try {
        $results['collectors']['drought'] = collect_drought_direct('db');
    } catch (Throwable $e) {
        $results['collectors']['drought'] = ['success' => false, 'error' => $e->getMessage()];
    }
}

if (!empty($active['pm25'])) {
    try {
        $results['collectors']['pm25'] = collect_pm25_direct('db');
    } catch (Throwable $e) {
        $results['collectors']['pm25'] = ['success' => false, 'error' => $e->getMessage()];
    }
}

if (!empty($active['complaints'])) {
    try {
        $results['collectors']['complaints'] = collect_complaints_direct('db');
    } catch (Throwable $e) {
        $results['collectors']['complaints'] = ['success' => false, 'error' => $e->getMessage()];
    }
}

$stateFile = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'runtime_state.json';
$state = read_json_file($stateFile, []);
$state['lastAutoDirectCollect'] = time();
$state['lastGitHubSyncCheck'] = time();
write_json_file($stateFile, $state);

echo json_encode(['success' => true, 'results' => $results], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
