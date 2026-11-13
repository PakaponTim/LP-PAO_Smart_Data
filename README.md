# Water System

ระบบข้อมูลน้ำ ฝน อ่างเก็บน้ำ PM2.5 และเรื่องร้องเรียน ใช้ Node.js / Express / MySQL และ Chrome Extensions

## เริ่มใช้งาน

1. ใช้ `.env` เดิมสำหรับ `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME` และ SMTP
2. ติดตั้ง dependency ด้วย `npm.cmd ci` (Windows PowerShell ใช้ `npm.cmd` หาก `npm.ps1` ถูกบล็อก)
3. รัน `node scripts/migrate.mjs` เพื่อสร้างตารางเพิ่มเติม โดยไม่ลบหรือแก้ข้อมูลเก่า
4. รัน `npm.cmd start` หรือ `node --expose-gc server.js`
5. ครั้งแรกเปิดลิงก์ `setup.html#...` ที่เซิร์ฟเวอร์แสดง บนเครื่องเซิร์ฟเวอร์ กรอกอีเมล/ชื่อผู้ใช้และรหัสผ่านอย่างน้อย 12 ตัวอักษรเอง
6. เข้าสู่ระบบที่ `http://localhost:7000/login.html`

ค่าเริ่มต้นรับการเชื่อมต่อบน `127.0.0.1` เท่านั้น การใช้งานผ่านเครือข่ายต้องกำหนด `HOST`, `ALLOWED_ORIGINS` และใช้ HTTPS พร้อม `COOKIE_SECURE=true` ให้เหมาะกับ deployment

## สิทธิ์

- **admin**: จัดการบัญชี อุปกรณ์ และการตั้งค่าแจ้งเตือน รวมถึงคำสั่งเจ้าหน้าที่
- **operator**: ดูข้อมูล สั่งเก็บข้อมูล ตั้งเวลา ติดตามเหตุ และลองงานที่ล้มเหลวใหม่
- **viewer**: ดูข้อมูลเท่านั้น
- **collector**: กุญแจเฉพาะ Extension ส่งข้อมูล/heartbeat ได้ ไม่สามารถอ่านข้อมูลระบบหรือเปลี่ยนการตั้งค่า

บัญชีใช้รหัสผ่านที่ผ่าน scrypt พร้อม salt แยกรายคน เซสชันเก็บในหน่วยความจำ มีอายุ 8 ชั่วโมง และยกเลิกเมื่อรีสตาร์ต รหัสอุปกรณ์เก็บเฉพาะ hash ฝั่งเซิร์ฟเวอร์ ข้อมูลใน `runtime/security/` ต้องจำกัดสิทธิ์ไฟล์และรวมอยู่ในแผนสำรองของผู้ดูแล

อีเมล/ชื่อผู้ใช้สำหรับ Login แยกจาก SMTP สำหรับส่งแจ้งเตือน ไม่ต้องส่งรหัสผ่านลงแชท

## จับคู่ Chrome Extensions หลังอัปเดต

1. เปิด `chrome://extensions` และกด Reload ของ `01System_Water` และ `04ext_TraffyLP`
2. เปิดหน้าตัวเลือก (Extension options) ของแต่ละตัว
3. กำหนด server URL แล้วใช้บัญชีผู้ดูแลเพื่อจับคู่ รหัสผ่านไม่ถูกบันทึกใน Extension
4. อนุญาตการเข้าถึงเซิร์ฟเวอร์ และโหลดหน้าแหล่งข้อมูลใหม่
5. ตรวจสถานะเชื่อมต่อบน Dashboard สามารถเพิกถอนกุญแจที่หน้า **จัดการบัญชี**

## การบันทึกและกู้คืน

- แต่ละ request ใช้ `X-Ingest-Key` เดิมเมื่อลอง request เดิมใหม่ ต้องไม่ใช้ key เดียวกับข้อมูลคนละชุด
- Ledger `app_ingest_batches` และแถวข้อมูล commit ใน transaction เดียวกัน ป้องกันการบันทึกซ้ำเมื่อไม่ทราบผล commit
- บันทึก MySQL ก่อน แล้วเก็บงาน Excel ลง outbox บนดิสก์ เขียนรวมตามประเภททุก 30 วินาที
- `database: saved, excel: queued` หมายถึง DB สำเร็จแต่ Excel ยังรอ ไม่ใช่ทั้งสองปลายทางสำเร็จแล้ว
- Excel ใช้ไฟล์ชั่วคราวแล้ว rename และมีชีตซ่อน `_ingest_batches` ป้องกันการเขียน batch เดิมซ้ำหลังรีสตาร์ต
- หากไฟล์ Excel เปิดค้าง งานยังอยู่ในคิว ปิดไฟล์แล้วกด **ลองงานสำรองอีกครั้ง** ที่ `/operations.html`
- ถ้า DB ไม่สำเร็จ ระบบพยายามสำรอง Excel และเก็บ payload ไว้ใน `runtime/ingest-recovery.json` ให้เจ้าหน้าที่ส่งเข้าฐานข้อมูลอีกครั้งได้
- การเก็บ payload ที่ล้มเหลวไม่ใช่การย้อนดึงข้อมูลที่ไม่เคยได้รับจากต้นทาง ฟังก์ชัน backfill ต้นทางย้อนหลังยังไม่มี

## นิยามข้อมูล

รายละเอียดอยู่ใน `/api/data-definitions` และ [บันทึกการปรับปรุง](docs/implementation-2026-09-07.md)

- `recorded_at` เป็นเวลารับเข้าระบบ ไม่ใช่เวลาวัดต้นทาง
- ชื่อคอลัมน์เดิม `forecast_rain_24h_mm` ยังคงไว้เพื่อไม่เปลี่ยนข้อมูลเก่า แต่ scraper ที่ตรวจพบอ่าน **ฝนสะสมย้อนหลัง 3 วัน** API Dashboard ใช้ชื่อ `rainfall_accum_3d_mm`
- ไม่บวกฝนรายวันกับฝนสะสม 3 วัน เพราะช่วงเวลาซ้อนกัน
- ปริมาณน้ำในอ่างรายวันรวมค่าล่าสุดของแต่ละอ่าง ไม่รวมทุกรอบของวัน
- ประวัติสถานะเรื่องร้องเรียนเริ่มบันทึกใน `app_complaint_events` หลังอัปเดตนี้
- การตรวจข้อมูลขาดใช้ปฏิทิน Asia/Bangkok สถานีอ้างอิงจากประวัติที่มี วันปัจจุบันแสดงว่ายังรอข้อมูล

## โครงสร้าง

```text
server.js                       ประกอบระบบและ API เดิม
backend/collectors/              ตัวดึงข้อมูลเว็บไซต์
backend/repositories/            MySQL transaction และ Excel
backend/services/                สิทธิ์ คิว cache metrics นิยามข้อมูล
backend/routes/                  รับข้อมูลและติดตามงาน
backend_ui/                      หน้าใช้งานจริง
backend_ui/js/                   JavaScript ที่แยกจากหน้า HTML เดิม
backend_ui/css/                  CSS ที่แยกจากหน้า HTML เดิม
01System_Water/                  Extension ข้อมูลสิ่งแวดล้อม
04ext_TraffyLP/                  Extension เรื่องร้องเรียน
tests/                          ทดสอบสิทธิ์ transaction คิว และนิยามข้อมูล
scripts/                        build, migration, benchmark
runtime/                        ข้อมูลภายในและผล benchmark ไม่เปิดผ่านเว็บ
.work-backups/                   สำเนา source ก่อนปรับปรุง ไม่เปิดผ่านเว็บ
```

`src/`, `index.html` ที่ root และ `vite.config.js` เป็นชุดเดิม ยังเก็บไว้ แต่ `npm.cmd dev` ใช้ Express ที่มีการตรวจสิทธิ์แล้ว `npm.cmd build` สร้างเฉพาะไฟล์ UI ที่อนุญาตใน `dist/water-ui` ห้ามเปิด UI เป็น static public site เพื่อเลี่ยงการตรวจสิทธิ์

## ตรวจสอบ

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run build
npm.cmd run benchmark

# ทดสอบกับ MySQL โดยสร้าง schema ชั่วคราวแยกจากข้อมูลจริง แล้วลบเฉพาะ schema ทดสอบ
$env:WATER_DB_TEST='1'
node --test tests/*.test.js
```

Benchmark อ่านฐานข้อมูลจริง แต่เขียน Excel เฉพาะไฟล์ทดสอบใน temporary directory ไม่เขียนทับ workbook จริง

ยังต้องทดสอบการจับคู่ Extension และรอบเก็บข้อมูลกับหน้าเว็บต้นทางจริงหลังผู้ดูแลตั้งค่าบัญชี ไม่ควรใช้ความสำเร็จของ unit/integration tests แทนการตรวจนี้
