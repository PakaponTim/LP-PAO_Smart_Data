<?php
// =========================================================================
// Water_System2 — GitHub Actions Cloud Failover Alert Runner
// Runs on GitHub runner AFTER github_collect_snapshot.php.
//   - Zero MySQL dependency (safe in stateless GitHub Actions runner)
//   - If primary Server failed to respond (`--server-status=down`):
//       1) Notifies admins via LINE / Gmail SMTP (from GitHub Secrets)
//       2) Evaluates crisis thresholds from the fresh Cloud Snapshot so
//          critical floods/rain/drought/PM2.5 alerts are never delayed!
// =========================================================================

date_default_timezone_set('Asia/Bangkok');

require_once __DIR__ . '/notifier.php';

$options = getopt('', ['snapshot::', 'server-status::']);
$snapPath = trim((string)($options['snapshot'] ?? ''));
$serverStatus = strtolower(trim((string)($options['server-status'] ?? 'skipped')));
$dCfg = function_exists('get_domain_config') ? get_domain_config() : [];
$primaryDashUrl = !empty($dCfg['resolved']['primary']['active']) ? ($dCfg['resolved']['primary']['dashboard'] ?? '') : '';
$backupDashUrl  = !empty($dCfg['resolved']['backup']['active']) ? ($dCfg['resolved']['backup']['dashboard'] ?? '') : '';

if ($snapPath === '' || !file_exists($snapPath)) {
    $files = glob(dirname(__DIR__) . '/cloud_snapshots/*/snapshot_*.json') ?: [];
    sort($files);
    $snapPath = $files ? end($files) : '';
}

$snapshot = [];
if ($snapPath !== '' && file_exists($snapPath)) {
    $raw = @file_get_contents($snapPath);
    $dec = $raw ? json_decode($raw, true) : null;
    if (is_array($dec)) $snapshot = $dec;
}

echo "[Failover-Check] ServerStatus={$serverStatus} | Snapshot=" . ($snapPath ? basename($snapPath) : 'none') . "\n";

$isFailoverState = in_array($serverStatus, ['down', 'all_down', 'primary_down_backup_ok', 'backup_down'], true);
if (!$isFailoverState) {
    echo "[Failover-Check] Primary server is online (or WATER_SERVER_CRON_URL / domain_config.json not configured); skipping failover alert.\n";
    exit(0);
}

$statusHeadline = 'Server หลักไม่ตอบสนอง (อาจเกิดไฟดับ/เน็ตหลุด/Host ล่ม)';
if ($serverStatus === 'primary_down_backup_ok') {
    $statusHeadline = 'Domain หลักไม่ตอบสนอง — สลับใช้ Domain สำรอง (Backup Domain ทำงานปกติ ✅)';
} elseif ($serverStatus === 'backup_down') {
    $statusHeadline = 'Domain สำรองไม่ตอบสนอง (Domain หลักยังทำงานปกติ)';
} elseif ($serverStatus === 'all_down') {
    $statusHeadline = 'ทั้ง Domain หลักและสำรองไม่ตอบสนอง — GitHub Cloud Failover กำลังรับช่วงแทน';
}

// Evaluate crisis alerts directly from collected cloud snapshot
$crisisAlerts = [];
if (!empty($snapshot['water'])) {
    foreach ($snapshot['water'] as $w) {
        $st = (string)($w['status'] ?? '');
        $risk = (string)($w['risk_level'] ?? '');
        if ($risk === 'วิกฤต' || strpos($st, 'ล้นตลิ่ง') !== false || strpos($st, 'วิกฤต') !== false) {
            $crisisAlerts[] = [
                'level' => 'critical',
                'title' => "ระดับน้ำ: " . ($w['station_name'] ?? '-') . " (" . ($w['amphoe'] ?? 'ลำปาง') . ")",
                'triggerValue' => ($w['current_water_level_m'] ?? '-') . " ม. ({$st})",
            ];
        }
    }
}
if (!empty($snapshot['rainfall'])) {
    foreach ($snapshot['rainfall'] as $r) {
        $mm = (float)($r['rain_mm'] ?? 0);
        if ($mm > 90) {
            $crisisAlerts[] = [
                'level' => 'critical',
                'title' => "ฝนตกหนักมาก: " . ($r['station_name'] ?? '-'),
                'triggerValue' => number_format($mm, 1) . " มม.",
            ];
        }
    }
}
if (!empty($snapshot['drought'])) {
    foreach ($snapshot['drought'] as $d) {
        $pct = is_numeric($d['water_percent'] ?? null) ? (float)$d['water_percent'] : null;
        if ($pct !== null && ($pct <= 30 || $pct > 100)) {
            $crisisAlerts[] = [
                'level' => 'critical',
                'title' => ($pct > 100 ? 'น้ำล้นอ่างฯ: ' : 'แล้งวิกฤตอ่างฯ: ') . ($d['dam_name'] ?? '-'),
                'triggerValue' => number_format($pct, 1) . "%",
            ];
        }
    }
}
if (!empty($snapshot['pm25'])) {
    foreach ($snapshot['pm25'] as $p) {
        $val = is_numeric($p['pm25_value'] ?? null) ? (float)$p['pm25_value'] : null;
        if ($val !== null && $val >= 75.1) {
            $crisisAlerts[] = [
                'level' => 'critical',
                'title' => "PM2.5 วิกฤต: " . ($p['station_name'] ?? '-'),
                'triggerValue' => number_format($val, 1) . " µg/m³",
            ];
        }
    }
}

$snapTime = $snapshot['recorded_at'] ?? date('Y-m-d H:i:s');
$counts = [
    'water'      => count($snapshot['water'] ?? []),
    'rainfall'   => count($snapshot['rainfall'] ?? []),
    'drought'    => count($snapshot['drought'] ?? []),
    'pm25'       => count($snapshot['pm25'] ?? []),
    'complaints' => count($snapshot['complaints'] ?? []),
];

$lineToken = trim((string)getenv('LINE_CHANNEL_ACCESS_TOKEN'));
$lineGroup = trim((string)getenv('LINE_GROUP_ID'));

if ($lineToken !== '' && $lineGroup !== '') {
    $lines = [
        "⚠️ [Cloud Failover — Water_System2]",
        $statusHeadline,
        "☁️ GitHub Actions สำรองข้อมูลแทนแล้ว เวลา {$snapTime} น.",
        "📊 เก็บสำรองได้: น้ำ {$counts['water']} | ฝน {$counts['rainfall']} | อ่างฯ {$counts['drought']} | PM2.5 {$counts['pm25']} | Traffy {$counts['complaints']}",
    ];
    if ($backupDashUrl !== '') {
        $lines[] = "🔁 ลิงก์ Domain สำรอง: {$backupDashUrl}";
    }
    if (!empty($crisisAlerts)) {
        $lines[] = "🚨 พบเหตุวิกฤตระหว่าง Server ดับ (" . count($crisisAlerts) . " รายการ):";
        foreach (array_slice($crisisAlerts, 0, 8) as $ca) {
            $lines[] = "• {$ca['title']} => {$ca['triggerValue']}";
        }
    } else {
        $lines[] = "✅ ยังไม่พบเหตุวิกฤตเพิ่มเติมในรอบนี้";
    }
    $payload = json_encode(['to' => $lineGroup, 'messages' => [['type' => 'text', 'text' => mb_substr(implode("\n", $lines), 0, 4800)]]], JSON_UNESCAPED_UNICODE);
    $ch = curl_init('https://api.line.me/v2/bot/message/push');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_TIMEOUT        => 12,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json', "Authorization: Bearer {$lineToken}"]
    ]);
    @curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    echo "[Failover-Check] LINE failover push HTTP {$code}\n";
}

$smtpUser = trim((string)getenv('SMTP_USER'));
$smtpPass = trim((string)getenv('SMTP_PASS'));
$emailToRaw = trim((string)getenv('ALERT_EMAIL_TO'));
$toList = array_values(array_filter(array_map('trim', explode(',', $emailToRaw))));
if ($smtpUser !== '' && $smtpPass !== '' && !empty($toList)) {
    $crisisHtml = '';
    if (!empty($crisisAlerts)) {
        $crisisHtml = '<h4 style="color:#b91c1c">🚨 เหตุวิกฤตที่ตรวจพบจาก Cloud Snapshot (' . count($crisisAlerts) . ' รายการ)</h4><ul>';
        foreach (array_slice($crisisAlerts, 0, 15) as $ca) {
            $crisisHtml .= '<li><b>' . htmlspecialchars($ca['title']) . '</b>: ' . htmlspecialchars($ca['triggerValue']) . '</li>';
        }
        $crisisHtml .= '</ul>';
    }
    $backupHtml = $backupDashUrl !== '' ? "<p>🔁 <b>ลิงก์ Domain สำรอง:</b> <a href=\"" . htmlspecialchars($backupDashUrl) . "\">" . htmlspecialchars($backupDashUrl) . "</a></p>" : '';
    $html = "<div style=\"font-family:sans-serif;line-height:1.6\">"
        . "<h3 style=\"color:#b45309\">⚠️ Water_System2 Cloud Failover Alert</h3>"
        . "<p><b>" . htmlspecialchars($statusHeadline) . "</b></p>"
        . "<p>ระบบคลาวด์ได้ดึงข้อมูลสำรองลง GitHub Snapshot เวลา <b>{$snapTime} น.</b> เรียบร้อยแล้ว "
        . "(น้ำ {$counts['water']}, ฝน {$counts['rainfall']}, อ่างฯ {$counts['drought']}, PM2.5 {$counts['pm25']}, Traffy {$counts['complaints']})</p>"
        . $backupHtml
        . $crisisHtml
        . "<p style=\"color:#475569;font-size:12px\">ข้อมูลทั้งหมดจะถูกซิงก์กลับเข้า MySQL ทันทีเมื่อ Server หลักกลับมาออนไลน์ หรือสามารถเปิดดูฉุกเฉินผ่าน <code>emergency_cloud.html</code></p>"
        . "</div>";
    $mailRes = php_smtp_send_email(
        ['host' => 'smtp.gmail.com', 'port' => 587, 'user' => $smtpUser, 'pass' => $smtpPass],
        $toList,
        "⚠️ [Cloud Failover] Server หลักออฟไลน์ — GitHub เก็บข้อมูลสำรองให้แล้ว ({$snapTime})",
        $html
    );
    echo "[Failover-Check] Email failover result: " . ($mailRes['success'] ? 'SENT' : ($mailRes['error'] ?? 'FAILED')) . "\n";
}
