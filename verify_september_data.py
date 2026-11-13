# -*- coding: utf-8 -*-
# verify_september_data.py - ตรวจสอบความถูกต้องของข้อมูลทุกระบบ กันยายน 2569
import pymysql
from datetime import datetime

conn = pymysql.connect(
    host='localhost', user='root', password='root',
    db='water_systems', charset='utf8mb4',
    cursorclass=pymysql.cursors.DictCursor
)
cursor = conn.cursor()

print("=" * 70)
print("ตรวจสอบข้อมูล ประจำเดือนกันยายน 2569 (1-30 กันยายน 2026)")
print("=" * 70)

# ─── 1. COMPLAINTS ───────────────────────────────────────────────────────────
print("\n[1] ระบบร้องเรียน - tbl_complaints_monitoring")
print("-" * 50)

# ตรวจสอบช่วงวันที่ทั้งหมดในตาราง
cursor.execute("SELECT MIN(recorded_at) as min_r, MAX(recorded_at) as max_r FROM tbl_complaints_monitoring")
r = cursor.fetchone()
print(f"  ช่วง recorded_at ในตาราง: {r['min_r']} ถึง {r['max_r']}")

cursor.execute("SELECT MIN(ticket_datetime) as min_t, MAX(ticket_datetime) as max_t FROM tbl_complaints_monitoring")
r = cursor.fetchone()
print(f"  ช่วง ticket_datetime ในตาราง: {r['min_t']} ถึง {r['max_t']}")

# นับด้วย recorded_at
cursor.execute("SELECT COUNT(*) as cnt FROM tbl_complaints_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
print(f"  COUNT ด้วย recorded_at (ก.ย.): {cursor.fetchone()['cnt']} เรื่อง")

# นับด้วย ticket_datetime
cursor.execute("SELECT COUNT(*) as cnt FROM tbl_complaints_monitoring WHERE ticket_datetime >= '2026-09-01' AND ticket_datetime < '2026-10-01'")
print(f"  COUNT ด้วย ticket_datetime (ก.ย.): {cursor.fetchone()['cnt']} เรื่อง")

# นับทั้งหมดในตาราง
cursor.execute("SELECT COUNT(*) as cnt FROM tbl_complaints_monitoring")
total = cursor.fetchone()['cnt']
print(f"  COUNT ทั้งหมดในตาราง: {total} เรื่อง")

# ดู distinct ticket_id
cursor.execute("SELECT COUNT(DISTINCT ticket_id) as cnt FROM tbl_complaints_monitoring")
print(f"  COUNT DISTINCT ticket_id: {cursor.fetchone()['cnt']} เรื่อง")

# ตรวจสอบ duplicate
cursor.execute("""
    SELECT ticket_id, COUNT(*) as cnt 
    FROM tbl_complaints_monitoring 
    GROUP BY ticket_id HAVING COUNT(*) > 1 LIMIT 10
""")
dups = cursor.fetchall()
print(f"  Duplicate ticket_id: {len(dups)} รายการ")
for d in dups[:5]:
    print(f"    ticket_id={d['ticket_id']} พบ {d['cnt']} ครั้ง")

# ดูรายการทั้งหมดพร้อม recorded_at
cursor.execute("SELECT ticket_id, ticket_datetime, recorded_at, state_name FROM tbl_complaints_monitoring ORDER BY recorded_at")
all_complaints = cursor.fetchall()
print(f"\n  รายการทั้งหมด ({len(all_complaints)} รายการ):")
for c in all_complaints:
    print(f"    ID:{c['ticket_id']} | ticket:{c['ticket_datetime']} | recorded:{c['recorded_at']} | {c['state_name']}")

# ─── 2. WATER MONITORING ─────────────────────────────────────────────────────
print("\n" + "=" * 70)
print("[2] ระบบน้ำ - tbl_water_disaster_monitoring")
print("-" * 50)

cursor.execute("SELECT MIN(recorded_at) as min_r, MAX(recorded_at) as max_r FROM tbl_water_disaster_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
r = cursor.fetchone()
print(f"  ช่วงข้อมูล: {r['min_r']} ถึง {r['max_r']}")

cursor.execute("SELECT COUNT(*) as cnt FROM tbl_water_disaster_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
print(f"  จำนวน records: {cursor.fetchone()['cnt']:,} รายการ")

cursor.execute("SELECT COUNT(DISTINCT station_name) as cnt FROM tbl_water_disaster_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
print(f"  จำนวนสถานี: {cursor.fetchone()['cnt']} สถานี")

cursor.execute("""
    SELECT risk_level, COUNT(DISTINCT station_name) as st_cnt
    FROM tbl_water_disaster_monitoring
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
    GROUP BY risk_level
""")
risks = cursor.fetchall()
print(f"  ระดับความเสี่ยง (distinct station):")
for r in risks:
    print(f"    {r['risk_level']}: {r['st_cnt']} สถานี")

# ─── 3. DAM/DROUGHT ──────────────────────────────────────────────────────────
print("\n" + "=" * 70)
print("[3] ระบบอ่างเก็บน้ำ - tbl_drought_monitoring")
print("-" * 50)

cursor.execute("SELECT MIN(recorded_at) as min_r, MAX(recorded_at) as max_r FROM tbl_drought_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
r = cursor.fetchone()
print(f"  ช่วงข้อมูล: {r['min_r']} ถึง {r['max_r']}")

cursor.execute("SELECT COUNT(*) as cnt FROM tbl_drought_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
print(f"  จำนวน records: {cursor.fetchone()['cnt']:,} รายการ")

cursor.execute("SELECT COUNT(DISTINCT dam_name) as cnt FROM tbl_drought_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
print(f"  จำนวนอ่าง: {cursor.fetchone()['cnt']} แห่ง")

cursor.execute("SELECT dam_type, COUNT(DISTINCT dam_name) as cnt FROM tbl_drought_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01' GROUP BY dam_type")
for r in cursor.fetchall():
    print(f"    {r['dam_type']}: {r['cnt']} แห่ง")

# ─── 4. PM2.5 ────────────────────────────────────────────────────────────────
print("\n" + "=" * 70)
print("[4] ระบบ PM2.5 - tbl_pm25_monitoring")
print("-" * 50)

cursor.execute("SELECT MIN(recorded_at) as min_r, MAX(recorded_at) as max_r FROM tbl_pm25_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
r = cursor.fetchone()
print(f"  ช่วงข้อมูล: {r['min_r']} ถึง {r['max_r']}")

cursor.execute("SELECT COUNT(*) as cnt FROM tbl_pm25_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
print(f"  จำนวน records: {cursor.fetchone()['cnt']:,} รายการ")

cursor.execute("SELECT COUNT(DISTINCT station_name) as cnt FROM tbl_pm25_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
print(f"  จำนวนสถานี: {cursor.fetchone()['cnt']} สถานี")

cursor.execute("""
    SELECT air_quality_status, COUNT(*) as cnt
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
    GROUP BY air_quality_status ORDER BY cnt DESC
""")
print(f"  สถานะคุณภาพอากาศ:")
for s in cursor.fetchall():
    print(f"    {s['air_quality_status']}: {int(s['cnt']):,} ครั้ง")

cursor.execute("""
    SELECT COUNT(*) as cnt FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01' AND pm25_value > 37.5
""")
print(f"  เกินมาตรฐาน >37.5: {cursor.fetchone()['cnt']} ครั้ง")

# ─── 5. WATER RISK per STATION ───────────────────────────────────────────────
print("\n" + "=" * 70)
print("[5] ตรวจสอบ risk_level รายสถานี (กันยายน 2569)")
print("-" * 50)
cursor.execute("""
    SELECT station_name, amphoe,
      MAX(risk_level) as risk_level,
      ROUND(AVG(current_water_level_m),2) as avg_wl
    FROM tbl_water_disaster_monitoring
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
    GROUP BY station_name, amphoe
    ORDER BY risk_level DESC, amphoe, station_name
""")
stations = cursor.fetchall()
print(f"  สถานีทั้งหมด: {len(stations)} สถานี")
for s in stations:
    print(f"    [{s['risk_level']}] {s['station_name']} ({s['amphoe']}) avg={s['avg_wl']}")

conn.close()
print("\n" + "=" * 70)
print("ตรวจสอบเสร็จสิ้น")
print("=" * 70)
