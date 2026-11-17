<?php
// =========================================================================
// Water_System2 — Web Setup Wizard for Server Deployment (Zero-Admin)
// Open: http://ชื่อเซิร์ฟเวอร์/Water_System2/server_setup.php
// Lets you configure the Server's MySQL credentials, auto-create all 10 tables,
// and run an initial data collection directly from the browser!
// =========================================================================

$phpServerDir = is_dir(__DIR__ . '/php_server') ? __DIR__ . '/php_server' : dirname(__DIR__) . '/php_server';
require_once $phpServerDir . '/config.php';
require_once $phpServerDir . '/auth.php';
require_once $phpServerDir . '/smart_worker_lib.php';
require_once $phpServerDir . '/backup_manager.php';

$message = '';
$statusType = '';
$dbOverrideFile = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'db_config.json';

$isLocalRequest = in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true);
$alreadyConfigured = file_exists($dbOverrideFile) || file_exists(WATER_SYSTEM2_ROOT . DIRECTORY_SEPARATOR . '.env');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? 'save_db';
    if ($action === 'save_db') {
        $existingPass = env_val('DB_PASS', '');
        $submittedCurrent = (string)($_POST['CURRENT_DB_PASS'] ?? '');
        $sess = get_current_user_session();
        $isAdminAuthed = AUTH_ENFORCE && !empty($sess['user']) && (($sess['user']['role'] ?? '') === 'admin');

        // On public subdomain/remote IP, require verifying current DB password once DB is configured
        if ($alreadyConfigured && !$isLocalRequest && !$isAdminAuthed && $existingPass !== '' && !hash_equals($existingPass, $submittedCurrent)) {
            $statusType = 'error';
            $message = "🔒 กรุณากรอกรหัสผ่าน MySQL ปัจจุบันให้ถูกต้องเพื่อยืนยันสิทธิ์ก่อนแก้ไขค่า Server";
        } else {
            $postedPass = (string)($_POST['DB_PASS'] ?? '');
            $finalPass = ($postedPass !== '') ? $postedPass : $existingPass;
            $newCfg = [
                'DB_HOST'          => trim($_POST['DB_HOST'] ?? 'localhost'),
                'DB_PORT'          => trim($_POST['DB_PORT'] ?? '3306'),
                'DB_NAME'          => trim($_POST['DB_NAME'] ?? 'water_system2'),
                'DB_USER'          => trim($_POST['DB_USER'] ?? 'root'),
                'DB_PASS'          => $finalPass,
                'GITHUB_SYNC_REPO' => trim($_POST['GITHUB_SYNC_REPO'] ?? 'PakaponTim/Water_System2')
            ];
            write_json_file($dbOverrideFile, $newCfg);
            foreach ($newCfg as $k => $v) {
                $ENV_VARS[$k] = $v;
            }
            try {
                $flagFile = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'schema_ready_v2_' . preg_replace('/[^a-zA-Z0-9_]/', '', $newCfg['DB_NAME']) . '.flag';
                @unlink($flagFile);
                $pdo = get_db();
                $statusType = 'success';
                $message = "✅ เชื่อมต่อฐานข้อมูล MySQL ({$newCfg['DB_NAME']}) และสร้าง/ตรวจสอบตารางครบทุกตารางบน Server สำเร็จแล้ว!";
                sys_log_record([
                    'module'         => 'system',
                    'action'         => 'Update Server DB Config',
                    'status'         => 'success',
                    'trigger_source' => 'user',
                    'summary'        => "บันทึกการตั้งค่า MySQL ({$newCfg['DB_HOST']}:{$newCfg['DB_PORT']}/{$newCfg['DB_NAME']}) เรียบร้อย",
                ]);
            } catch (Throwable $e) {
                $statusType = 'error';
                $message = "❌ เชื่อมต่อฐานข้อมูลไม่สำเร็จ: " . $e->getMessage();
            }
        }
    } elseif ($action === 'run_backup' || $action === 'run_backup_email') {
        $existingPass = env_val('DB_PASS', '');
        $submittedCurrent = (string)($_POST['CURRENT_DB_PASS'] ?? '');
        $sess = get_current_user_session();
        $isAdminAuthed = AUTH_ENFORCE && !empty($sess['user']) && (($sess['user']['role'] ?? '') === 'admin');
        if ($alreadyConfigured && !$isLocalRequest && !$isAdminAuthed && $existingPass !== '' && !hash_equals($existingPass, $submittedCurrent)) {
            $statusType = 'error';
            $message = "🔒 กรุณากรอกรหัสผ่าน MySQL ปัจจุบันก่อนสั่งสำรองข้อมูลจากภายนอก";
        } else {
            try {
                $bk = run_full_mysql_backup($action === 'run_backup_email', 'setup_ui');
                if (!empty($bk['success'])) {
                    $statusType = 'success';
                    $message = "💾 สำรองฐานข้อมูลสำเร็จ: {$bk['filename']} ({$bk['tables']} ตาราง, " . number_format((int)$bk['rows']) . " แถว, {$bk['sizeKb']} KB)";
                    if (!empty($bk['emailResult'])) {
                        $message .= !empty($bk['emailResult']['success']) ? ' | ส่ง Off-site Email สำเร็จ' : ' | ส่ง Email ไม่สำเร็จ: ' . ($bk['emailResult']['error'] ?? '');
                    }
                } else {
                    $statusType = 'error';
                    $message = "❌ สำรองฐานข้อมูลไม่สำเร็จ: " . ($bk['error'] ?? 'Unknown error');
                }
            } catch (Throwable $e) {
                $statusType = 'error';
                $message = "❌ สำรองฐานข้อมูลไม่สำเร็จ: " . $e->getMessage();
            }
        }
    } elseif ($action === 'save_domains') {
        $existingPass = env_val('DB_PASS', '');
        $submittedCurrent = (string)($_POST['CURRENT_DB_PASS'] ?? '');
        $sess = get_current_user_session();
        $isAdminAuthed = AUTH_ENFORCE && !empty($sess['user']) && (($sess['user']['role'] ?? '') === 'admin');
        if ($alreadyConfigured && !$isLocalRequest && !$isAdminAuthed && $existingPass !== '' && !hash_equals($existingPass, $submittedCurrent)) {
            $statusType = 'error';
            $message = "🔒 กรุณากรอกรหัสผ่าน MySQL ปัจจุบันก่อนแก้ไขการตั้งค่า Domain บน Server สาธารณะ";
        } else {
            $savedDom = save_domain_config([
                'primary_domain'            => trim((string)($_POST['primary_domain'] ?? '')),
                'backup_domain'             => trim((string)($_POST['backup_domain'] ?? '')),
                'extra_allowed_origins'     => trim((string)($_POST['extra_allowed_origins'] ?? '')),
                'failover_auto_ping_backup' => !empty($_POST['failover_auto_ping_backup']),
            ]);
            $statusType = 'success';
            $message = "🌐 บันทึกไฟล์ domain_config.json สำเร็จ (Primary: {$savedDom['primary_domain']} | Backup: {$savedDom['backup_domain']})";
        }
    }
}

$domainCfg = get_domain_config();

$curHost = env_val('DB_HOST', 'localhost');
$curPort = env_val('DB_PORT', '3306');
$curName = env_val('DB_NAME', 'water_system2');
$curUser = env_val('DB_USER', 'root');
$curPass = env_val('DB_PASS', 'root');
$curRepo = env_val('GITHUB_SYNC_REPO', 'PakaponTim/Water_System2');

$dbConnected = false;
$tableCounts = [];
try {
    $pdo = get_db();
    $dbConnected = true;
    foreach ([
        'tbl_water_disaster_monitoring' => 'ข้อมูลระดับน้ำ',
        'tbl_rainfall_monitoring' => 'ข้อมูลน้ำฝน',
        'tbl_drought_monitoring' => 'ข้อมูลอ่างเก็บน้ำ/ภัยแล้ง',
        'tbl_pm25_monitoring' => 'ข้อมูลฝุ่น PM 2.5',
        'tbl_complaints_monitoring' => 'ข้อมูลเรื่องร้องเรียน Traffy'
    ] as $tbl => $label) {
        $cnt = (int)$pdo->query("SELECT COUNT(*) FROM `{$tbl}`")->fetchColumn();
        $tableCounts[$label] = number_format($cnt);
    }
} catch (Throwable $e) {
    $dbConnected = false;
}
?>
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ตั้งค่าระบบบน Server — Water_System2</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>body { font-family: 'Prompt', sans-serif; }</style>
</head>
<body class="bg-slate-100 text-slate-800 min-h-screen py-10 px-4">
  <div class="max-w-2xl mx-auto bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
    <div class="bg-emerald-800 text-white px-6 py-5 flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold">⚙️ ตั้งค่าการเชื่อมต่อฐานข้อมูลบน Server (Water_System2)</h1>
        <p class="text-xs text-emerald-100 mt-1">สำหรับวางโฟลเดอร์บน Server โดยไม่ต้องมีสิทธิ์ Admin ตั้งค่าเครื่อง</p>
      </div>
      <a href="./index.html" class="bg-white/20 hover:bg-white/30 text-white text-sm px-4 py-2 rounded-lg font-medium transition">
        เข้าสู่หน้า Dashboard →
      </a>
    </div>

    <div class="p-6 space-y-6">
      <?php if ($message !== ''): ?>
        <div class="p-4 rounded-xl text-sm font-medium <?= $statusType === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200' ?>">
          <?= htmlspecialchars($message) ?>
        </div>
      <?php endif; ?>

      <div class="p-4 rounded-xl border <?= $dbConnected ? 'bg-emerald-50/60 border-emerald-200' : 'bg-amber-50 border-amber-200' ?>">
        <div class="flex items-center justify-between">
          <span class="font-semibold text-sm">
            สถานะฐานข้อมูลปัจจุบัน:
            <?php if ($dbConnected): ?>
              <span class="text-emerald-700">🟢 เชื่อมต่อสำเร็จ (<?= htmlspecialchars($curName) ?>)</span>
            <?php else: ?>
              <span class="text-red-600">🔴 ยังไม่ได้เชื่อมต่อ กรุณาระบุข้อมูล MySQL ของ Server ด้านล่าง</span>
            <?php endif; ?>
          </span>
        </div>
        <?php if ($dbConnected && !empty($tableCounts)): ?>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3 text-xs">
            <?php foreach ($tableCounts as $label => $cnt): ?>
              <div class="bg-white p-2.5 rounded-lg border border-slate-200">
                <div class="text-slate-500"><?= htmlspecialchars($label) ?></div>
                <div class="text-base font-bold text-slate-800"><?= $cnt ?> แถว</div>
              </div>
            <?php endforeach; ?>
          </div>
        <?php endif; ?>
      </div>

      <form method="POST" class="space-y-4">
        <input type="hidden" name="action" value="save_db">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="sm:col-span-2">
            <label class="block text-xs font-semibold text-slate-600 mb-1">MySQL Host บน Server</label>
            <input type="text" name="DB_HOST" value="<?= htmlspecialchars($curHost) ?>" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" required>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">MySQL Port</label>
            <input type="text" name="DB_PORT" value="<?= htmlspecialchars($curPort) ?>" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" required>
          </div>
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1">ชื่อฐานข้อมูล (Database Name)</label>
          <input type="text" name="DB_NAME" value="<?= htmlspecialchars($curName) ?>" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" required>
          <p class="text-[11px] text-slate-400 mt-1">ระบบจะสร้างตารางทั้ง 10 ตาราง (รวม <code>tbl_system_logs</code>) ให้อัตโนมัติทันทีที่กดบันทึก</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">MySQL Username</label>
            <input type="text" name="DB_USER" value="<?= htmlspecialchars($curUser) ?>" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" required>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">MySQL Password (ใหม่ / หรือเว้นว่างเพื่อใช้ค่าเดิม)</label>
            <input type="password" name="DB_PASS" value="" placeholder="<?= $curPass !== '' ? 'ตั้งค่าไว้แล้ว — เว้นว่างเพื่อคงค่าเดิม' : 'ระบุรหัสผ่าน MySQL' ?>" autocomplete="new-password" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
          </div>
        </div>

        <?php if ($alreadyConfigured && !$isLocalRequest): ?>
          <div class="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <label class="block text-xs font-semibold text-amber-800 mb-1">🔒 รหัสผ่าน MySQL ปัจจุบัน (ยืนยันสิทธิ์การเปลี่ยนแปลงค่าบน Server สาธารณะ)</label>
            <input type="password" name="CURRENT_DB_PASS" value="" required placeholder="กรอกรหัสผ่าน DB เดิมก่อนบันทึก" class="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm bg-white">
          </div>
        <?php endif; ?>

        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1">GitHub Repository สำหรับซิงค์ข้อมูลสำรอง 24 ชม.</label>
          <input type="text" name="GITHUB_SYNC_REPO" value="<?= htmlspecialchars($curRepo) ?>" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
        </div>

        <div class="flex flex-wrap gap-3 pt-2">
          <button type="submit" class="bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition">
            💾 บันทึกค่าและตรวจสอบตารางฐานข้อมูลอัตโนมัติ
          </button>
          <a href="./cron.php" target="_blank" class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition">
            🚀 ทดสอบดึงข้อมูลเข้า Server (cron.php)
          </a>
          <a href="./endpoint.php?r=/api/health" target="_blank" class="bg-slate-700 hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition">
            🩺 ตรวจ Health 24 ชม.
          </a>
        </div>
      </form>

      <?php
        $health = get_system_health_report();
        $baseSubUrl = preg_replace('/\/server_setup\.php$/i', '', smart_build_self_url('server_setup.php'));
        $backupsList = list_db_backups();
        $spoolCnt = db_spool_count();
      ?>
      <div class="bg-emerald-50/70 border border-emerald-200 rounded-xl p-4 text-xs space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="font-bold text-emerald-950 text-sm">💾 ระบบสำรองฐานข้อมูล &amp; กู้คืนภัยพิบัติ (Backup + Local Spool + Cloud Viewer)</div>
          <a href="./emergency_cloud.html" target="_blank" class="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold transition">☁️ เปิดโหมดฉุกเฉิน (Cloud Viewer)</a>
        </div>
        <div class="text-slate-700">
          • <b>ไฟล์สำรองฐานข้อมูล (10 ตาราง):</b> <?= count($backupsList) ?> ไฟล์
          <?php if (!empty($backupsList[0])): ?>
            (ล่าสุด: <code><?= htmlspecialchars($backupsList[0]['filename']) ?></code>, <?= htmlspecialchars((string)$backupsList[0]['sizeKb']) ?> KB เมื่อ <?= htmlspecialchars($backupsList[0]['createdAt']) ?>)
          <?php else: ?>
            (ยังไม่มีไฟล์สำรอง — ระบบสร้างอัตโนมัติทุกวัน หรือกดปุ่มด้านล่าง)
          <?php endif; ?>
          <br>• <b>Local DB Spool (คิวพักข้อมูลหาก DB ดับ):</b> <?= (int)$spoolCnt ?> ไฟล์
        </div>
        <form method="POST" class="flex flex-wrap gap-2 items-center">
          <?php if ($alreadyConfigured && !$isLocalRequest): ?>
            <input type="password" name="CURRENT_DB_PASS" value="" required placeholder="รหัสผ่าน DB เดิม" class="border border-amber-300 rounded-lg px-2.5 py-1.5 text-xs bg-white">
          <?php endif; ?>
          <button type="submit" name="action" value="run_backup" class="px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold transition">💾 สำรองฐานข้อมูลทันที (.sql.gz)</button>
          <button type="submit" name="action" value="run_backup_email" class="px-3.5 py-2 rounded-lg bg-purple-700 hover:bg-purple-800 text-white font-semibold transition">📧 สำรอง + ส่งเข้า Email (Off-site)</button>
          <?php if (!empty($backupsList[0])): ?>
            <a href="./endpoint.php?r=/api/backup/download" class="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-semibold transition">📥 ดาวน์โหลดไฟล์ล่าสุด</a>
          <?php endif; ?>
        </form>
      </div>

      <div class="bg-sky-50/70 border border-sky-200 rounded-xl p-4 text-xs space-y-3">
        <div class="font-bold text-sky-950 text-sm">🌐 ตั้งค่าโดเมนหลัก &amp; โดเมนสำรอง (<code>domain_config.json</code>)</div>
        <p class="text-slate-600">รองรับการย้ายโดเมนหรือมีโดเมนสำรองตัวที่ 2 — ระบบ CORS และ GitHub Actions Failover จะอ่านค่าจาก <code>domain_config.json</code> นี้โดยอัตโนมัติ (เมื่อแก้แล้วให้ Push <code>domain_config.json</code> ขึ้น GitHub ด้วย)</p>
        <form method="POST" class="space-y-3">
          <?php if ($alreadyConfigured && !$isLocalRequest): ?>
            <input type="password" name="CURRENT_DB_PASS" value="" required placeholder="รหัสผ่าน DB เดิมก่อนบันทึก" class="w-full border border-amber-300 rounded-lg px-3 py-1.5 text-xs bg-white">
          <?php endif; ?>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block font-semibold text-slate-700 mb-1">โดเมนหลัก (Primary Domain URL)</label>
              <input type="text" name="primary_domain" value="<?= htmlspecialchars($domainCfg['primary_domain'] ?? '') ?>" placeholder="https://water.domain.go.th/Water_System2" class="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white">
            </div>
            <div>
              <label class="block font-semibold text-slate-700 mb-1">โดเมนสำรองที่ 2 (Backup Domain URL)</label>
              <input type="text" name="backup_domain" value="<?= htmlspecialchars($domainCfg['backup_domain'] ?? '') ?>" placeholder="https://backup-water.domain.com/Water_System2" class="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white">
            </div>
          </div>
          <div>
            <label class="block font-semibold text-slate-700 mb-1">Allowed CORS Origins เพิ่มเติม (คั่นด้วยลูกน้ำ ,)</label>
            <input type="text" name="extra_allowed_origins" value="<?= htmlspecialchars(implode(', ', $domainCfg['extra_allowed_origins'] ?? [])) ?>" placeholder="https://portal.lampangpao.go.th" class="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white">
          </div>
          <label class="inline-flex items-center gap-2 text-slate-700 cursor-pointer">
            <input type="checkbox" name="failover_auto_ping_backup" value="1" <?= !empty($domainCfg['failover_auto_ping_backup']) ? 'checked' : '' ?> class="rounded">
            <span>ให้ GitHub Actions ช่วยปลุก Domain สำรอง (<code>cron.php</code>) ทุก 30 นาทีควบคู่กับ Domain หลัก</span>
          </label>
          <div class="flex flex-wrap gap-2">
            <button type="submit" name="action" value="save_domains" class="px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white font-semibold transition">💾 บันทึกค่า Domain ลง domain_config.json</button>
          </div>
        </form>
        <div class="bg-white border border-sky-200 rounded-lg p-2.5 space-y-1 text-[11px] text-slate-600">
          <div><b>Primary Cron:</b> <code><?= htmlspecialchars($domainCfg['resolved']['primary']['cron'] ?? '-') ?></code> <?= !empty($domainCfg['resolved']['primary']['active']) ? '✅ (ใช้งานจริง)' : '⚪ (ตัวอย่าง/ยังไม่ตั้ง)' ?></div>
          <div><b>Backup Cron:</b> <code><?= htmlspecialchars($domainCfg['resolved']['backup']['cron'] ?? '-') ?></code> <?= !empty($domainCfg['resolved']['backup']['active']) ? '✅ (ใช้งานจริง)' : '⚪ (ตัวอย่าง/ยังไม่ตั้ง)' ?></div>
        </div>
      </div>

      <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs space-y-2">
        <div class="font-bold text-slate-800 text-sm">🛡️ คู่มือเชื่อมต่อ Subdomain Server 24 ชั่วโมง (Zero-Admin Checklist)</div>
        <div>• <b>สิทธิ์ความปลอดภัย `.htaccess`:</b> Root <?= !empty($health['security']['hasRootHtaccess']) ? '✅ ป้องกันแล้ว' : '⚠️ ยังไม่มี' ?> | Runtime <?= !empty($health['security']['hasRuntimeHtaccess']) ? '✅ ป้องกันแล้ว' : '⚠️ ยังไม่มี' ?></div>
        <div>• <b>1. ตั้ง GitHub Actions Secret (<code>WATER_SERVER_CRON_URL</code>):</b> <code class="bg-white px-1.5 py-0.5 border rounded select-all"><?= htmlspecialchars($baseSubUrl . '/cron.php') ?></code> (เพื่อให้ GitHub ช่วยปลุก Server ดึงข้อมูลทุก 30 นาทีตลอด 24 ชม.)</div>
        <div>• <b>2. ตั้ง Uptime Monitor ฟรี (เช็กทุก 5 นาที):</b> <code class="bg-white px-1.5 py-0.5 border rounded select-all"><?= htmlspecialchars($baseSubUrl . '/endpoint.php?r=/api/health') ?></code></div>
        <div>• <b>3. สั่งเปิด Web Smart Sleep Worker (ถ้าโฮสต์รองรับ Self-Chain):</b> <code class="bg-white px-1.5 py-0.5 border rounded select-all"><?= htmlspecialchars($baseSubUrl . '/worker.php?action=start') ?></code></div>
      </div>
    </div>
  </div>
</body>
</html>
