<?php
// =========================================================================
// Water_System2 — Automated Crisis Notification Engine (PHP)
//   - Evaluates Water Level, Rainfall, Drought/Dams, PM 2.5, Complaints
//   - Deduplicates against tbl_alert_notifications + cooldown window
//   - Sends Digest HTML Email via Gmail SMTP (STARTTLS port 587 or SSL 465)
//   - Pushes real-time summary via LINE Messaging API (if configured)
//   - Logs every alert into tbl_alert_notifications + Socket.IO logs
// =========================================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/system_log.php';

const PHP_ALERT_THRESHOLDS = [
    'rainfall' => ['critical' => 90.0, 'warning' => 35.0],
    'drought'  => ['critical_low' => 30.0, 'warning_low' => 50.0, 'critical_high' => 100.0],
    'pm25'     => ['critical' => 75.1, 'warning' => 37.6],
];

const PHP_LEVEL_PRIORITY = ['info' => 1, 'warning' => 2, 'critical' => 3];

// =========================================================================
// 1. Threshold Evaluators (matching notification_module.js)
// =========================================================================

function php_evaluate_water_alerts(array $waterRows): array {
    $alerts = [];
    foreach ($waterRows as $row) {
        $stationName = $row['station_name'] ?? 'ไม่ทราบสถานี';
        $waterLevel = isset($row['current_water_level_m']) && is_numeric($row['current_water_level_m']) ? (float)$row['current_water_level_m'] : null;
        $leftBank   = isset($row['left_bank_level_m']) && is_numeric($row['left_bank_level_m']) ? (float)$row['left_bank_level_m'] : null;
        $bankDiff   = isset($row['bank_difference_m']) && is_numeric($row['bank_difference_m']) ? (float)$row['bank_difference_m'] : null;
        $status     = trim((string)($row['status'] ?? ''));

        if ($status === '' || $status === 'น้ำปกติ' || $status === 'น้ำน้อย' || $status === 'ไม่มีข้อมูล') {
            continue;
        }

        $diffText = ($waterLevel !== null ? $waterLevel : '-') . ' ม.รทก.';
        $hasValidBankInfo = ($leftBank !== null && $leftBank > 0 && $bankDiff !== null);
        if ($hasValidBankInfo) {
            if ($bankDiff < 0) $diffText = 'ล้นตลิ่ง';
            elseif ($bankDiff == 0.0) $diffText = 'ปริ่มตลิ่งพอดี';
            else $diffText = 'ต่ำกว่าตลิ่ง';
        }

        $isOverflowByDiff = $hasValidBankInfo && $bankDiff <= 0;
        $isCriticalStatus = (mb_strpos($status, 'ล้นตลิ่ง') !== false || mb_strpos($status, 'น้ำน้อยวิกฤต') !== false);

        if ($isCriticalStatus || $isOverflowByDiff) {
            $isLow = mb_strpos($status, 'น้ำน้อย') !== false;
            $wlStr = $waterLevel !== null ? (string)$waterLevel : '-';
            $alerts[] = [
                'type' => 'water',
                'level' => 'critical',
                'title' => $isLow ? "🚨 น้ำน้อยวิกฤต (≤10% ความจุลำน้ำ): {$stationName}" : "🚨 น้ำล้นตลิ่ง (>100% ความจุลำน้ำ): {$stationName}",
                'message' => "ระดับน้ำ {$wlStr} ม.รทก. (" . ($isLow ? 'น้ำน้อยวิกฤต' : 'ล้นตลิ่ง') . " - " . ($hasValidBankInfo ? "ต่ำกว่าตลิ่ง {$bankDiff} ม." : "ไม่มีข้อมูลระดับตลิ่ง") . ")",
                'triggerValue' => $isLow ? "🚨 น้ำน้อยวิกฤต ({$diffText})" : "🚨 น้ำล้นตลิ่ง ({$diffText})",
                'thresholdValue' => $isLow ? "≤10% ความจุลำน้ำ" : ">100% ความจุลำน้ำ",
                'stationName' => $stationName
            ];
        } elseif (mb_strpos($status, 'น้ำมาก') !== false || mb_strpos($status, 'เฝ้าระวัง') !== false || mb_strpos($status, 'เตือนภัย') !== false) {
            $wlStr = $waterLevel !== null ? (string)$waterLevel : '-';
            $alerts[] = [
                'type' => 'water',
                'level' => 'warning',
                'title' => "⚠️ น้ำมาก (>70-100% ความจุลำน้ำ): {$stationName}",
                'message' => "ระดับน้ำ {$wlStr} ม.รทก. (เกณฑ์น้ำมากเฝ้าระวัง - " . ($hasValidBankInfo ? "ต่ำกว่าตลิ่ง {$bankDiff} ม." : "ไม่มีข้อมูลระดับตลิ่ง") . ")",
                'triggerValue' => "⚠️ น้ำมากเฝ้าระวัง ({$diffText})",
                'thresholdValue' => ">70-100% ความจุลำน้ำ",
                'stationName' => $stationName
            ];
        }
    }
    return $alerts;
}

function php_evaluate_rainfall_alerts(array $rainfallRows): array {
    $alerts = [];
    foreach ($rainfallRows as $row) {
        $stationName = $row['station_name'] ?? 'ไม่ทราบสถานี';
        if (!isset($row['rain_mm']) || !is_numeric($row['rain_mm'])) continue;
        $rainMM = (float)$row['rain_mm'];

        if ($rainMM > PHP_ALERT_THRESHOLDS['rainfall']['critical']) {
            $fmt = number_format($rainMM, 1, '.', '');
            $alerts[] = [
                'type' => 'rainfall',
                'level' => 'critical',
                'title' => "🚨 ฝนตกหนักมาก: {$stationName}",
                'message' => "ปริมาณฝนสะสม {$fmt} มม. เกินเกณฑ์ฝนหนักมาก (>90 มม.)",
                'triggerValue' => "🚨 ฝนตกหนักมาก ({$fmt} มม.)",
                'thresholdValue' => "อันตราย / >90 มม.",
                'stationName' => $stationName
            ];
        } elseif ($rainMM > PHP_ALERT_THRESHOLDS['rainfall']['warning']) {
            $fmt = number_format($rainMM, 1, '.', '');
            $alerts[] = [
                'type' => 'rainfall',
                'level' => 'warning',
                'title' => "⚠️ ฝนตกหนัก: {$stationName}",
                'message' => "ปริมาณฝนสะสม {$fmt} มม. อยู่ในเกณฑ์ฝนหนัก (>35–90 มม.)",
                'triggerValue' => "⚠️ ฝนตกหนัก ({$fmt} มม.)",
                'thresholdValue' => "เฝ้าระวัง / >35 มม.",
                'stationName' => $stationName
            ];
        }
    }
    return $alerts;
}

function php_evaluate_drought_alerts(array $droughtRows): array {
    $alerts = [];
    foreach ($droughtRows as $row) {
        $damName = $row['dam_name'] ?? 'ไม่ทราบอ่าง';
        $pctRaw = str_replace('%', '', trim((string)($row['water_percent'] ?? '')));
        if (!is_numeric($pctRaw)) continue;
        $pct = (float)$pctRaw;

        if ($pct > PHP_ALERT_THRESHOLDS['drought']['critical_high']) {
            $alerts[] = [
                'type' => 'drought',
                'level' => 'critical',
                'title' => "🚨 น้ำเกินความจุ: {$damName}",
                'message' => "ปริมาตรน้ำกักเก็บ {$pct}% เกินความจุอ่าง (>100%) อาจเกิดน้ำล้นสันเขื่อน",
                'triggerValue' => "🚨 น้ำล้นสันเขื่อน (กักเก็บ {$pct}%)",
                'thresholdValue' => "เกินความจุ / >100%",
                'stationName' => $damName
            ];
        } elseif ($pct <= PHP_ALERT_THRESHOLDS['drought']['critical_low']) {
            $alerts[] = [
                'type' => 'drought',
                'level' => 'critical',
                'title' => "🚨 ภัยแล้งวิกฤต: {$damName}",
                'message' => "ปริมาตรน้ำกักเก็บเหลือเพียง {$pct}% ต่ำกว่าเกณฑ์วิกฤต (≤30%)",
                'triggerValue' => "🚨 น้ำกักเก็บน้อยวิกฤต (เหลือ {$pct}%)",
                'thresholdValue' => "แห้งวิกฤต / ≤30%",
                'stationName' => $damName
            ];
        } elseif ($pct <= PHP_ALERT_THRESHOLDS['drought']['warning_low']) {
            $alerts[] = [
                'type' => 'drought',
                'level' => 'warning',
                'title' => "⚠️ ภัยแล้งเฝ้าระวัง: {$damName}",
                'message' => "ปริมาตรน้ำกักเก็บ {$pct}% อยู่ในเกณฑ์เฝ้าระวัง (31–50%)",
                'triggerValue' => "⚠️ น้ำกักเก็บอยู่ในเกณฑ์ต่ำ (เหลือ {$pct}%)",
                'thresholdValue' => "เฝ้าระวัง / ≤50%",
                'stationName' => $damName
            ];
        }
    }
    return $alerts;
}

function php_evaluate_pm25_alerts(array $pm25Rows): array {
    $alerts = [];
    foreach ($pm25Rows as $row) {
        $stationName = $row['station_name'] ?? 'ไม่ทราบสถานี';
        $amphoe = trim((string)($row['amphoe'] ?? ''));
        $val = isset($row['pm25_value']) && is_numeric($row['pm25_value']) ? (float)$row['pm25_value'] : null;
        $avg = isset($row['pm25_avg_24h']) && is_numeric($row['pm25_avg_24h']) ? (float)$row['pm25_avg_24h'] : null;
        $pm25Val = $val !== null ? $val : $avg;
        if ($pm25Val === null) continue;

        $displayName = $amphoe !== '' ? "{$stationName} ({$amphoe})" : $stationName;
        $fmt = number_format($pm25Val, 1, '.', '');

        if ($pm25Val >= PHP_ALERT_THRESHOLDS['pm25']['critical']) {
            $alerts[] = [
                'type' => 'pm25',
                'level' => 'critical',
                'title' => "🚨 PM 2.5 มีผลกระทบต่อสุขภาพ: {$displayName}",
                'message' => "ค่า PM 2.5 = {$fmt} µg/m³ เกินเกณฑ์อันตราย (≥75.1 µg/m³) ที่ {$displayName}",
                'triggerValue' => "🚨 มีผลกระทบต่อสุขภาพ ({$fmt} µg/m³)",
                'thresholdValue' => "เกณฑ์อันตราย / ≥75.1 µg/m³",
                'stationName' => $displayName
            ];
        } elseif ($pm25Val >= PHP_ALERT_THRESHOLDS['pm25']['warning']) {
            $alerts[] = [
                'type' => 'pm25',
                'level' => 'warning',
                'title' => "⚠️ PM 2.5 เริ่มมีผลต่อสุขภาพ: {$displayName}",
                'message' => "ค่า PM 2.5 = {$fmt} µg/m³ อยู่ในเกณฑ์เฝ้าระวัง (37.6–75.0 µg/m³) ที่ {$displayName}",
                'triggerValue' => "⚠️ เริ่มมีผลต่อสุขภาพ ({$fmt} µg/m³)",
                'thresholdValue' => "เริ่มมีผล / ≥37.6 µg/m³",
                'stationName' => $displayName
            ];
        }
    }
    return $alerts;
}

function php_evaluate_complaint_alerts(array $complaintRows): array {
    $alerts = [];
    foreach ($complaintRows as $row) {
        $ticketId = $row['ticket_id'] ?? 'ไม่ทราบเลขรับแจ้ง';
        $stateName = trim((string)($row['state_name'] ?? 'รอรับเรื่อง'));
        $problemType = $row['problem_type'] ?? 'ทั่วไป';
        $orgName = trim((string)($row['org_name'] ?? 'ไม่มีหน่วยงานรับผิดชอบ'));
        if (mb_strlen($orgName) > 40) $orgName = mb_substr($orgName, 0, 40) . '...';
        $descRaw = trim((string)($row['description'] ?? ''));
        $desc = $descRaw !== '' ? (mb_strlen($descRaw) > 60 ? mb_substr($descRaw, 0, 60) . '...' : $descRaw) : 'ไม่มีรายละเอียด';

        $level = 'info';
        $titlePrefix = 'ℹ️ อัปเดตเรื่องร้องเรียน';
        if ($stateName === 'เสร็จสิ้น' || $stateName === 'ปิดงาน') {
            $level = 'info';
            $titlePrefix = '✅ แก้ไขเสร็จสิ้น';
        } elseif ($stateName === 'ติดตามเรื่อง') {
            $level = 'warning';
            $titlePrefix = '🔄 ส่งต่อ/ติดตามเรื่อง';
        } elseif ($stateName === 'รับเรื่อง') {
            $level = 'warning';
            $titlePrefix = '📢 รับเรื่องร้องเรียน';
        } else {
            $level = 'critical';
            $titlePrefix = '🚨 เรื่องร้องเรียนใหม่';
        }

        $alerts[] = [
            'type' => 'complaints',
            'level' => $level,
            'title' => "{$titlePrefix}: {$problemType}",
            'message' => "เลขที่: {$ticketId}<br>สถานะ: {$stateName}<br>หน่วยงาน: {$orgName}<br>รายละเอียด: {$desc}",
            'triggerValue' => "{$stateName}|{$orgName}",
            'thresholdValue' => "แจ้งเตือนเมื่อเปลี่ยนสถานะ/ส่งต่อ",
            'stationName' => $ticketId
        ];
    }
    return $alerts;
}

// =========================================================================
// 2. DB-Backed Deduplication & Cooldown
// =========================================================================

function php_is_alert_duplicate(PDO $pdo, array $alert, int $cooldownMinutes): bool {
    $stationName = $alert['stationName'] ?? 'none';
    $stmt = $pdo->prepare(
        "SELECT trigger_value, alert_level, created_at
         FROM tbl_alert_notifications
         WHERE alert_type = ? AND station_name = ? AND email_status = 'sent'
         ORDER BY created_at DESC LIMIT 1"
    );
    $stmt->execute([$alert['type'], $stationName]);
    $last = $stmt->fetch();
    if (!$last) return false;

    if ($alert['type'] === 'drought' || $alert['type'] === 'complaints') {
        if ($last['trigger_value'] === $alert['triggerValue'] && $last['alert_level'] === $alert['level']) {
            return true;
        }
    }

    $lastTs = strtotime((string)$last['created_at']);
    $diffSec = $lastTs ? (time() - $lastTs) : 999999;
    if ($diffSec < ($cooldownMinutes * 60) && $last['trigger_value'] === $alert['triggerValue']) {
        return true;
    }

    return false;
}

// =========================================================================
// 3. Official Lampang PAO Digest HTML Email Builder
// =========================================================================

function php_build_digest_email_html(array $alerts): string {
    $criticals = array_values(array_filter($alerts, function ($a) { return $a['level'] === 'critical'; }));
    $warnings  = array_values(array_filter($alerts, function ($a) { return $a['level'] === 'warning'; }));

    $hasCritical = count($criticals) > 0;
    $headerGradient = $hasCritical
        ? 'linear-gradient(135deg, #064e3b 0%, #047857 50%, #065f46 100%)'
        : 'linear-gradient(135deg, #065f46 0%, #059669 50%, #047857 100%)';
    $badgeBg = $hasCritical ? '#be123c' : '#d97706';
    $badgeText = $hasCritical ? '🚨 สรุปสถานการณ์วิกฤต (CRITICAL)' : '⚠️ สรุปสถานการณ์เฝ้าระวัง (WARNING)';
    $thaiDate = format_thai_date() . ' ' . date('H:i') . ' น.';

    $grouped = [
        'water'      => array_values(array_filter($alerts, function ($a) { return $a['type'] === 'water' || $a['type'] === 'rainfall'; })),
        'drought'    => array_values(array_filter($alerts, function ($a) { return $a['type'] === 'drought'; })),
        'pm25'       => array_values(array_filter($alerts, function ($a) { return $a['type'] === 'pm25'; })),
        'complaints' => array_values(array_filter($alerts, function ($a) { return $a['type'] === 'complaints'; })),
    ];

    $groupConfigs = [
        'water'      => ['title' => '🌊 ระดับน้ำและปริมาณน้ำฝน', 'bg' => '#eff6ff', 'border' => '#bfdbfe', 'text' => '#1e40af'],
        'drought'    => ['title' => '🏜️ สถานการณ์น้ำในอ่างเก็บน้ำ (ภัยแล้ง)', 'bg' => '#fff7ed', 'border' => '#fed7aa', 'text' => '#c2410c'],
        'pm25'       => ['title' => '💨 คุณภาพอากาศ (PM 2.5)', 'bg' => '#f0fdf4', 'border' => '#bbf7d0', 'text' => '#15803d'],
        'complaints' => ['title' => '📢 การจัดการเรื่องร้องเรียน', 'bg' => '#faf5ff', 'border' => '#e9d5ff', 'text' => '#7e22ce'],
    ];

    $renderGroup = function (array $items, array $config): string {
        if (empty($items)) return '';
        $rowsHtml = '';
        foreach ($items as $idx => $item) {
            $isCrit = $item['level'] === 'critical';
            $stColor = $isCrit ? '#be123c' : '#d97706';
            $stBg = $isCrit ? '#ffe4e6' : '#fef3c7';
            $stLabel = $isCrit ? '🚨 วิกฤต' : '⚠️ เฝ้าระวัง';
            $rowBg = ($idx % 2 === 0) ? '#ffffff' : '#f8fafc';
            $titleEsc = htmlspecialchars((string)($item['stationName'] ?? $item['title']), ENT_QUOTES, 'UTF-8');
            $msgHtml = (string)($item['message'] ?? $item['title']);
            $trig = htmlspecialchars((string)($item['triggerValue'] ?? '-'), ENT_QUOTES, 'UTF-8');

            $rowsHtml .= "
            <tr style=\"background:{$rowBg};border-bottom:1px solid #f1f5f9;\">
              <td style=\"padding:12px 16px;font-size:13px;color:#1e293b;vertical-align:middle;\">
                <strong style=\"color:#0f172a;font-size:14px;\">{$titleEsc}</strong>
                <div style=\"font-size:12px;color:#64748b;margin-top:2px;\">{$msgHtml}</div>
              </td>
              <td style=\"padding:12px 12px;font-size:12px;text-align:center;vertical-align:middle;\">
                <span style=\"display:inline-block;background:{$stBg};color:{$stColor};padding:4px 10px;border-radius:12px;font-weight:bold;\">{$stLabel}</span>
              </td>
              <td style=\"padding:12px 14px;font-size:13px;font-weight:bold;color:{$stColor};text-align:center;vertical-align:middle;\">
                {$trig}
              </td>
            </tr>";
        }
        $cnt = count($items);
        return "
        <div style=\"margin-bottom:24px;border:1px solid {$config['border']};border-radius:14px;overflow:hidden;\">
          <div style=\"background:{$config['bg']};padding:12px 18px;border-bottom:1px solid {$config['border']};\">
            <h3 style=\"margin:0;font-size:14px;font-weight:bold;color:{$config['text']};\">{$config['title']} ({$cnt} รายการ)</h3>
          </div>
          <table style=\"width:100%;border-collapse:collapse;\">
            <thead>
              <tr style=\"background:#f1f5f9;color:#475569;font-size:11px;text-transform:uppercase;\">
                <th style=\"padding:10px 16px;text-align:left;\">สถานี / รายการตรวจวัด</th>
                <th style=\"padding:10px 10px;text-align:center;width:90px;\">ระดับเตือน</th>
                <th style=\"padding:10px 14px;text-align:center;\">ผลการตรวจวัด</th>
              </tr>
            </thead>
            <tbody>{$rowsHtml}</tbody>
          </table>
        </div>";
    };

    $tablesHtml = '';
    foreach ($groupConfigs as $gKey => $gCfg) {
        $tablesHtml .= $renderGroup($grouped[$gKey], $gCfg);
    }

    $totalCnt = count($alerts);
    $critCnt = count($criticals);
    $warnCnt = count($warnings);

    return "<!DOCTYPE html>
<html lang=\"th\">
<head><meta charset=\"UTF-8\"></head>
<body style=\"margin:0;padding:0;font-family:'Segoe UI',Sarabun,Tahoma,sans-serif;background:#ecfdf5;color:#1e293b;\">
  <div style=\"max-width:720px;margin:24px auto;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #a7f3d0;\">
    <div style=\"background:{$headerGradient};padding:28px 32px;text-align:center;color:#ffffff;\">
      <h2 style=\"margin:0 0 4px 0;font-size:13px;font-weight:600;letter-spacing:1px;color:#a7f3d0;\">องค์การบริหารส่วนจังหวัดลำปาง</h2>
      <h1 style=\"margin:0 0 8px 0;font-size:22px;font-weight:bold;color:#ffffff;\">ศูนย์บริหารจัดการน้ำและระบบเตือนภัยบูรณาการ</h1>
      <p style=\"margin:0;font-size:13px;color:#d1fae5;\">รายงานสรุปสถานการณ์วิกฤตและเฝ้าระวังอัตโนมัติ</p>
    </div>
    <div style=\"background:#f0fdf4;padding:12px 32px;border-bottom:1px solid #d1fae5;\">
      <span style=\"background:{$badgeBg};color:#ffffff;padding:6px 16px;border-radius:20px;font-size:12px;font-weight:bold;\">{$badgeText}</span>
      <span style=\"font-size:12px;color:#047857;font-weight:600;margin-left:12px;\">📅 ข้อมูล ณ วันที่: <strong>{$thaiDate}</strong></span>
    </div>
    <div style=\"padding:24px 32px 16px;\">
      <table style=\"width:100%;border-collapse:collapse;\">
        <tr>
          <td style=\"width:33%;padding:4px;\"><div style=\"background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;text-align:center;\"><span style=\"font-size:11px;color:#64748b;font-weight:bold;display:block;\">เหตุการณ์ทั้งหมด</span><span style=\"font-size:26px;font-weight:800;color:#0f172a;\">{$totalCnt}</span></div></td>
          <td style=\"width:33%;padding:4px;\"><div style=\"background:#fff1f2;border:1px solid #fecdd3;border-radius:12px;padding:14px;text-align:center;\"><span style=\"font-size:11px;color:#be123c;font-weight:bold;display:block;\">🚨 ระดับวิกฤต</span><span style=\"font-size:26px;font-weight:800;color:#be123c;\">{$critCnt}</span></div></td>
          <td style=\"width:33%;padding:4px;\"><div style=\"background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:14px;text-align:center;\"><span style=\"font-size:11px;color:#b45309;font-weight:bold;display:block;\">⚠️ ระดับเฝ้าระวัง</span><span style=\"font-size:26px;font-weight:800;color:#d97706;\">{$warnCnt}</span></div></td>
        </tr>
      </table>
    </div>
    <div style=\"padding:0 32px 8px;\">{$tablesHtml}</div>
    <div style=\"background:#f1f5f9;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center;\">
      <p style=\"color:#475569;font-size:12px;font-weight:bold;margin:0 0 4px 0;\">ศูนย์บริการสารสนเทศบูรณาการ องค์การบริหารส่วนจังหวัดลำปาง</p>
      <p style=\"color:#94a3b8;font-size:11px;margin:0;\">อีเมลฉบับนี้ส่งโดยระบบแจ้งเตือนวิกฤตอัตโนมัติ (Water_System2)</p>
    </div>
  </div>
</body>
</html>";
}

// =========================================================================
// 4. Native PHP Gmail SMTP Sender (STARTTLS Port 587 / SSL Port 465)
// =========================================================================

function smtp_read_response($fp): array {
    $lines = [];
    $code = 0;
    while (!feof($fp)) {
        $line = fgets($fp, 515);
        if ($line === false) break;
        $lines[] = trim($line);
        if (preg_match('/^(\d{3})([ -])/', $line, $m)) {
            $code = (int)$m[1];
            if ($m[2] === ' ') break;
        } else {
            break;
        }
    }
    return [$code, implode("\n", $lines)];
}

function smtp_command($fp, string $cmd, array $expectedCodes): string {
    fwrite($fp, $cmd . "\r\n");
    [$code, $resp] = smtp_read_response($fp);
    if (!in_array($code, $expectedCodes, true)) {
        throw new RuntimeException("SMTP error after '{$cmd}': {$resp}");
    }
    return $resp;
}

function php_smtp_send_email(array $smtpConfig, array $toEmails, string $subject, string $htmlBody, array $attachments = []): array {
    $user = trim((string)($smtpConfig['user'] ?? ''));
    $pass = preg_replace('/\s+/', '', (string)($smtpConfig['pass'] ?? ''));
    $host = trim((string)($smtpConfig['host'] ?? 'smtp.gmail.com')) ?: 'smtp.gmail.com';
    $port = (int)($smtpConfig['port'] ?? 587) ?: 587;

    if ($user === '' || $pass === '') {
        return ['success' => false, 'error' => 'ยังไม่ได้ตั้งค่า Gmail User หรือ App Password'];
    }
    if (empty($toEmails)) {
        return ['success' => false, 'error' => 'ไม่มีอีเมลผู้รับ'];
    }

    $transportHost = ($port === 465) ? "ssl://{$host}" : "tcp://{$host}";
    $ctx = stream_context_create([
        'ssl' => [
            'verify_peer' => false,
            'verify_peer_name' => false,
            'allow_self_signed' => true
        ]
    ]);

    $fp = @stream_socket_client("{$transportHost}:{$port}", $errno, $errstr, 20, STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) {
        return ['success' => false, 'error' => "เชื่อมต่อ SMTP {$host}:{$port} ไม่ได้ ({$errstr})"];
    }
    stream_set_timeout($fp, 25);

    try {
        [$code, $resp] = smtp_read_response($fp);
        if ($code !== 220) {
            throw new RuntimeException("SMTP greeting error: {$resp}");
        }

        smtp_command($fp, "EHLO water-system2.local", [250]);

        if ($port !== 465) {
            smtp_command($fp, "STARTTLS", [220]);
            $cryptoOk = @stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_1_CLIENT | STREAM_CRYPTO_METHOD_TLS_CLIENT);
            if (!$cryptoOk) {
                throw new RuntimeException('ไม่สามารถเปิดการเข้ารหัส TLS (STARTTLS) ได้');
            }
            smtp_command($fp, "EHLO water-system2.local", [250]);
        }

        smtp_command($fp, "AUTH LOGIN", [334]);
        smtp_command($fp, base64_encode($user), [334]);
        smtp_command($fp, base64_encode($pass), [235]);

        smtp_command($fp, "MAIL FROM:<{$user}>", [250]);
        $toHeaderList = [];
        foreach ($toEmails as $rcp) {
            $emailAddr = is_array($rcp) ? trim((string)$rcp['email']) : trim((string)$rcp);
            $rcpName = is_array($rcp) ? trim((string)($rcp['name'] ?? '')) : '';
            if (!filter_var($emailAddr, FILTER_VALIDATE_EMAIL)) continue;
            smtp_command($fp, "RCPT TO:<{$emailAddr}>", [250, 251]);
            $toHeaderList[] = $rcpName !== ''
                ? "=?UTF-8?B?" . base64_encode($rcpName) . "?= <{$emailAddr}>"
                : "<{$emailAddr}>";
        }

        if (empty($toHeaderList)) {
            throw new RuntimeException('ไม่พบอีเมลผู้รับที่ถูกต้อง');
        }

        smtp_command($fp, "DATA", [354]);

        $encodedFromName = "=?UTF-8?B?" . base64_encode("ระบบแจ้งเตือนวิกฤต อบจ.ลำปาง") . "?=";
        $encodedSubject  = "=?UTF-8?B?" . base64_encode($subject) . "?=";

        $headers  = "Date: " . date('r') . "\r\n";
        $headers .= "From: {$encodedFromName} <{$user}>\r\n";
        $headers .= "To: " . implode(', ', $toHeaderList) . "\r\n";
        $headers .= "Subject: {$encodedSubject}\r\n";
        $headers .= "MIME-Version: 1.0\r\n";

        $validAtt = [];
        foreach ($attachments as $att) {
            if (!empty($att['filename']) && isset($att['content'])) {
                $validAtt[] = $att;
            }
        }

        if (empty($validAtt)) {
            $headers .= "Content-Type: text/html; charset=UTF-8\r\n";
            $headers .= "Content-Transfer-Encoding: base64\r\n";
            $mimeBody = chunk_split(base64_encode($htmlBody));
        } else {
            $boundary = 'ws2_mix_' . bin2hex(random_bytes(8));
            $headers .= "Content-Type: multipart/mixed; boundary=\"{$boundary}\"\r\n";
            $mimeBody  = "--{$boundary}\r\n";
            $mimeBody .= "Content-Type: text/html; charset=UTF-8\r\n";
            $mimeBody .= "Content-Transfer-Encoding: base64\r\n\r\n";
            $mimeBody .= chunk_split(base64_encode($htmlBody)) . "\r\n";
            foreach ($validAtt as $att) {
                $fname = preg_replace('/[^a-zA-Z0-9._-]/', '_', (string)$att['filename']);
                $mime  = (string)($att['mime'] ?? 'application/octet-stream');
                $mimeBody .= "--{$boundary}\r\n";
                $mimeBody .= "Content-Type: {$mime}; name=\"{$fname}\"\r\n";
                $mimeBody .= "Content-Transfer-Encoding: base64\r\n";
                $mimeBody .= "Content-Disposition: attachment; filename=\"{$fname}\"\r\n\r\n";
                $mimeBody .= chunk_split(base64_encode((string)$att['content'])) . "\r\n";
            }
            $mimeBody .= "--{$boundary}--\r\n";
        }

        // Dot-stuff lines starting with "." per RFC 5321
        $mimeBody = preg_replace('/^\./m', '..', $mimeBody);
        $fullData = $headers . "\r\n" . $mimeBody . "\r\n.";
        fwrite($fp, $fullData . "\r\n");

        [$dataCode, $dataResp] = smtp_read_response($fp);
        if ($dataCode !== 250) {
            throw new RuntimeException("SMTP DATA rejected: {$dataResp}");
        }

        @fwrite($fp, "QUIT\r\n");
        fclose($fp);
        return ['success' => true, 'error' => null];
    } catch (Throwable $e) {
        @fclose($fp);
        return ['success' => false, 'error' => $e->getMessage()];
    }
}

// =========================================================================
// 5. LINE Messaging API Real-Time Push (when LINE token & target are set)
// =========================================================================

function php_line_send_push(array $alerts, array $lineCfg): array {
    $token = trim((string)($lineCfg['channelToken'] ?? ''));
    $targetId = trim((string)($lineCfg['targetId'] ?? ''));
    if ($token === '' || $targetId === '') {
        return ['sent' => false, 'skipped' => true, 'reason' => 'no_line_config'];
    }

    $criticals = array_values(array_filter($alerts, function ($a) { return $a['level'] === 'critical'; }));
    $warnings  = array_values(array_filter($alerts, function ($a) { return $a['level'] === 'warning'; }));

    $lines = [];
    $lines[] = "🔔 [Water_System2 อบจ.ลำปาง]";
    $lines[] = "แจ้งเตือนสถานการณ์วิกฤต/เฝ้าระวัง";
    $lines[] = "📅 " . format_thai_date() . " " . date('H:i') . " น.";
    $lines[] = "🚨 วิกฤต: " . count($criticals) . " | ⚠️ เฝ้าระวัง: " . count($warnings);
    $lines[] = "--------------------";

    $shown = 0;
    foreach (array_merge($criticals, $warnings) as $a) {
        if ($shown >= 12) {
            $rem = count($alerts) - $shown;
            $lines[] = "...และอีก {$rem} รายการ (ดูรายละเอียดทั้งหมดใน E-mail / Dashboard)";
            break;
        }
        $lines[] = "• " . ($a['title'] ?? $a['stationName']) . " => " . ($a['triggerValue'] ?? '');
        $shown++;
    }

    $payload = json_encode([
        'to' => $targetId,
        'messages' => [
            ['type' => 'text', 'text' => mb_substr(implode("\n", $lines), 0, 4800)]
        ]
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init('https://api.line.me/v2/bot/message/push');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_TIMEOUT => 12,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            "Authorization: Bearer {$token}"
        ]
    ]);
    $resBody = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return ['sent' => ($code >= 200 && $code < 300), 'httpCode' => $code, 'response' => $resBody];
}

// =========================================================================
// 6. Main Entry: Check & Notify + Save to tbl_alert_notifications
// =========================================================================

function php_check_and_notify(bool $forceSend = false, ?string $triggerSource = null, ?string $scheduledSlot = null): array {
    $notifStart = microtime(true);
    $notifStartedAt = date('Y-m-d H:i:s');
    $effTrigger = $triggerSource ?: ($forceSend ? 'manual' : 'smart_sleep');
    $cfg = get_app_config();
    $notifCfg = $cfg['notifications'] ?? [];
    if (empty($notifCfg['enabled'])) {
        return ['totalAlerts' => 0, 'sentEmails' => 0, 'skipped' => 0, 'errors' => 0, 'message' => 'ระบบแจ้งเตือนปิดอยู่'];
    }

    $pdo = get_db();
    $alertActive = $notifCfg['alertActive'] ?? [];
    $cooldownMin = (int)($notifCfg['cooldownMinutes'] ?? 120);
    $smtpCfg = $notifCfg['smtp'] ?? [];
    $lineCfg = $notifCfg['line'] ?? [];

    $recipients = $pdo->query("SELECT * FROM tbl_alert_recipients WHERE is_active = 1")->fetchAll();
    if (empty($recipients)) {
        add_server_log('Notification', '⚠️ ไม่มีผู้รับการแจ้งเตือนที่เปิดใช้งาน');
        sys_log_record([
            'module'         => 'notification',
            'action'         => 'Check & Send Alerts',
            'status'         => 'warning',
            'trigger_source' => $effTrigger,
            'scheduled_slot' => $scheduledSlot,
            'started_at'     => $notifStartedAt,
            'duration_ms'    => (int)round((microtime(true) - $notifStart) * 1000),
            'row_count'      => 0,
            'summary'        => 'ไม่มีผู้รับการแจ้งเตือนที่เปิดใช้งาน (กรุณาเพิ่มอีเมลในระบบแจ้งเตือน)',
        ]);
        return ['totalAlerts' => 0, 'sentEmails' => 0, 'skipped' => 0, 'errors' => 0];
    }

    $allAlerts = [];

    // 1. Water Level
    if (($alertActive['water'] ?? true) !== false) {
        try {
            $waterRows = $pdo->query("
                SELECT w.station_name, w.current_water_level_m, w.left_bank_level_m, w.bank_difference_m, w.status
                FROM tbl_water_disaster_monitoring w
                INNER JOIN (
                    SELECT station_name, MAX(recorded_at) as max_rec
                    FROM tbl_water_disaster_monitoring
                    GROUP BY station_name
                ) latest ON w.station_name = latest.station_name AND w.recorded_at = latest.max_rec
            ")->fetchAll();
            $allAlerts = array_merge($allAlerts, php_evaluate_water_alerts($waterRows));
        } catch (Throwable $e) {
            add_server_log('Notification', '⚠️ ตรวจเกณฑ์ระดับน้ำล้มเหลว: ' . $e->getMessage());
        }
    }

    // 2. Rainfall
    if (($alertActive['rainfall'] ?? true) !== false) {
        try {
            $rainRows = $pdo->query("
                SELECT r.station_name, r.rain_mm
                FROM tbl_rainfall_monitoring r
                INNER JOIN (
                    SELECT station_name, MAX(recorded_at) as max_rec
                    FROM tbl_rainfall_monitoring
                    GROUP BY station_name
                ) latest ON r.station_name = latest.station_name AND r.recorded_at = latest.max_rec
            ")->fetchAll();
            $allAlerts = array_merge($allAlerts, php_evaluate_rainfall_alerts($rainRows));
        } catch (Throwable $e) {}
    }

    // 3. Drought
    if (($alertActive['drought'] ?? true) !== false) {
        try {
            $droughtRows = $pdo->query("
                SELECT d.dam_name, d.water_percent
                FROM tbl_drought_monitoring d
                INNER JOIN (
                    SELECT dam_name, MAX(recorded_at) as max_rec
                    FROM tbl_drought_monitoring
                    GROUP BY dam_name
                ) latest ON d.dam_name = latest.dam_name AND d.recorded_at = latest.max_rec
            ")->fetchAll();
            $allAlerts = array_merge($allAlerts, php_evaluate_drought_alerts($droughtRows));
        } catch (Throwable $e) {}
    }

    // 4. PM 2.5
    if (($alertActive['pm25'] ?? true) !== false) {
        try {
            $pmRows = $pdo->query("
                SELECT p.station_name, p.amphoe, p.pm25_value, p.pm25_avg_24h
                FROM tbl_pm25_monitoring p
                INNER JOIN (
                    SELECT station_name, MAX(recorded_at) as max_rec
                    FROM tbl_pm25_monitoring
                    GROUP BY station_name
                ) latest ON p.station_name = latest.station_name AND p.recorded_at = latest.max_rec
            ")->fetchAll();
            $allAlerts = array_merge($allAlerts, php_evaluate_pm25_alerts($pmRows));
        } catch (Throwable $e) {}
    }

    // 5. Complaints (last 2 days)
    if (($alertActive['complaints'] ?? true) !== false) {
        try {
            $compRows = $pdo->query("
                SELECT c.ticket_id, c.state_name, c.problem_type, c.org_name, c.description, c.recorded_at
                FROM tbl_complaints_monitoring c
                INNER JOIN (
                    SELECT ticket_id, MAX(id) as max_id
                    FROM tbl_complaints_monitoring
                    WHERE recorded_at >= DATE_SUB(NOW(), INTERVAL 2 DAY)
                    GROUP BY ticket_id
                ) latest ON c.id = latest.max_id
            ")->fetchAll();
            $allAlerts = array_merge($allAlerts, php_evaluate_complaint_alerts($compRows));
        } catch (Throwable $e) {}
    }

    if (empty($allAlerts)) {
        add_server_log('Notification', '✅ ตรวจสอบแล้ว — ไม่มีค่าใดเกินเกณฑ์แจ้งเตือน');
        if ($forceSend) {
            sys_log_record([
                'module'         => 'notification',
                'action'         => 'Check Alert Thresholds',
                'status'         => 'success',
                'trigger_source' => 'manual',
                'started_at'     => $notifStartedAt,
                'duration_ms'    => (int)round((microtime(true) - $notifStart) * 1000),
                'row_count'      => 0,
                'summary'        => 'ตรวจสอบเกณฑ์แจ้งเตือนแล้ว — ไม่พบค่าวิกฤตหรือค่าเฝ้าระวังเกินเกณฑ์',
            ]);
        }
        return ['totalAlerts' => 0, 'sentEmails' => 0, 'skipped' => 0, 'errors' => 0];
    }

    $skipped = 0;
    $validAlerts = [];
    foreach ($allAlerts as $alert) {
        $isDup = $forceSend ? false : php_is_alert_duplicate($pdo, $alert, $cooldownMin);
        if ($isDup) {
            $skipped++;
        } else {
            $validAlerts[] = $alert;
        }
    }

    if (empty($validAlerts)) {
        add_server_log('Notification', "ℹ️ ตรวจพบ " . count($allAlerts) . " รายการ แต่ไม่มีการเปลี่ยนแปลงจากรอบก่อน (ข้ามทั้งหมด {$skipped} รายการ)");
        if ($forceSend) {
            sys_log_record([
                'module'         => 'notification',
                'action'         => 'Check Alert Thresholds',
                'status'         => 'success',
                'trigger_source' => 'manual',
                'started_at'     => $notifStartedAt,
                'duration_ms'    => (int)round((microtime(true) - $notifStart) * 1000),
                'row_count'      => count($allAlerts),
                'summary'        => "ตรวจพบ " . count($allAlerts) . " รายการ แต่อยู่ในช่วง Cooldown/ไม่มีการเปลี่ยนแปลง (ข้าม {$skipped} รายการ)",
            ]);
        }
        return ['totalAlerts' => count($allAlerts), 'sentEmails' => 0, 'skipped' => $skipped, 'errors' => 0];
    }

    add_server_log('Notification', "🔔 พบ " . count($validAlerts) . " เหตุการณ์ใหม่/เปลี่ยนแปลง — กำลังส่งแจ้งเตือน Gmail SMTP" . (!empty($lineCfg['channelToken']) ? " + LINE" : "") . "...");

    $typeFieldMap = [
        'water' => 'notify_water',
        'rainfall' => 'notify_water',
        'drought' => 'notify_drought',
        'pm25' => 'notify_pm25',
        'complaints' => 'notify_complaints'
    ];

    $sentRecipients = [];
    $lastError = null;

    foreach ($recipients as $rcp) {
        $recAlerts = array_values(array_filter($validAlerts, function ($alert) use ($rcp, $typeFieldMap) {
            $field = $typeFieldMap[$alert['type']] ?? 'notify_water';
            if (empty($rcp[$field])) return false;
            $prioAlert = PHP_LEVEL_PRIORITY[strtolower((string)($alert['level'] ?? 'info'))] ?? 1;
            $prioMin   = PHP_LEVEL_PRIORITY[strtolower((string)($rcp['alert_level_min'] ?? 'info'))] ?? 1;
            return $prioAlert >= $prioMin;
        }));

        if (empty($recAlerts)) continue;

        $hasCrit = false;
        foreach ($recAlerts as $a) {
            if ($a['level'] === 'critical') { $hasCrit = true; break; }
        }
        $cnt = count($recAlerts);
        $subject = $hasCrit
            ? "🚨 [แจ้งเตือนวิกฤต] พบ {$cnt} เหตุการณ์สำคัญ — อบจ.ลำปาง"
            : "⚠️ [รายงานเฝ้าระวัง] พบ {$cnt} เหตุการณ์สำคัญ — อบจ.ลำปาง";

        $html = php_build_digest_email_html($recAlerts);
        $sendRes = php_smtp_send_email($smtpCfg, [['name' => $rcp['name'], 'email' => $rcp['email']]], $subject, $html);

        if ($sendRes['success']) {
            $sentRecipients[] = "{$rcp['name']} <{$rcp['email']}>";
        } else {
            $lastError = $sendRes['error'];
        }
    }

    // Also send LINE push if configured
    $lineSent = false;
    if (!empty($lineCfg['channelToken']) && !empty($lineCfg['targetId'])) {
        $lineRes = php_line_send_push($validAlerts, $lineCfg);
        $lineSent = !empty($lineRes['sent']);
        if ($lineSent) {
            add_server_log('Notification', '💬 ส่งแจ้งเตือนเข้า LINE สำเร็จ (' . count($validAlerts) . ' รายการ)');
        }
    }

    $emailSentOk = !empty($sentRecipients);
    $recListStr = implode(', ', $sentRecipients);
    $statusStr = $emailSentOk ? 'sent' : 'failed';

    $insStmt = $pdo->prepare(
        "INSERT INTO tbl_alert_notifications
         (alert_type, alert_level, alert_title, alert_message, trigger_value, threshold_value, station_name, recipients_sent, email_status, email_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );

    foreach ($validAlerts as $a) {
        try {
            $insStmt->execute([
                $a['type'],
                $a['level'],
                $a['title'],
                $a['message'],
                $a['triggerValue'] ?? null,
                $a['thresholdValue'] ?? null,
                $a['stationName'] ?? null,
                $recListStr,
                $statusStr,
                $emailSentOk ? null : ($lastError ?: 'ส่งไม่สำเร็จ')
            ]);
        } catch (Throwable $e) {
            // Keep logging remaining alerts
        }
    }

    $durMs = (int)round((microtime(true) - $notifStart) * 1000);
    if ($emailSentOk) {
        add_server_log('Notification', "📧 ส่งรายงานสรุป Digest Email สำเร็จ (" . count($validAlerts) . " รายการ) → " . count($sentRecipients) . " คน");
        sys_log_record([
            'module'         => 'notification',
            'action'         => 'Send Digest Alert',
            'status'         => 'success',
            'trigger_source' => $effTrigger,
            'scheduled_slot' => $scheduledSlot,
            'started_at'     => $notifStartedAt,
            'duration_ms'    => $durMs,
            'row_count'      => count($validAlerts),
            'summary'        => "ส่งแจ้งเตือน Digest Email สำเร็จ " . count($validAlerts) . " รายการ → ผู้รับ " . count($sentRecipients) . " คน" . ($lineSent ? ' (+LINE Push)' : ''),
            'meta'           => ['totalAlerts' => count($allAlerts), 'validAlerts' => count($validAlerts), 'sentEmails' => count($sentRecipients), 'lineSent' => $lineSent, 'skipped' => $skipped],
        ]);
    } else {
        add_server_log('Notification', "⚠️ ส่ง Email แจ้งเตือนไม่สำเร็จ: " . ($lastError ?: 'ตรวจสอบ SMTP หรือรายชื่อผู้รับ'));
        sys_log_record([
            'module'         => 'notification',
            'action'         => 'Send Digest Alert',
            'status'         => ($lineSent ? 'partial' : 'failed'),
            'trigger_source' => $effTrigger,
            'scheduled_slot' => $scheduledSlot,
            'started_at'     => $notifStartedAt,
            'duration_ms'    => $durMs,
            'row_count'      => count($validAlerts),
            'summary'        => ($lineSent ? 'ส่ง LINE สำเร็จ แต่ส่ง Email ไม่สำเร็จ' : 'ส่งแจ้งเตือน Email ไม่สำเร็จ'),
            'error_detail'   => $lastError ?: 'ตรวจสอบ SMTP หรือรายชื่อผู้รับ',
            'meta'           => ['totalAlerts' => count($allAlerts), 'validAlerts' => count($validAlerts), 'lineSent' => $lineSent, 'skipped' => $skipped],
        ]);
    }

    return [
        'totalAlerts' => count($allAlerts),
        'validAlerts' => count($validAlerts),
        'sentEmails' => count($sentRecipients),
        'lineSent' => $lineSent,
        'skipped' => $skipped,
        'errors' => $emailSentOk ? 0 : 1,
        'lastError' => $lastError
    ];
}

function php_send_test_email(?string $specificEmail = null): array {
    $cfg = get_app_config();
    $smtpCfg = $cfg['notifications']['smtp'] ?? [];
    $lineCfg = $cfg['notifications']['line'] ?? [];
    $pdo = get_db();

    $recipients = [];
    if ($specificEmail !== null && trim($specificEmail) !== '') {
        $recipients = [['name' => 'ผู้รับทดสอบ', 'email' => trim($specificEmail)]];
    } else {
        $rows = $pdo->query("SELECT name, email FROM tbl_alert_recipients WHERE is_active = 1")->fetchAll();
        foreach ($rows as $r) {
            if (!empty($r['email']) && strpos($r['email'], '@example.com') === false) {
                $recipients[] = ['name' => $r['name'], 'email' => $r['email']];
            }
        }
        // If only example.com placeholder emails exist in DB, fallback to sender's own Gmail so test succeeds
        if (empty($recipients) && !empty($smtpCfg['user'])) {
            $recipients = [['name' => 'Admin', 'email' => $smtpCfg['user']]];
        }
    }

    $testAlerts = [
        [
            'type' => 'drought',
            'level' => 'critical',
            'title' => '🚨 ทดสอบระบบแจ้งเตือน: อ่างเก็บน้ำแม่ต๋ำตอนล่าง',
            'message' => 'ทดสอบการส่งแจ้งเตือนวิกฤตอัตโนมัติผ่าน PHP Gmail SMTP (Water_System2)',
            'triggerValue' => '🚨 น้ำกักเก็บน้อยวิกฤต (22%)',
            'thresholdValue' => '≤30%',
            'stationName' => 'อ่างเก็บน้ำแม่ต๋ำตอนล่าง'
        ],
        [
            'type' => 'pm25',
            'level' => 'warning',
            'title' => '⚠️ ทดสอบระบบแจ้งเตือน PM 2.5: ศาลาเอนกประสงค์บ้านหลุก',
            'message' => 'ตรวจพบค่า PM 2.5 เกินเกณฑ์เฝ้าระวัง (42.0 µg/m³)',
            'triggerValue' => '⚠️ เริ่มมีผลต่อสุขภาพ (42.0 µg/m³)',
            'thresholdValue' => '≥37.6 µg/m³',
            'stationName' => 'ศาลาเอนกประสงค์บ้านหลุก (อำเภอแจ้ห่ม)'
        ]
    ];

    $testStart = microtime(true);
    $testStartedAt = date('Y-m-d H:i:s');
    $html = php_build_digest_email_html($testAlerts);
    $subject = '🚨 [แจ้งเตือนวิกฤต] ทดสอบระบบแจ้งเตือนอัตโนมัติ — อบจ.ลำปาง';
    $res = php_smtp_send_email($smtpCfg, $recipients, $subject, $html);

    $sentList = implode(', ', array_map(function ($r) { return $r['email']; }, $recipients));

    // Also test LINE if configured
    $lineSent = false;
    if (!empty($lineCfg['channelToken']) && !empty($lineCfg['targetId'])) {
        $lRes = php_line_send_push($testAlerts, $lineCfg);
        $lineSent = !empty($lRes['sent']);
    }

    $durMs = (int)round((microtime(true) - $testStart) * 1000);
    if ($res['success']) {
        sys_log_record([
            'module'         => 'notification',
            'action'         => 'Send Test Alert',
            'status'         => 'success',
            'trigger_source' => 'manual',
            'started_at'     => $testStartedAt,
            'duration_ms'    => $durMs,
            'row_count'      => count($recipients),
            'summary'        => "ส่งอีเมลทดสอบสำเร็จ → {$sentList}" . ($lineSent ? ' (+LINE Push)' : ''),
        ]);
        return ['success' => true, 'sentTo' => $sentList, 'count' => count($recipients), 'lineSent' => $lineSent];
    }
    $errMsg = $res['error'] ?: 'ส่งไม่สำเร็จ';
    sys_log_record([
        'module'         => 'notification',
        'action'         => 'Send Test Alert',
        'status'         => 'failed',
        'trigger_source' => 'manual',
        'started_at'     => $testStartedAt,
        'duration_ms'    => $durMs,
        'row_count'      => 0,
        'summary'        => 'ส่งอีเมลทดสอบไม่สำเร็จ',
        'error_detail'   => $errMsg,
    ]);
    return ['success' => false, 'error' => $errMsg];
}

/**
 * 24/7 Dead-Man's Switch / Admin Operational Alert with 6h anti-spam cooldown.
 */
function php_send_operational_alert(string $alertKey, string $title, string $detail, string $severity = 'critical'): array {
    $cfg = get_app_config();
    $notifCfg = $cfg['notifications'] ?? [];
    if (empty($notifCfg['enabled'])) {
        return ['sent' => false, 'reason' => 'notifications_disabled'];
    }

    $stateFile = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'operational_alert_state.json';
    $now = time();
    $shouldSend = false;

    update_json_file_atomic($stateFile, [], function (array $state) use ($alertKey, $now, &$shouldSend) {
        $lastSent = (int)($state[$alertKey] ?? 0);
        if (($now - $lastSent) >= (6 * 3600)) {
            $shouldSend = true;
            $state[$alertKey] = $now;
        }
        return $state;
    });

    if (!$shouldSend) {
        return ['sent' => false, 'reason' => 'cooldown_6h'];
    }

    $smtpCfg = $notifCfg['smtp'] ?? [];
    $lineCfg = $notifCfg['line'] ?? [];
    $pdo = get_db();
    $recipients = $pdo->query("SELECT * FROM tbl_alert_recipients WHERE is_active = 1")->fetchAll();
    if (empty($recipients)) {
        return ['sent' => false, 'reason' => 'no_active_recipients'];
    }

    $alertsPayload = [[
        'type'           => 'system',
        'level'          => $severity,
        'title'          => "🛡️ แจ้งเตือนสุขภาพระบบ 24 ชม.: {$title}",
        'message'        => $detail,
        'triggerValue'   => '⚠️ ต้องการการตรวจสอบจากผู้ดูแลระบบ',
        'thresholdValue' => 'อัตโนมัติ (Dead-Man Switch)',
        'stationName'    => 'Water_System2 Server Monitor',
    ]];

    $subject = "🛡️ [Water_System2 Monitor] {$title}";
    $html = php_build_digest_email_html($alertsPayload);
    $res = php_smtp_send_email($smtpCfg, $recipients, $subject, $html);

    $lineSent = false;
    if (!empty($lineCfg['channelToken']) && !empty($lineCfg['targetId'])) {
        $lRes = php_line_send_push($alertsPayload, $lineCfg);
        $lineSent = !empty($lRes['sent']);
    }

    sys_log_record([
        'module'         => 'notification',
        'action'         => "Operational Alert ({$alertKey})",
        'status'         => !empty($res['success']) ? 'success' : 'failed',
        'trigger_source' => 'system',
        'row_count'      => count($recipients),
        'summary'        => (!empty($res['success']) ? "ส่งแจ้งเตือนเหตุขัดข้องระบบ ({$title}) สำเร็จ" : "ส่งแจ้งเตือนเหตุขัดข้อง ({$title}) ไม่สำเร็จ"),
        'error_detail'   => !empty($res['success']) ? null : ($res['error'] ?? null),
    ]);

    return ['sent' => !empty($res['success']), 'lineSent' => $lineSent];
}
