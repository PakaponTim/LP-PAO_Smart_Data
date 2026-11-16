<?php
// =========================================================================
// Water_System2 — Web Setup Wizard for Server Deployment (Zero-Admin)
// Open: http://ชื่อเซิร์ฟเวอร์/Water_System2/server_setup.php
// Lets you configure the Server's MySQL credentials, auto-create all 9 tables,
// and run an initial data collection directly from the browser!
// =========================================================================

$phpServerDir = is_dir(__DIR__ . '/php_server') ? __DIR__ . '/php_server' : dirname(__DIR__) . '/php_server';
require_once $phpServerDir . '/config.php';

$message = '';
$statusType = '';
$dbOverrideFile = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'db_config.json';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? 'save_db';
    if ($action === 'save_db') {
        $newCfg = [
            'DB_HOST' => trim($_POST['DB_HOST'] ?? 'localhost'),
            'DB_PORT' => trim($_POST['DB_PORT'] ?? '3306'),
            'DB_NAME' => trim($_POST['DB_NAME'] ?? 'water_system2'),
            'DB_USER' => trim($_POST['DB_USER'] ?? 'root'),
            'DB_PASS' => $_POST['DB_PASS'] ?? '',
            'GITHUB_SYNC_REPO' => trim($_POST['GITHUB_SYNC_REPO'] ?? 'PakaponTim/Water_System2')
        ];
        write_json_file($dbOverrideFile, $newCfg);
        foreach ($newCfg as $k => $v) {
            $ENV_VARS[$k] = $v;
        }
        try {
            // Clear schema cache flag to force table verification
            $flagFile = WATER_SYSTEM2_RUNTIME_DIR . DIRECTORY_SEPARATOR . 'schema_ready_' . preg_replace('/[^a-zA-Z0-9_]/', '', $newCfg['DB_NAME']) . '.flag';
            @unlink($flagFile);
            $pdo = get_db();
            $statusType = 'success';
            $message = "✅ เชื่อมต่อฐานข้อมูล MySQL ({$newCfg['DB_NAME']}) และสร้างตารางครบทั้ง 9 ตารางบน Server สำเร็จแล้ว!";
        } catch (Throwable $e) {
            $statusType = 'error';
            $message = "❌ เชื่อมต่อฐานข้อมูลไม่สำเร็จ: " . $e->getMessage();
        }
    }
}

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
          <p class="text-[11px] text-slate-400 mt-1">ระบบจะสร้างตารางทั้ง 9 ตารางให้อัตโนมัติทันทีที่กดบันทึก</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">MySQL Username</label>
            <input type="text" name="DB_USER" value="<?= htmlspecialchars($curUser) ?>" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" required>
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">MySQL Password</label>
            <input type="password" name="DB_PASS" value="<?= htmlspecialchars($curPass) ?>" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
          </div>
        </div>

        <div>
          <label class="block text-xs font-semibold text-slate-600 mb-1">GitHub Repository สำหรับซิงค์ข้อมูลสำรอง 24 ชม.</label>
          <input type="text" name="GITHUB_SYNC_REPO" value="<?= htmlspecialchars($curRepo) ?>" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
        </div>

        <div class="flex flex-wrap gap-3 pt-2">
          <button type="submit" class="bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition">
            💾 บันทึกค่าและสร้างตารางฐานข้อมูลอัตโนมัติ
          </button>
          <a href="./cron.php" target="_blank" class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition">
            🚀 ทดสอบดึงข้อมูลทุกโปรเจคเข้า Server ทันที (cron.php)
          </a>
        </div>
      </form>
    </div>
  </div>
</body>
</html>
