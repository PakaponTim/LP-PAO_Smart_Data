# การเชื่อมต่อและแก้ปัญหาเรื่องร้องเรียน Traffy Fondue (`Water_System2` PHP v2)

## สถาปัตยกรรมปัจจุบัน (ไม่ต้องใช้ Chrome Extension แล้ว)

ตั้งแต่เวอร์ชัน **PHP v2 (`d:\Water_System2`)** ระบบเปลี่ยนมาดึงข้อมูล Traffy Fondue แบบ **Pure Server-to-Server API** โดยตรงจาก PHP (`php_server/collectors.php`) และ GitHub Actions (`php_server/github_collect_snapshot.php`) โดย **ไม่พึ่งพา Chrome Extension หรือ Puppeteer** อีกต่อไป

### ลำดับความสำคัญของการเชื่อมต่อใน `get_traffy_request_plan()`

1. **Authenticated Feed (`https://api.traffy.in.th/postgrest/rpc/get_user_all_orgs_feed`):**
   - ใช้เมื่อผู้ดูแลวาง JWT Token / `local_login_data` หรือ Cookie จาก `citydata.traffy.in.th` ลงในแผง **ตั้งค่า Traffy Session / Token (`#traffySessionPanel`)** บนหน้า Dashboard
   - ข้อมูลที่บันทึกถูกเก็บอย่างปลอดภัยใน `runtime/php_7000/notification_secrets.json` (ป้องกันการเข้าถึงตรงจากเว็บด้วย `.htaccess`)
   - ระบบอ่านค่า `exp` จาก JWT อัตโนมัติ และส่งแจ้งเตือนเมื่ออายุ Token เหลือน้อยกว่า **48 ชั่วโมง** หรือหมดอายุแล้ว
2. **Organization Public GeoJSON (`https://api.traffy.in.th/public/rpc/geojson`):**
   - ใช้เมื่อกำหนดค่า **Org ID / UUID** ของหน่วยงานที่เปิดเผยข้อมูลสาธารณะ (เช่น `org_id` หรือ `uuid` ของหน่วยงานในจังหวัดลำปาง) — ไม่ต้องใช้ Token และไม่หมดอายุ
3. **Public Unauthenticated Fallback (`https://publicapi.traffy.in.th/teamchadchart-stat-api/geojson/v1?text=ลำปาง`):**
   - ใช้งานอัตโนมัติเมื่อไม่ได้ตั้งค่า Token/Org ID พร้อมตัวจับเวลาแยก (**14 วินาที**) และจัดการคิว **Auto-Retry Queue** เพื่อไม่ให้ถ่วง 4 ด้านหลัก (ระดับน้ำ, ฝน, อ่างเก็บน้ำ, PM 2.5)

### แนวทาง Automation 100% (ไม่ต้องกลับมา Login LINE ทุก 30 วัน)

- เนื่องจาก `citydata.traffy.in.th` รองรับเฉพาะ **OAuth Social Login** (LINE / Facebook / Google) และไม่มี Refresh Token API สำหรับ `fondue_token`
- เพื่อการทำงานอัตโนมัติ 24 ชม. แบบถาวรโดยไม่ต้อง Login LINE ซ้ำทุก 30 วัน แนะนำขอรับสิทธิ์ **Traffy Fondue Exchange API** (`get-auth` สำหรับต่อ Bearer Token อัตโนมัติ + **Real-time Webhooks**) หรือขอ **`org_id`/`uuid` สาธารณะ** ในนามหน่วยงาน (อบจ.ลำปาง) จากทีมผู้ดูแล Traffy Fondue (สวทช.)

### การทดสอบ Traffy & Session E2E

```powershell
# 1. ทดสอบ Unit + Integration Session & Traffy Endpoints
C:\laragon\bin\php\php-7.2.19-Win32-VC15-x64\php.exe tests\verify_traffy_session_e2e.php

# 2. ทดสอบผ่าน API สดบน Port 7000
# GET  http://127.0.0.1:7000/endpoint.php?r=/api/traffy/session-status
# POST http://127.0.0.1:7000/endpoint.php?r=/api/traffy/test-session
```

---

## บันทึกย้อนหลัง (ยุค Chrome Extension / Node.js เดิม — ยกเลิกใช้งานใน v2)

<details>
<summary>คลิกเพื่อดูบันทึกการแก้ปัญหาเดิมเมื่อวันที่ 25 กันยายน 2569 (Legacy Chrome Extension + Puppeteer)</summary>

- สาเหตุที่พบในระบบรุ่น Node.js เดิม: หน้า Chrome แสดงเรื่องร้องเรียน 20 เรื่อง แต่แผง Traffy Extension ไม่ได้จับคู่ Socket กับ backend จึงส่งข้อมูลไม่ได้ และ Puppeteer เปิดเบราว์เซอร์ใหม่ไม่มีสถานะ Login ทำให้ถูกส่งไป `/login`
- ปัจจุบันใน `Water_System2` รุ่น PHP v2 ได้ย้ายมาใช้ Direct Server-to-Server API + GitHub Cloud Collector + Auto-Retry Queue ทั้งหมดแล้ว

</details>
