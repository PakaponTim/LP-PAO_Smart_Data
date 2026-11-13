<?php
// =========================================================================
// Water_System2 (Port 7000) — Background Scheduler / Cron Worker
// Checks config.json scheduledTasks every 20 seconds (or runs once with --once)
// and triggers Direct API Collectors without needing Chrome or Extensions open.
// =========================================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/collectors.php';

$runOnce = in_array('--once', $argv ?? [], true);

if ($runOnce) {
    add_server_log('Scheduler-7000', '🚀 เริ่มดึงข้อมูลครบทุกโปรเจค (One-shot Direct API Run)...');
    $cfg = get_app_config();
    $active = $cfg['isScheduleActive'];

    if (!empty($active['water'])) {
        try { collect_water_level_direct('db'); } catch (Throwable $e) { add_server_log('Scheduler-7000', '❌ ระดับน้ำ: ' . $e->getMessage()); }
    }
    if (!empty($active['drought'])) {
        try { collect_drought_direct('db'); } catch (Throwable $e) { add_server_log('Scheduler-7000', '❌ ภัยแล้ง: ' . $e->getMessage()); }
    }
    if (!empty($active['pm25'])) {
        try { collect_pm25_direct('db'); } catch (Throwable $e) { add_server_log('Scheduler-7000', '❌ PM 2.5: ' . $e->getMessage()); }
    }
    if (!empty($active['complaints'])) {
        try { collect_complaints_direct('db'); } catch (Throwable $e) { add_server_log('Scheduler-7000', '❌ ร้องเรียน: ' . $e->getMessage()); }
    }
    add_server_log('Scheduler-7000', '✅ ดึงข้อมูลครบทุกโปรเจคเสร็จสมบูรณ์');
    exit(0);
}

$lastTriggeredSlot = '';
add_server_log('Scheduler-7000', '⏰ ระบบตั้งเวลาอัตโนมัติ (PHP Direct API Scheduler Port 7000) เริ่มทำงาน');

while (true) {
    try {
        $cfg = get_app_config();
        $tasks = $cfg['scheduledTasks'] ?? [];
        $active = $cfg['isScheduleActive'] ?? [];
        $nowKey = date('Y-m-d H:i');
        $hm = date('H:i');

        if (in_array($hm, $tasks, true) && $lastTriggeredSlot !== $nowKey) {
            $lastTriggeredSlot = $nowKey;
            add_server_log('Scheduler-7000', "🔔 ถึงเวลาเก็บข้อมูลตามตาราง: {$hm} (Direct API ไม่ต้องใช้ Extension)");

            if (!empty($active['water'])) {
                try { collect_water_level_direct('db'); } catch (Throwable $e) { add_server_log('Scheduler-7000', '❌ ระดับน้ำ: ' . $e->getMessage()); }
            }
            if (!empty($active['drought'])) {
                try { collect_drought_direct('db'); } catch (Throwable $e) { add_server_log('Scheduler-7000', '❌ ภัยแล้ง: ' . $e->getMessage()); }
            }
            if (!empty($active['pm25'])) {
                try { collect_pm25_direct('db'); } catch (Throwable $e) { add_server_log('Scheduler-7000', '❌ PM 2.5: ' . $e->getMessage()); }
            }
            if (!empty($active['complaints'])) {
                try { collect_complaints_direct('db'); } catch (Throwable $e) { add_server_log('Scheduler-7000', '❌ ร้องเรียน: ' . $e->getMessage()); }
            }

            add_server_log('Scheduler-7000', "✅ ทำงานตามตารางเวลา {$hm} เสร็จสิ้นทุกโปรเจคแล้ว");
        }
    } catch (Throwable $e) {
        // Keep daemon alive
    }
    sleep(20);
}

