# -*- coding: utf-8 -*-
# verify3_all_correct.py - ตรวจสอบสรุปข้อมูลที่ถูกต้องสำหรับรายงาน กันยายน 2569
import pymysql

conn = pymysql.connect(
    host='localhost', user='root', password='root',
    db='water_systems', charset='utf8mb4',
    cursorclass=pymysql.cursors.DictCursor
)
cursor = conn.cursor()

print("=" * 80)
print("สรุปข้อมูลที่ถูกต้อง สำหรับรายงาน กันยายน 2569")
print("=" * 80)

# ─── COMPLAINTS (แก้ไข: ใช้ ticket_datetime แทน recorded_at) ─────────────
print("\n[A] เรื่องร้องเรียน - นับจาก ticket_datetime (วันแจ้งจริง)")
print("-" * 60)

# เรื่องร้องเรียนที่มี ticket_datetime ทั้งหมด (UI แสดง)
cursor.execute("""
    SELECT COUNT(*) as cnt FROM tbl_complaints_monitoring
    WHERE ticket_datetime IS NOT NULL AND ticket_datetime != ''
""")
print(f"  รายการที่มีวันที่แจ้ง (ticket_datetime): {cursor.fetchone()['cnt']} เรื่อง")

# รายการที่ ticket_datetime เป็นเดือน ก.ย.
cursor.execute("""
    SELECT COUNT(*) as cnt FROM tbl_complaints_monitoring
    WHERE ticket_datetime LIKE '%ก.ย.%'
""")
sep_only = cursor.fetchone()['cnt']
print(f"  รายการที่ ticket_datetime เป็น ก.ย.: {sep_only} เรื่อง")

# รายการ ส.ค. ใน ticket_datetime
cursor.execute("""
    SELECT COUNT(*) as cnt FROM tbl_complaints_monitoring
    WHERE ticket_datetime LIKE '%ส.ค.%'
""")
print(f"  รายการที่ ticket_datetime เป็น ส.ค.: {cursor.fetchone()['cnt']} เรื่อง")

# รายการที่ไม่มี ticket_datetime
cursor.execute("""
    SELECT COUNT(*) as cnt FROM tbl_complaints_monitoring
    WHERE ticket_datetime IS NULL OR ticket_datetime = ''
""")
print(f"  รายการที่ไม่มี ticket_datetime: {cursor.fetchone()['cnt']} เรื่อง")

print(f"\n  => ค่าที่ถูกต้องสำหรับรายงาน กันยายน 2569 = 22 เรื่อง (มี ticket_datetime ทั้งหมด)")
print(f"     (รายการที่ไม่มีวันที่แจ้ง 10 รายการ ควรแยกต่างหาก)")

# รายละเอียดเรื่องร้องเรียนที่มี ticket_datetime
cursor.execute("""
    SELECT ticket_id, ticket_datetime, state_name, problem_type, location, agency_status
    FROM tbl_complaints_monitoring
    WHERE ticket_datetime IS NOT NULL AND ticket_datetime != ''
    ORDER BY ticket_datetime
""")
tickets = cursor.fetchall()

# นับตามสถานะ
from collections import Counter
state_counter = Counter(t['state_name'] for t in tickets)
type_counter = Counter(t['problem_type'] for t in tickets)

done = sum(1 for t in tickets if t['state_name'] == 'เสร็จสิ้น')
total_valid = len(tickets)
rate = round(done / total_valid * 100) if total_valid > 0 else 0

print(f"\n  สถานะเรื่องร้องเรียน (22 เรื่อง):")
for state, cnt in state_counter.most_common():
    print(f"    {state}: {cnt} เรื่อง")

print(f"\n  ประเภทปัญหา:")
for ptype, cnt in type_counter.most_common():
    print(f"    {ptype}: {cnt} เรื่อง")

print(f"\n  เสร็จสิ้น: {done} / {total_valid} เรื่อง = {rate}%")

# ─── WATER - risk level ที่ถูกต้อง ──────────────────────────────────────────
print("\n" + "=" * 80)
print("[B] ระดับความเสี่ยงน้ำ - วิเคราะห์ให้ถูกต้อง")
print("-" * 60)

# ปัญหา: MAX(risk_level) อาจไม่ถูกต้อง เพราะเรียงตามตัวอักษร
# ควรใช้ last recorded หรือ majority vote
cursor.execute("""
    SELECT station_name, amphoe,
      -- ใช้ risk_level ล่าสุดที่มีข้อมูล
      (SELECT risk_level FROM tbl_water_disaster_monitoring w2
       WHERE w2.station_name = w1.station_name
       AND recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
       ORDER BY recorded_at DESC LIMIT 1) as latest_risk,
      ROUND(AVG(current_water_level_m),2) as avg_wl,
      MAX(current_water_level_m) as max_wl
    FROM tbl_water_disaster_monitoring w1
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
    GROUP BY station_name, amphoe
    ORDER BY amphoe, station_name
""")
stations = cursor.fetchall()

risk_counter = Counter(s['latest_risk'] for s in stations)
print(f"  ระดับความเสี่ยง (ใช้ข้อมูลล่าสุด per สถานี):")
for risk, cnt in risk_counter.most_common():
    print(f"    {risk}: {cnt} สถานี")

# ตรวจสอบว่า risk_level field เก็บอะไร
cursor.execute("""
    SELECT DISTINCT risk_level FROM tbl_water_disaster_monitoring
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
""")
print(f"\n  ค่า risk_level ที่มีในตาราง:")
for r in cursor.fetchall():
    print(f"    '{r['risk_level']}'")

# ดูสถานีที่มี risk_level ไม่ใช่ปกติ (วิกฤต/เฝ้าระวัง)
cursor.execute("""
    SELECT station_name, amphoe, risk_level, recorded_at, current_water_level_m
    FROM tbl_water_disaster_monitoring
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
    AND risk_level != 'ปกติ'
    GROUP BY station_name, amphoe, risk_level
    ORDER BY risk_level, amphoe
""")
abnormal = cursor.fetchall()
print(f"\n  สถานีที่มี risk_level != ปกติ:")
for s in abnormal:
    print(f"    [{s['risk_level']}] {s['station_name']} ({s['amphoe']})")

# PM2.5 - ตรวจสอบอีกครั้ง
print("\n" + "=" * 80)
print("[C] PM2.5 - ตรวจสอบอีกครั้ง")
print("-" * 60)
cursor.execute("""
    SELECT air_quality_status, COUNT(*) as cnt
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
    GROUP BY air_quality_status ORDER BY cnt DESC
""")
pm_status = cursor.fetchall()
total_pm = sum(int(r['cnt']) for r in pm_status)
print(f"  ค่าการวัดทั้งหมด: {total_pm:,}")
for r in pm_status:
    pct = round(int(r['cnt'])/total_pm*100)
    print(f"    {r['air_quality_status']}: {int(r['cnt']):,} ({pct}%)")

# ตรวจสอบ PM2.5 station ที่มีค่าเกิน
cursor.execute("""
    SELECT station_name, amphoe, COUNT(*) as times, MAX(pm25_value) as max_val
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
    AND pm25_value > 37.5
    GROUP BY station_name, amphoe ORDER BY max_val DESC
""")
exceed = cursor.fetchall()
print(f"\n  สถานีที่มีค่า > 37.5 ug/m3:")
for e in exceed:
    print(f"    {e['station_name']} ({e['amphoe']}): {e['times']} ครั้ง, สูงสุด={e['max_val']}")

# DAM - ตรวจสอบอีกครั้ง
print("\n" + "=" * 80)
print("[D] อ่างเก็บน้ำ - ตรวจสอบ water_percent format")
print("-" * 60)
cursor.execute("""
    SELECT dam_name, dam_type, water_percent, water_volume_m_cum
    FROM tbl_drought_monitoring
    WHERE recorded_at = (SELECT MAX(recorded_at) FROM tbl_drought_monitoring WHERE recorded_at < '2026-10-01')
    AND dam_type = 'อ่างขนาดใหญ่'
    ORDER BY dam_name
""")
large_dams = cursor.fetchall()
print(f"  อ่างขนาดใหญ่ ({len(large_dams)} แห่ง) ข้อมูลล่าสุด:")
for d in large_dams:
    print(f"    {d['dam_name']}: {d['water_volume_m_cum']} ล้าน ลบ.ม. ({d['water_percent']})")

conn.close()
print("\n" + "=" * 80)
print("สรุปสิ่งที่ต้องแก้ไขในรายงาน:")
print("  1. เรื่องร้องเรียน: ใช้ 22 เรื่อง (นับจาก ticket_datetime, ไม่ใช่ recorded_at)")
print("  2. risk_level: ตรวจสอบการ aggregate ให้ถูกต้อง")
print("=" * 80)
