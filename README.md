# Water_System2 — ระบบบูรณาการข้อมูลภัยพิบัติและเรื่องร้องเรียน อบจ.ลำปาง

ระบบติดตามสถานการณ์น้ำ ปริมาณฝน อ่างเก็บน้ำ/ภัยแล้ง ฝุ่น PM 2.5 และเรื่องร้องเรียน Traffy Fondue จังหวัดลำปาง  
ทำงานด้วย **PHP 100% + MySQL (`water_system2`, 10 ตาราง) + `curl_multi` Parallel Collector + Smart Sleep Scheduler + GitHub Actions Cloud Collector** (แยกขาดจากระบบเดิมบน Port 3000 และ **ไม่ต้องใช้ Chrome Extension**)

---

## จุดเด่นของระบบ (v2 + Subdomain 24/7 Ready)

- **⚡ Direct PHP API (`curl_multi`):** ดึงข้อมูล 5 ด้านพร้อมกันแบบ Server-to-Server จบใน ~1.5–4 วินาที และแยก Timeout ของ Traffy ออกจาก 4 ด้านหลัก
- **📊 ความแม่นยำตรงตารางต้นทาง (Shared Transformer [`php_server/collectors_transform.php`](php_server/collectors_transform.php)):**
  - สถานะระดับน้ำ `"ปกติ"` → `"น้ำปกติ"` (แก้กรณีข้อมูลคลาดเคลื่อนระหว่าง Direct / GitHub Sync)
  - จัดรูปแบบชื่ออำเภอ จ.ลำปาง ไม่ให้ซ้ำคำว่า `"ลำปาง"` (`format_lampang_amphoe`)
  - ดึง **ฝนสะสม 3 วัน (`rain3d`)** ลงคอลัมน์ `forecast_rain_24h_mm` ตรงกับชุดข้อมูลเดิม
  - คงค่า `pm25_avg_24h = null` เมื่อสถานีไม่มีข้อมูลจริง (ไม่แทนด้วย `0`)
- **📋 System Log Center v2 (`tbl_system_logs`):**
  - แสดงสถานะ **สำเร็จ / บางส่วน / ไม่สำเร็จ + วัน-เวลาที่ทำงานชัดเจน**
  - **Heatmap 48 ช่องรายวัน** (`GET /api/system-logs/heatmap`)
  - **Auto-Retry Queue** แบบ Non-blocking เมื่อบางโมดูลล้มเหลว (`POST /api/system-logs/retry`)
  - **Upstream Data Freshness Monitor:** แจ้งเตือน "ข้อมูลต้นทางค้าง" เมื่อเกิน **6 ชม.** (น้ำ/ฝน/PM 2.5) หรือ **36 ชม.** (อ่างเก็บน้ำรายวัน) ผ่าน `GET /api/data-freshness`
  - **Notification & Export Audit Logs + Export CSV** (`GET /api/system-logs/export`)
- **🛡️ การบริหารความเสี่ยง Server 24 ชม. (Subdomain / Folder Hosting):**
  - ไฟล์ `.htaccess` ป้องกันการเข้าถึงความลับ 4 จุด (`./`, `php_server/`, `cloud_snapshots/`, `runtime/`)
  - `with_file_lock()` & `update_json_file_atomic()` ป้องกันไฟล์ JSON พังจากการเขียนชนกัน
  - **Log Rotation (5 MB) + Housekeeping ลบ Log เก่าเกิน 30 วันอัตโนมัติ**
  - `GET /api/health` (`endpoint.php?r=/api/health`) สำหรับ Uptime Monitor
  - `server_setup.php` ซ่อนรหัสผ่าน MySQL และยืนยันรหัสเดิมก่อนแก้ไขจาก IP ภายนอก
- **🔐 Session & Traffy Direct API:**
  - **Sliding Session (`AUTH_SESSION_DAYS=30`)** ต่ออายุ Cookie `water_session_7000` (`HttpOnly; SameSite=Strict`) อัตโนมัติเมื่อมีการใช้งาน (ตั้งปิด/เปิดการบังคับ Login ผ่าน `WATER_PHP_AUTH_ENFORCE`)
  - รองรับ Traffy Public API, `org_id`/`uuid` สาธารณะ, LINE Token ใน `#traffySessionPanel` (แจ้งเตือนล่วงหน้าเมื่อเหลือน้อยกว่า 48 ชม.) และพร้อมต่อยอด Traffy Exchange API / Webhook

---

## เริ่มใช้งานบนเครื่อง (Localhost Port 7000)

1. ตรวจสอบ MySQL และไฟล์ `.env` (ตั้ง `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME=water_system2`)
2. เริ่มเว็บเซิร์ฟเวอร์ PHP:
   - เปิดไฟล์ `start_php_7000.bat` หรือรัน:
     ```powershell
     C:\laragon\bin\php\php-7.2.19-Win32-VC15-x64\php.exe -S 127.0.0.1:7000 php_server\router.php
     ```
3. (ไม่บังคับ) เปิด Smart Sleep Scheduler 24 ชม. ในโหมด CLI:
   ```powershell
   C:\laragon\bin\php\php-7.2.19-Win32-VC15-x64\php.exe php_server\scheduler.php
   ```
4. เปิดเบราว์เซอร์:
   - Dashboard & System Log Center: `http://127.0.0.1:7000/index.html`
   - คู่มือใช้งานและชุดทดสอบสดบนหน้าเว็บ: `http://127.0.0.1:7000/guide.html`
   - ตั้งค่า Gmail SMTP & LINE Messaging API: `http://127.0.0.1:7000/notification.html`

---

## Step-by-Step Push โค้ดขึ้น GitHub (`PakaponTim/Water_System2`)

> ⚠️ **สำคัญก่อน Push:** ระบบ GitHub Actions (`.github/workflows/collect_every_30min.yml`) จะ Commit ไฟล์เข้า `cloud_snapshots/` บน Branch `main` ทุก 30 นาที **จึงควร Pull Rebase ก่อน Push เสมอ** และห้าม Push ไฟล์ความลับ (`.env`, `runtime/`, `deploy_server/`, `*.zip`)

### ขั้นตอนที่ 1: ตรวจสอบสถานะไฟล์และความปลอดภัยก่อน Push
```powershell
cd D:\Water_System2
C:\laragon\bin\git\bin\git.exe status --short
```
- ตรวจให้แน่ใจว่าไม่มีไฟล์ `.env`, `runtime/`, `deploy_server/` หรือไฟล์รหัสผ่านติดในรายการเปลี่ยนแปลง
- หาก `task_history.json` หรือ `config.json` เปลี่ยนแปลงจากการรันทดสอบอัตโนมัติในเครื่องและยังไม่ต้องการรวมใน Commit ให้รีเซ็ตก่อน:
  ```powershell
  C:\laragon\bin\git\bin\git.exe checkout -- task_history.json config.json
  ```

### ขั้นตอนที่ 2: ดึง Snapshot ล่าสุดจาก GitHub มารวมก่อน (`pull --rebase`)
```powershell
C:\laragon\bin\git\bin\git.exe pull --rebase --autostash origin main
```
- ช่วยป้องกัน Error `! [rejected] main -> main (non-fast-forward)` เมื่อ GitHub Actions Bot เพิ่งบันทึก Snapshot รอบล่าสุดไว้บน GitHub

### ขั้นตอนที่ 3: Stage, Commit และ Push ขึ้น GitHub
```powershell
# 1. Stage ไฟล์โค้ด คู่มือ การตั้งค่าความปลอดภัย และชุดทดสอบ
C:\laragon\bin\git\bin\git.exe add -A

# 2. สร้าง Commit
C:\laragon\bin\git\bin\git.exe commit -m "feat(v2): system log center, 24/7 safeguards, traffy direct api & updated manual"

# 3. Push ขึ้น GitHub
C:\laragon\bin\git\bin\git.exe push -u origin main
```
*(หรือหลัง Commit แล้ว สามารถดับเบิ้ลคลิก **`push_to_github.bat`** ซึ่งจัดการ `pull --rebase --autostash` และ `push` ให้ในตัว)*

- หากขึ้นถาม Username / Password บน Windows:
  - **Username:** `PakaponTim`
  - **Password:** สร้าง **Personal Access Token (Classic)** ที่ [github.com/settings/tokens/new](https://github.com/settings/tokens/new) โดยติ๊กช่อง **`repo`** และ **`workflow`** แล้วนำรหัส `ghp_...` มาวางช่อง Password

### ขั้นตอนที่ 4: ยืนยันผลบน GitHub & Subdomain Server
1. เปิดแท็บ **Actions** บน GitHub → เลือก **Water_System2 Cloud Collector (Every 30 Minutes)** → กด **Run workflow** เพื่อทดสอบให้ขึ้นเครื่องหมายถูกสีเขียว
2. (กรณีมี Subdomain Server แล้ว) เข้า **Settings → Secrets and variables → Actions** เพิ่ม Secret ชื่อ `WATER_SERVER_CRON_URL` ชี้ไปยัง `https://your-subdomain/Water_System2/cron.php`
3. สร้างแพ็กเกจปลอดความลับสำหรับนำไปแตกไฟล์วางบน Subdomain Server:
   ```powershell
   C:\laragon\bin\php\php-7.2.19-Win32-VC15-x64\php.exe php_server\build_server_package.php
   ```
   จะได้โฟลเดอร์ `deploy_server/Water_System2/` และไฟล์ `deploy_server/Water_System2_Server_Deploy.zip` พร้อมวางบน Server แล้วเปิด `server_setup.php`

---

## ชุดคำสั่งทดสอบระบบทั้งหมด (Verification Suite)

```powershell
# 1. ตรวจ Syntax ของ PHP และ JS
C:\laragon\bin\php\php-7.2.19-Win32-VC15-x64\php.exe -l php_server\api.php
C:\laragon\bin\php\php-7.2.19-Win32-VC15-x64\php.exe -l php_server\collectors.php
C:\laragon\bin\php\php-7.2.19-Win32-VC15-x64\php.exe -l php_server\system_log.php
C:\laragon\bin\php\php-7.2.19-Win32-VC15-x64\php.exe -l server_setup.php
node --check js\index-3.js
node --check js\index-4.js
node --check js\control-2.js

# 2. รัน Automated Test Suites (System v2 + Traffy & Session E2E)
C:\laragon\bin\php\php-7.2.19-Win32-VC15-x64\php.exe tests\verify_system_v2.php
C:\laragon\bin\php\php-7.2.19-Win32-VC15-x64\php.exe tests\verify_traffy_session_e2e.php

# 3. สร้างและตรวจความปลอดภัยแพ็กเกจ Deploy (ยืนยัน 0 Secrets)
C:\laragon\bin\php\php-7.2.19-Win32-VC15-x64\php.exe php_server\build_server_package.php
```

---

## โครงสร้างไฟล์หลักของระบบ (PHP v2)

```text
php_server/
  config.php                 การตั้งค่า, .env/db_config, Schema 10 ตาราง, File Lock & Rotation
  auth.php                   Sliding Session 30 วัน, Cookies, Device Pairing
  collectors.php             curl_multi 5 APIs + Traffy Session/JWT Tester
  collectors_transform.php   ตัวแปลงมาตรฐานข้อมูล (ใช้ร่วมกันทั้ง Direct & GitHub Sync)
  system_log.php             System Log Center v2, Heatmap 48 ช่อง, Retry Queue, Freshness, Health
  notifier.php               Gmail SMTP + LINE Messaging API + Operational Alerts
  scheduler.php              Smart Sleep CLI Daemon
  api.php                    REST API หลักทุกเส้นทาง + CSV Export
  github_collect_snapshot.php  สคริปต์ดึงข้อมูลบน GitHub Actions
  github_sync_to_mysql.php     ซิงก์ Snapshot จาก GitHub ลง MySQL (Contents API / Raw Fallback)
  build_server_package.php     สร้างแพ็กเกจ deploy_server/Water_System2 + .zip ปลอดความลับ
endpoint.php / index.php     ตัวชี้เส้นทางสำหรับ Drop-in Subfolder / Subdomain
server_setup.php             Wizard ตั้งค่า MySQL + ตรวจสอบความปลอดภัย Server 24 ชม.
cron.php / worker.php        จุดเรียกเก็บข้อมูลและตัวจัดการ Web Worker
guide.html                   คู่มือการใช้งานและหน้าทดสอบสด Interactive Checklist
tests/                       Automated E2E & Integration Test Suites
.htaccess                    ป้องกันไฟล์ลับข้ามโฟลเดอร์ (Root, php_server, cloud_snapshots, runtime)
```
