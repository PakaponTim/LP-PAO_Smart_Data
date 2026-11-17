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
require_once $phpServerDir . '/public_api.php';

security_apply_http_headers(false);
$setupCsrfToken = security_get_or_issue_setup_csrf();

$message = '';
$statusType = '';
$newlyIssuedKey = null;
$dbOverrideFile = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'db_config.json';

$isLocalRequest = is_local_loopback_request();
$alreadyConfigured = file_exists($dbOverrideFile) || file_exists(WATER_SYSTEM2_ROOT . DIRECTORY_SEPARATOR . '.env');

function server_setup_passes_guard(bool $alreadyConfigured, bool $isLocalRequest, ?string &$reason = null): bool {
    $reason = '';
    $existingPass = env_val('DB_PASS', '');
    $submittedCurrent = (string)($_POST['CURRENT_DB_PASS'] ?? '');
    $sess = get_current_user_session();
    $isAdminAuthed = !empty($sess['fromCookie']) && !empty($sess['user']) && (($sess['user']['role'] ?? '') === 'admin');
    if (!$alreadyConfigured || $isLocalRequest || $isAdminAuthed || $existingPass === '') {
        return true;
    }

    $clientIp = security_client_ip();
    $bf = security_bruteforce_check('server_setup', $clientIp, 5, 300);
    if (!empty($bf['blocked'])) {
        $reason = 'rate_limited';
        return false;
    }

    if ($submittedCurrent !== '' && hash_equals($existingPass, $submittedCurrent)) {
        security_bruteforce_clear('server_setup', $clientIp);
        return true;
    }

    $rec = security_bruteforce_record_failure('server_setup', $clientIp, 5, 300);
    $reason = !empty($rec['blocked']) ? 'rate_limited' : 'bad_password';
    return false;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? 'save_db';
    if (!security_verify_setup_csrf()) {
        http_response_code(403);
        $statusType = 'error';
        $message = "🔒 คำขอไม่ผ่านการตรวจสอบ CSRF Token กรุณารีเฟรชหน้าเว็บแล้วลองใหม่";
    } elseif ($action === 'save_db') {
        $existingPass = env_val('DB_PASS', '');
        $guardReason = '';

        // On public subdomain/remote IP, require verifying current DB password once DB is configured
        if (!server_setup_passes_guard($alreadyConfigured, $isLocalRequest, $guardReason)) {
            $statusType = 'error';
            $message = ($guardReason === 'rate_limited')
                ? "🛑 กรอกรหัสผ่านผิดเกินกำหนด กรุณารอ 5 นาทีแล้วลองใหม่"
                : "🔒 กรุณากรอกรหัสผ่าน MySQL ปัจจุบันให้ถูกต้องเพื่อยืนยันสิทธิ์ก่อนแก้ไขค่า Server";
        } else {
            $postedPass = (string)($_POST['DB_PASS'] ?? '');
            $finalPass = ($postedPass !== '') ? $postedPass : $existingPass;
            $postedCronSecret = trim((string)($_POST['CRON_SECRET'] ?? ''));
            $finalCronSecret  = ($postedCronSecret !== '') ? $postedCronSecret : (string)env_val('CRON_SECRET', '');
            $postedBkKey      = trim((string)($_POST['DB_BACKUP_ENCRYPTION_KEY'] ?? ''));
            $finalBkKey       = ($postedBkKey !== '') ? $postedBkKey : (string)env_val('DB_BACKUP_ENCRYPTION_KEY', '');

            $newCfg = [
                'DB_HOST'                  => trim($_POST['DB_HOST'] ?? 'localhost'),
                'DB_PORT'                  => trim($_POST['DB_PORT'] ?? '3306'),
                'DB_NAME'                  => trim($_POST['DB_NAME'] ?? 'water_system2'),
                'DB_USER'                  => trim($_POST['DB_USER'] ?? 'root'),
                'DB_PASS'                  => $finalPass,
                'GITHUB_SYNC_REPO'         => trim($_POST['GITHUB_SYNC_REPO'] ?? 'PakaponTim/Water_System2'),
                'CRON_SECRET'              => $finalCronSecret,
                'DB_BACKUP_ENCRYPTION_KEY' => $finalBkKey,
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
        if (!server_setup_passes_guard($alreadyConfigured, $isLocalRequest, $guardReason)) {
            $statusType = 'error';
            $message = ($guardReason === 'rate_limited')
                ? "🛑 กรอกรหัสผ่านผิดเกินกำหนด กรุณารอ 5 นาทีแล้วลองใหม่"
                : "🔒 กรุณากรอกรหัสผ่าน MySQL ปัจจุบันก่อนสั่งสำรองข้อมูลจากภายนอก";
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
    } elseif ($action === 'decrypt_backup') {
        $guardReason = '';
        if (!server_setup_passes_guard($alreadyConfigured, $isLocalRequest, $guardReason)) {
            $statusType = 'error';
            $message = ($guardReason === 'rate_limited')
                ? "🛑 กรอกรหัสผ่านผิดเกินกำหนด กรุณารอ 5 นาทีแล้วลองใหม่"
                : "🔒 กรุณากรอกรหัสผ่าน MySQL ปัจจุบันก่อนถอดรหัสไฟล์สำรอง";
        } else {
            $decPass = trim((string)($_POST['decrypt_passphrase'] ?? '')) ?: backup_encryption_passphrase();
            $tmpFile = $_FILES['enc_backup_file']['tmp_name'] ?? '';
            $origName = basename((string)($_FILES['enc_backup_file']['name'] ?? 'backup.sql.gz.enc'));
            if ($tmpFile === '' || !is_uploaded_file($tmpFile)) {
                $statusType = 'error';
                $message = "❌ กรุณาเลือกไฟล์ .sql.gz.enc ที่ต้องการถอดรหัส";
            } elseif ($decPass === '') {
                $statusType = 'error';
                $message = "❌ กรุณาระบุรหัสผ่านสำหรับถอดรหัส (DB_BACKUP_ENCRYPTION_KEY)";
            } else {
                $plain = backup_decrypt_bytes((string)file_get_contents($tmpFile), $decPass);
                if ($plain === null) {
                    $statusType = 'error';
                    $message = "❌ ถอดรหัสไม่สำเร็จ: รหัสผ่านไม่ถูกต้องหรือไฟล์ถูกดัดแปลง (HMAC mismatch)";
                } else {
                    $outName = preg_replace('/\.enc$/i', '', $origName) ?: 'decrypted_backup.sql.gz';
                    header('Content-Type: application/octet-stream');
                    header('Content-Disposition: attachment; filename="' . rawurlencode($outName) . '"');
                    header('Content-Length: ' . strlen($plain));
                    echo $plain;
                    exit;
                }
            }
        }
    } elseif ($action === 'save_domains') {
        $guardReason = '';
        if (!server_setup_passes_guard($alreadyConfigured, $isLocalRequest, $guardReason)) {
            $statusType = 'error';
            $message = ($guardReason === 'rate_limited')
                ? "🛑 กรอกรหัสผ่านผิดเกินกำหนด กรุณารอ 5 นาทีแล้วลองใหม่"
                : "🔒 กรุณากรอกรหัสผ่าน MySQL ปัจจุบันก่อนแก้ไขการตั้งค่า Domain บน Server สาธารณะ";
        } else {
            $savedDom = save_domain_config([
                'primary_domain'            => trim((string)($_POST['primary_domain'] ?? '')),
                'backup_domain'             => trim((string)($_POST['backup_domain'] ?? '')),
                'extra_allowed_origins'     => trim((string)($_POST['extra_allowed_origins'] ?? '')),
                'allowed_extension_ids'     => trim((string)($_POST['allowed_extension_ids'] ?? '')),
                'failover_auto_ping_backup' => !empty($_POST['failover_auto_ping_backup']),
            ]);
            $statusType = 'success';
            $message = "🌐 บันทึกไฟล์ domain_config.json สำเร็จ (Primary: {$savedDom['primary_domain']} | Backup: {$savedDom['backup_domain']})";
        }
    } elseif ($action === 'issue_agency_key') {
        $guardReason = '';
        if (!server_setup_passes_guard($alreadyConfigured, $isLocalRequest, $guardReason)) {
            $statusType = 'error';
            $message = ($guardReason === 'rate_limited')
                ? "🛑 กรอกรหัสผ่านผิดเกินกำหนด กรุณารอ 5 นาทีแล้วลองใหม่"
                : "🔒 กรุณากรอกรหัสผ่าน MySQL ปัจจุบันก่อนออก Inter-Agency API Key";
        } else {
            try {
                $agencyName = trim((string)($_POST['agencyName'] ?? ''));
                $rateLimit = (int)($_POST['rateLimit'] ?? 600);
                $newlyIssuedKey = public_create_api_key($agencyName, ['overview', 'environment', 'traffy'], $rateLimit);
                $statusType = 'success';
                $message = "🔑 ออก API Key ให้หน่วยงาน [{$newlyIssuedKey['agencyName']}] เรียบร้อยแล้ว (โปรดคัดลอกเก็บทันที Key จริงจะแสดงครั้งเดียว)";
            } catch (Throwable $e) {
                $statusType = 'error';
                $message = "❌ ออก API Key ไม่สำเร็จ: " . $e->getMessage();
            }
        }
    } elseif ($action === 'revoke_agency_key') {
        $guardReason = '';
        if (!server_setup_passes_guard($alreadyConfigured, $isLocalRequest, $guardReason)) {
            $statusType = 'error';
            $message = ($guardReason === 'rate_limited')
                ? "🛑 กรอกรหัสผ่านผิดเกินกำหนด กรุณารอ 5 นาทีแล้วลองใหม่"
                : "🔒 กรุณากรอกรหัสผ่าน MySQL ปัจจุบันก่อนเพิกถอน API Key";
        } else {
            $keyId = trim((string)($_POST['keyId'] ?? ''));
            if ($keyId !== '' && public_revoke_api_key($keyId)) {
                $statusType = 'success';
                $message = "🛑 เพิกถอน API Key ({$keyId}) เรียบร้อยแล้ว Key เดิมจะถูกปฏิเสธทันที";
            } else {
                $statusType = 'error';
                $message = "⚠️ ไม่พบ API Key ที่ใช้งานอยู่ ({$keyId})";
            }
        }
    }
}

$domainCfg = get_domain_config();
$agencyKeys = public_list_api_keys();

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
        <input type="hidden" name="_csrf" value="<?= htmlspecialchars($setupCsrfToken) ?>">
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

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 border border-slate-200 rounded-xl p-3">
          <div>
            <label class="block text-xs font-semibold text-slate-700 mb-1">🔐 Backup Encryption Key (AES-256 สำหรับส่ง Email)</label>
            <input type="password" name="DB_BACKUP_ENCRYPTION_KEY" value="" placeholder="<?= backup_encryption_passphrase() !== '' ? 'ตั้งค่าไว้แล้ว — เว้นว่างเพื่อคงค่าเดิม' : 'กำหนดรหัสลับเพื่อเข้ารหัส .sql.gz.enc' ?>" autocomplete="new-password" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs bg-white">
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-700 mb-1">🛡️ Cron HMAC Secret (<code>CRON_SECRET</code>)</label>
            <input type="password" name="CRON_SECRET" value="" placeholder="<?= env_val('CRON_SECRET', '') !== '' ? 'ตั้งค่าไว้แล้ว — เว้นว่างเพื่อคงค่าเดิม' : 'รหัสลับยืนยันตัวตน cron.php & worker.php' ?>" autocomplete="new-password" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs bg-white">
          </div>
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
          <a href="./db_compare.html" target="_blank" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition">⚖️ เทียบ DB water_systems vs water_system2</a>
          <a href="./mobile.html" target="_blank" class="px-3 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-700 text-white font-semibold transition">📱 มุมมองมือถือ / iPad</a>
          <a href="./public.html" target="_blank" class="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold transition">🌐 Public Dashboard</a>
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
          <input type="hidden" name="_csrf" value="<?= htmlspecialchars($setupCsrfToken) ?>">
          <?php if ($alreadyConfigured && !$isLocalRequest): ?>
            <input type="password" name="CURRENT_DB_PASS" value="" required placeholder="รหัสผ่าน DB เดิม" class="border border-amber-300 rounded-lg px-2.5 py-1.5 text-xs bg-white">
          <?php endif; ?>
          <button type="submit" name="action" value="run_backup" class="px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold transition">💾 สำรองฐานข้อมูลทันที (.sql.gz)</button>
          <button type="submit" name="action" value="run_backup_email" class="px-3.5 py-2 rounded-lg bg-purple-700 hover:bg-purple-800 text-white font-semibold transition">📧 สำรอง + ส่งเข้า Email (Off-site)</button>
          <?php if (!empty($backupsList[0])): ?>
            <a href="./endpoint.php?r=/api/backup/download" class="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-semibold transition">📥 ดาวน์โหลดไฟล์ล่าสุด</a>
          <?php endif; ?>
        </form>
        <form method="POST" enctype="multipart/form-data" class="flex flex-wrap gap-2 items-center pt-2 border-t border-emerald-200/70">
          <input type="hidden" name="_csrf" value="<?= htmlspecialchars($setupCsrfToken) ?>">
          <span class="font-semibold text-emerald-900">🔓 ถอดรหัสไฟล์ Email Backup (.sql.gz.enc):</span>
          <input type="file" name="enc_backup_file" accept=".enc" required class="text-[11px] bg-white border border-slate-300 rounded px-2 py-1">
          <input type="password" name="decrypt_passphrase" placeholder="Encryption Key (เว้นว่างใช้ค่าที่ตั้งไว้)" class="border border-slate-300 rounded px-2 py-1 text-[11px] bg-white">
          <?php if ($alreadyConfigured && !$isLocalRequest): ?>
            <input type="password" name="CURRENT_DB_PASS" value="" required placeholder="รหัส DB เดิม" class="border border-amber-300 rounded px-2 py-1 text-[11px] bg-white">
          <?php endif; ?>
          <button type="submit" name="action" value="decrypt_backup" class="px-3 py-1 rounded bg-emerald-800 hover:bg-emerald-900 text-white font-semibold transition">ถอดรหัส &amp; ดาวน์โหลด</button>
        </form>
      </div>

      <div class="bg-sky-50/70 border border-sky-200 rounded-xl p-4 text-xs space-y-3">
        <div class="font-bold text-sky-950 text-sm">🌐 ตั้งค่าโดเมนหลัก &amp; โดเมนสำรอง (<code>domain_config.json</code>)</div>
        <p class="text-slate-600">รองรับการย้ายโดเมนหรือมีโดเมนสำรองตัวที่ 2 — ระบบ CORS และ GitHub Actions Failover จะอ่านค่าจาก <code>domain_config.json</code> นี้โดยอัตโนมัติ (เมื่อแก้แล้วให้ Push <code>domain_config.json</code> ขึ้น GitHub ด้วย)</p>
        <form method="POST" class="space-y-3">
          <input type="hidden" name="_csrf" value="<?= htmlspecialchars($setupCsrfToken) ?>">
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
          <div>
            <label class="block font-semibold text-slate-700 mb-1">Allowed Chrome Extension IDs (คั่นด้วยลูกน้ำ — ล็อก Extension เฉพาะเครื่องที่ระบุ)</label>
            <input type="text" name="allowed_extension_ids" value="<?= htmlspecialchars(implode(', ', $domainCfg['allowed_extension_ids'] ?? [])) ?>" placeholder="เช่น abcdefghijklmnopabcdefghijklmnop (เว้นว่างอนุญาตเฉพาะ Localhost)" class="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white">
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

      <div id="agency-keys" class="bg-violet-50/70 border border-violet-200 rounded-xl p-4 text-xs space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="font-bold text-violet-950 text-sm">🔑 จัดการ Inter-Agency API Keys สำหรับหน่วยงานภาคี (Zero-PII + SHA-256 + Rate Limit)</div>
          <a href="./public.html#api-portal" target="_blank" class="px-3 py-1 rounded-lg bg-violet-700 hover:bg-violet-800 text-white font-semibold transition">📖 เปิด API Explorer / Docs</a>
        </div>
        <p class="text-slate-600">ออกรหัส <code>X-API-Key</code> สำหรับหน่วยงานที่ต้องการดึงข้อมูลเฉพาะทาง (เช่น <code>/endpoint.php?r=/api/public/agency/traffy</code> และ <code>/api/public/agency/all</code>) ระบบเก็บเฉพาะค่า SHA-256 Hash บนเซิร์ฟเวอร์, จำกัดสิทธิ์แบบ Read-Only (<code>GET</code>) และตัดข้อมูลส่วนบุคคล (Zero-PII) ออกอัตโนมัติ</p>

        <?php if (is_array($newlyIssuedKey)): ?>
          <div class="bg-emerald-50 border-2 border-emerald-400 rounded-xl p-3 space-y-1.5">
            <div class="font-bold text-emerald-900">✅ Key ใหม่สำหรับ: <?= htmlspecialchars($newlyIssuedKey['agencyName']) ?> (บันทึกเก็บทันที — ระบบจะไม่แสดงรหัสเต็มซ้ำอีก)</div>
            <div class="flex flex-wrap items-center gap-2">
              <code id="newAgencyApiKeyText" class="bg-white border border-emerald-300 px-2.5 py-1.5 rounded font-mono text-xs text-emerald-950 select-all"><?= htmlspecialchars($newlyIssuedKey['apiKey']) ?></code>
              <button type="button" onclick="navigator.clipboard && navigator.clipboard.writeText(document.getElementById('newAgencyApiKeyText').textContent)" class="px-2.5 py-1.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-semibold transition">📋 คัดลอก</button>
            </div>
            <div class="text-[11px] text-emerald-800">ตัวอย่างเรียกใช้: <code>curl -H "X-API-Key: <?= htmlspecialchars($newlyIssuedKey['apiKey']) ?>" "<?= htmlspecialchars($baseSubUrl . '/endpoint.php?r=/api/public/agency/traffy?agency=pao') ?>"</code></div>
          </div>
        <?php endif; ?>

        <form method="POST" class="flex flex-wrap gap-2 items-end">
          <input type="hidden" name="_csrf" value="<?= htmlspecialchars($setupCsrfToken) ?>">
          <?php if ($alreadyConfigured && !$isLocalRequest): ?>
            <div class="w-full">
              <input type="password" name="CURRENT_DB_PASS" value="" required placeholder="รหัสผ่าน DB เดิมก่อนออก Key" class="w-full border border-amber-300 rounded-lg px-2.5 py-1.5 text-xs bg-white">
            </div>
          <?php endif; ?>
          <div class="flex-1 min-w-[200px]">
            <label class="block font-semibold text-slate-700 mb-1">ชื่อหน่วยงานผู้ขอใช้งาน API</label>
            <input type="text" name="agencyName" required maxlength="80" placeholder="เช่น สนง.ปภ.จังหวัดลำปาง / ศูนย์อุทกฯ ภาคเหนือ" class="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white">
          </div>
          <div class="w-36">
            <label class="block font-semibold text-slate-700 mb-1">Rate Limit / นาที</label>
            <input type="number" name="rateLimit" value="600" min="60" max="3000" step="60" class="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white">
          </div>
          <button type="submit" name="action" value="issue_agency_key" class="px-4 py-2 rounded-lg bg-violet-700 hover:bg-violet-800 text-white font-semibold transition">➕ ออก API Key</button>
        </form>

        <div class="bg-white border border-violet-200 rounded-lg overflow-hidden">
          <?php if (empty($agencyKeys)): ?>
            <div class="p-3 text-slate-500 text-center">ยังไม่มี API Key ที่ออกให้หน่วยงานภายนอก</div>
          <?php else: ?>
            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse text-[11px]">
                <thead class="bg-violet-100/70 text-violet-950">
                  <tr>
                    <th class="px-3 py-2 font-semibold">หน่วยงาน</th>
                    <th class="px-3 py-2 font-semibold">Prefix</th>
                    <th class="px-3 py-2 font-semibold">Rate Limit</th>
                    <th class="px-3 py-2 font-semibold">สถานะ</th>
                    <th class="px-3 py-2 font-semibold">ใช้งานล่าสุด</th>
                    <th class="px-3 py-2 font-semibold text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  <?php foreach (array_reverse($agencyKeys) as $ak): ?>
                    <tr>
                      <td class="px-3 py-2 font-medium text-slate-800"><?= htmlspecialchars($ak['agencyName']) ?></td>
                      <td class="px-3 py-2 font-mono text-slate-600"><?= htmlspecialchars($ak['keyPrefix']) ?></td>
                      <td class="px-3 py-2"><?= (int)$ak['rateLimit'] ?> / นาที</td>
                      <td class="px-3 py-2">
                        <?php if (!empty($ak['active'])): ?>
                          <span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">ใช้งานอยู่</span>
                        <?php else: ?>
                          <span class="px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 font-semibold">เพิกถอนแล้ว</span>
                        <?php endif; ?>
                      </td>
                      <td class="px-3 py-2 text-slate-500"><?= htmlspecialchars((string)($ak['lastUsedAt'] ?: $ak['createdAt'] ?: '-')) ?></td>
                      <td class="px-3 py-2 text-right">
                        <?php if (!empty($ak['active'])): ?>
                          <form method="POST" class="inline-flex items-center gap-1">
                            <input type="hidden" name="_csrf" value="<?= htmlspecialchars($setupCsrfToken) ?>">
                            <?php if ($alreadyConfigured && !$isLocalRequest): ?>
                              <input type="password" name="CURRENT_DB_PASS" value="" required placeholder="รหัส DB" class="w-24 border border-amber-300 rounded px-1.5 py-0.5 text-[11px]">
                            <?php endif; ?>
                            <input type="hidden" name="keyId" value="<?= htmlspecialchars($ak['id']) ?>">
                            <button type="submit" name="action" value="revoke_agency_key" onclick="return confirm('ยืนยันเพิกถอน API Key ของ <?= htmlspecialchars($ak['agencyName'], ENT_QUOTES) ?> ?')" class="px-2 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white font-semibold transition">🛑 เพิกถอน</button>
                          </form>
                        <?php else: ?>
                          <span class="text-slate-400">—</span>
                        <?php endif; ?>
                      </td>
                    </tr>
                  <?php endforeach; ?>
                </tbody>
              </table>
            </div>
          <?php endif; ?>
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
