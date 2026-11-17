<?php
// Builds a clean, lightweight ready-to-upload Server package inside deploy_server/Water_System2/
// plus Water_System2_Server_Deploy.zip (excludes node_modules, runtime, scratch, .git, secrets).

$root = dirname(__DIR__);
$deployBase = $root . DIRECTORY_SEPARATOR . 'deploy_server';
$targetDir = $deployBase . DIRECTORY_SEPARATOR . 'Water_System2';
$zipPath = $deployBase . DIRECTORY_SEPARATOR . 'Water_System2_Server_Deploy.zip';

function copy_dir_recursive(string $src, string $dst): int {
    $count = 0;
    if (!is_dir($dst)) @mkdir($dst, 0777, true);
    $items = scandir($src);
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $s = $src . DIRECTORY_SEPARATOR . $item;
        $d = $dst . DIRECTORY_SEPARATOR . $item;
        if (is_dir($s)) {
            $count += copy_dir_recursive($s, $d);
        } else {
            copy($s, $d);
            $count++;
        }
    }
    return $count;
}

$totalFiles = 0;
foreach (['php_server', 'js', 'css', 'report_images', 'cloud_snapshots'] as $dir) {
    $src = $root . DIRECTORY_SEPARATOR . $dir;
    if (is_dir($src)) {
        $totalFiles += copy_dir_recursive($src, $targetDir . DIRECTORY_SEPARATOR . $dir);
    }
}

$rootFiles = [
    'index.php', 'index.html', 'control.html', 'notification.html',
    'operations.html', 'accounts.html', 'login.html', 'setup.html', 'guide.html', 'emergency_cloud.html', 'db_compare.html',
    'endpoint.php', 'cron.php', 'worker.php', 'server_setup.php',
    'auth-client.js', 'socketio_client.js', 'setup.js', 'accounts.js', 'operations.js',
    'config.json', 'domain_config.json', 'logo_pao.png', 'drought_standard.png', 'pm25_standard.png', 'complaints_standard.png',
    '.htaccess'
];

// Ensure runtime/.htaccess exists cleanly inside deploy package with zero secret files
$deployRuntimeDir = $targetDir . DIRECTORY_SEPARATOR . 'runtime';
if (!is_dir($deployRuntimeDir)) @mkdir($deployRuntimeDir, 0777, true);
$htRule = "<Files \"*\">\n  <IfModule mod_authz_core.c>\n    Require all denied\n  </IfModule>\n  <IfModule !mod_authz_core.c>\n    Order allow,deny\n    Deny from all\n  </IfModule>\n</Files>\n";
file_put_contents($deployRuntimeDir . DIRECTORY_SEPARATOR . '.htaccess', $htRule);
$deployPhpRuntimeDir = $deployRuntimeDir . DIRECTORY_SEPARATOR . 'php_7000';
if (!is_dir($deployPhpRuntimeDir)) @mkdir($deployPhpRuntimeDir, 0777, true);
file_put_contents($deployPhpRuntimeDir . DIRECTORY_SEPARATOR . '.htaccess', $htRule);

foreach ($rootFiles as $f) {
    $src = $root . DIRECTORY_SEPARATOR . $f;
    if (file_exists($src)) {
        copy($src, $targetDir . DIRECTORY_SEPARATOR . $f);
        $totalFiles++;
    }
}

// Create clean starter .env.example inside deploy package (without local passwords)
file_put_contents($targetDir . DIRECTORY_SEPARATOR . '.env.example',
    "DB_HOST=localhost\nDB_PORT=3306\nDB_USER=your_mysql_user\nDB_PASS=your_mysql_password\nDB_NAME=water_system2\nGITHUB_SYNC_REPO=PakaponTim/Water_System2\nGITHUB_SYNC_BRANCH=main\nPRIMARY_DOMAIN=\nBACKUP_DOMAIN=\n"
);

// Build ZIP if ZipArchive is available
$zipCreated = false;
if (class_exists('ZipArchive')) {
    @unlink($zipPath);
    $zip = new ZipArchive();
    if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) === true) {
        $it = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($targetDir, RecursiveDirectoryIterator::SKIP_DOTS)
        );
        foreach ($it as $file) {
            if ($file->isDir()) continue;
            $full = $file->getPathname();
            $rel = 'Water_System2/' . str_replace('\\', '/', substr($full, strlen($targetDir) + 1));
            $zip->addFile($full, $rel);
        }
        $zip->close();
        $zipCreated = true;
    }
}

$zipMb = ($zipCreated && file_exists($zipPath)) ? round(filesize($zipPath) / 1048576, 2) : 0;
echo "Built Server Package: {$targetDir} ({$totalFiles} files)\n";
echo $zipCreated ? "Built ZIP Archive: {$zipPath} ({$zipMb} MB)\n" : "ZipArchive extension not enabled; folder ready at {$targetDir}\n";
