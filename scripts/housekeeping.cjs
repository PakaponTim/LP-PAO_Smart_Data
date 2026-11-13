const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const archiveScratchDir = path.join(rootDir, 'archive_scratch');
const reportsArchiveDir = path.join(rootDir, 'reports_archive');
const backendUiDebugDir = path.join(archiveScratchDir, 'backend_ui_debug');

[archiveScratchDir, reportsArchiveDir, backendUiDebugDir].forEach(d => {
  if (!fs.existsSync(d)) {
    fs.mkdirSync(d, { recursive: true });
  }
});

// 1. Move Reports
const reportFiles = [
  'performance_evaluation_document.docx',
  'การจัดทำรายงาน.docx',
  'รายงานสรุปวิเคราะห์ข้อมูล (กรกฎาคม 2569)_V.1.0.docx',
  'รายงานสรุปวิเคราะห์ข้อมูล (สิงหาคม 2569).docx',
  'รายงานสรุปวิเคราะห์ข้อมูลรายเดือน_กรกฎาคม2569_1785725615117.docx',
  'รายงานสรุปวิเคราะห์ข้อมูลรายเดือน_มิถุนายน2569_1782878358379.docx',
  'รายงานสรุปวิเคราะห์ข้อมูลรายเดือน_มิถุนายน2569_2026-07-01T04-09-10.docx',
  'รายงานสรุปโครงการ_Water_System_Complete.docx',
  'เอกสารสรุปสำหรับกรรมการ_ระบบบูรณาการข้อมูล_อบจลำปาง.docx',
  'เอกสารสรุปสำหรับกรรมการ_ระบบบูรณาการข้อมูล_อบจลำปาง.pdf'
];

reportFiles.forEach(f => {
  const src = path.join(rootDir, f);
  const dest = path.join(reportsArchiveDir, f);
  if (fs.existsSync(src)) {
    fs.renameSync(src, dest);
    console.log(`Moved report to reports_archive: ${f}`);
  }
});

// 2. Move Scratch scripts from root
const scratchFiles = [
  'alter_db.js',
  'capture_html.js',
  'check_headers.js',
  'delete_test.js',
  'fix_db.js',
  'test_all_posts.js',
  'test_concurrent.js',
  'test_db.js',
  'test_hang.js',
  'test_http.js',
  'test_post.js',
  'test_sql.js',
  'test_traffy_scrape.js',
  'view_db.js',
  'fix_classes.cjs',
  'fix_db.cjs',
  'recover.cjs',
  'inject_dark_mode.cjs',
  'traffy_filtered.png',
  'traffy_init.png',
  'wl_page.html'
];

scratchFiles.forEach(f => {
  const src = path.join(rootDir, f);
  const dest = path.join(archiveScratchDir, f);
  if (fs.existsSync(src)) {
    fs.renameSync(src, dest);
    console.log(`Moved scratch to archive_scratch: ${f}`);
  }
});

// 3. Move backend_ui debug files
const backendUiDir = path.join(rootDir, 'backend_ui');
if (fs.existsSync(backendUiDir)) {
  const uiFiles = fs.readdirSync(backendUiDir);
  const uiDebugFiles = uiFiles.filter(f => 
    f.startsWith('check') || 
    f.startsWith('test_script') || 
    f.includes('.cleaned') || 
    f.endsWith('.bak')
  );
  
  uiDebugFiles.forEach(f => {
    const src = path.join(backendUiDir, f);
    const dest = path.join(backendUiDebugDir, f);
    fs.renameSync(src, dest);
    console.log(`Moved backend_ui debug file: ${f}`);
  });
}

// 4. Remove empty directories
['02ext_drought', '03ext_PM2.5'].forEach(d => {
  const dirPath = path.join(rootDir, d);
  if (fs.existsSync(dirPath)) {
    const files = fs.readdirSync(dirPath);
    if (files.length === 0) {
      fs.rmdirSync(dirPath);
      console.log(`Removed empty directory: ${d}`);
    }
  }
});

console.log('Housekeeping completed successfully!');
