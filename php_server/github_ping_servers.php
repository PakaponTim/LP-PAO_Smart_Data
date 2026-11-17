<?php
// =========================================================================
// Water_System2 — Multi-Domain Cron Ping & Failover Probe for GitHub Actions
// Reads domain_config.json + optional GitHub Secrets (WATER_SERVER_CRON_URL,
// WATER_SERVER_BACKUP_CRON_URL), pings active Primary & Backup domains,
// and emits GitHub Actions outputs (`server_status`, `primary_url`, `backup_url`).
// =========================================================================

date_default_timezone_set('Asia/Bangkok');

require_once __DIR__ . '/config.php';

$dCfg = get_domain_config();
$secretPrimary = trim((string)getenv('WATER_SERVER_CRON_URL'));
$secretBackup  = trim((string)getenv('WATER_SERVER_BACKUP_CRON_URL'));

$primaryCron = $secretPrimary !== ''
    ? $secretPrimary
    : (!empty($dCfg['resolved']['primary']['active']) ? $dCfg['resolved']['primary']['cron'] : '');

$backupCron = '';
if ($secretBackup !== '') {
    $backupCron = $secretBackup;
} elseif (!empty($dCfg['failover_auto_ping_backup']) && !empty($dCfg['resolved']['backup']['active'])) {
    $backupCron = $dCfg['resolved']['backup']['cron'];
}

$targets = [];
if ($primaryCron !== '') $targets['primary'] = $primaryCron;
if ($backupCron !== '' && $backupCron !== $primaryCron) $targets['backup'] = $backupCron;

if (empty($targets)) {
    echo "[Ping-Servers] No live Primary or Backup domain configured (skipping server ping).\n";
    $statusOut = 'skipped';
    $results = [];
} else {
    $cronSecret = trim((string)(getenv('WATER_CRON_SECRET') ?: env_val('CRON_SECRET', '')));
    $results = [];
    foreach ($targets as $role => $url) {
        $t0 = microtime(true);
        $httpCode = 0;
        $err = '';
        $signedHeaders = ($cronSecret !== '') ? security_sign_cron_headers($url, $cronSecret) : [];
        for ($attempt = 1; $attempt <= 2; $attempt++) {
            $ch = curl_init($url);
            $opts = [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT        => 22,
                CURLOPT_CONNECTTIMEOUT => 10,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_SSL_VERIFYPEER => false,
                CURLOPT_SSL_VERIFYHOST => 0,
            ];
            if (!empty($signedHeaders)) {
                $opts[CURLOPT_HTTPHEADER] = $signedHeaders;
            }
            curl_setopt_array($ch, $opts);
            @curl_exec($ch);
            $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $err = curl_error($ch);
            curl_close($ch);
            if ($httpCode >= 200 && $httpCode < 400) break;
        }
        $durMs = (int)round((microtime(true) - $t0) * 1000);
        $ok = ($httpCode >= 200 && $httpCode < 400);
        $results[$role] = ['url' => $url, 'ok' => $ok, 'httpCode' => $httpCode, 'durationMs' => $durMs, 'error' => $err];
        echo sprintf("[Ping-Servers] %-7s => %s | HTTP %d (%dms) %s\n", strtoupper($role), $url, $httpCode, $durMs, $ok ? 'OK' : "DOWN ({$err})");
    }

    $pOk = isset($results['primary']) ? $results['primary']['ok'] : null;
    $bOk = isset($results['backup']) ? $results['backup']['ok'] : null;

    if ($pOk === true && ($bOk === null || $bOk === true)) {
        $statusOut = 'ok';
    } elseif ($pOk === false && $bOk === true) {
        $statusOut = 'primary_down_backup_ok';
    } elseif ($pOk === true && $bOk === false) {
        $statusOut = 'backup_down';
    } else {
        $statusOut = 'all_down';
    }
}

$ghOutFile = getenv('GITHUB_OUTPUT');
if ($ghOutFile && is_writable(dirname($ghOutFile))) {
    $lines = [
        "server_status={$statusOut}",
        "primary_url=" . ($dCfg['resolved']['primary']['dashboard'] ?? ''),
        "backup_url=" . ($dCfg['resolved']['backup']['dashboard'] ?? ''),
    ];
    file_put_contents($ghOutFile, implode("\n", $lines) . "\n", FILE_APPEND);
}

echo "[Ping-Servers] Overall status: {$statusOut}\n";
