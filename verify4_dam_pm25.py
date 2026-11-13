# -*- coding: utf-8 -*-
# verify4_dam_pm25.py
import pymysql

conn = pymysql.connect(
    host='localhost', user='root', password='root',
    db='water_systems', charset='utf8mb4',
    cursorclass=pymysql.cursors.DictCursor
)
cursor = conn.cursor()

# PM2.5
print("=" * 70)
print("[C] PM2.5 - ตรวจสอบ")
print("-" * 50)
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

cursor.execute("""
    SELECT station_name, amphoe, COUNT(*) as times, MAX(pm25_value) as max_val, AVG(pm25_value) as avg_val
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
    AND pm25_value > 37.5
    GROUP BY station_name, amphoe ORDER BY max_val DESC
""")
exceed = cursor.fetchall()
print(f"\n  สถานีที่มีค่า > 37.5 ug/m3:")
for e in exceed:
    print(f"    {e['station_name']} ({e['amphoe']}): {e['times']} ครั้ง, สูงสุด={float(e['max_val']):.1f}, เฉลี่ย={float(e['avg_val']):.1f}")

# ค่าเฉลี่ย PM2.5 ทั้งเดือน
cursor.execute("""
    SELECT ROUND(AVG(pm25_value),2) as avg_pm25, MAX(pm25_value) as max_pm25, MIN(pm25_value) as min_pm25
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
""")
r = cursor.fetchone()
print(f"\n  ค่า PM2.5 ทั้งเดือนกันยายน: เฉลี่ย={float(r['avg_pm25']):.2f}, สูงสุด={float(r['max_pm25']):.1f}, ต่ำสุด={float(r['min_pm25']):.1f} ug/m3")

# DAM
print("\n" + "=" * 70)
print("[D] อ่างเก็บน้ำ - ตรวจสอบ")
print("-" * 50)

# หา MAX recorded_at ล่าสุด
cursor.execute("SELECT MAX(recorded_at) as latest FROM tbl_drought_monitoring WHERE recorded_at < '2026-10-01'")
latest_dam = cursor.fetchone()['latest']
print(f"  ข้อมูลล่าสุด: {latest_dam}")

cursor.execute("""
    SELECT dam_name, dam_type, water_volume_m_cum, water_percent
    FROM tbl_drought_monitoring
    WHERE recorded_at = %s AND dam_type = 'อ่างขนาดใหญ่'
    ORDER BY dam_name
""", (latest_dam,))
large_dams = cursor.fetchall()
print(f"\n  อ่างขนาดใหญ่ ({len(large_dams)} แห่ง):")
for d in large_dams:
    print(f"    {d['dam_name']}: {d['water_volume_m_cum']} ล้าน ลบ.ม. ({d['water_percent']})")

cursor.execute("""
    SELECT dam_name, dam_type, water_volume_m_cum, water_percent
    FROM tbl_drought_monitoring
    WHERE recorded_at = %s AND dam_type = 'อ่างขนาดกลาง'
    ORDER BY dam_name
""", (latest_dam,))
mid_dams = cursor.fetchall()
print(f"\n  อ่างขนาดกลาง ({len(mid_dams)} แห่ง):")
for d in mid_dams:
    print(f"    {d['dam_name']}: {d['water_volume_m_cum']} ล้าน ลบ.ม. ({d['water_percent']})")

cursor.execute("""
    SELECT dam_name, dam_type, water_volume_m_cum, water_percent
    FROM tbl_drought_monitoring
    WHERE recorded_at = %s AND dam_type = 'อ่างขนาดเล็ก'
    ORDER BY dam_name
""", (latest_dam,))
small_dams = cursor.fetchall()
print(f"\n  อ่างขนาดเล็ก ({len(small_dams)} แห่ง):")
for d in small_dams:
    print(f"    {d['dam_name']}: {d['water_volume_m_cum']} ล้าน ลบ.ม. ({d['water_percent']})")

# สรุปอ่าง
cursor.execute("""
    SELECT dam_type, AVG(water_percent) as avg_pct, SUM(water_volume_m_cum) as total_vol
    FROM tbl_drought_monitoring
    WHERE recorded_at = %s
    GROUP BY dam_type
""", (latest_dam,))
print("\n  สรุปรวม (ข้อมูลล่าสุด):")
for r in cursor.fetchall():
    print(f"    {r['dam_type']}: เฉลี่ย={float(r['avg_pct']):.1f}%, รวม={float(r['total_vol']):.2f} ล้าน ลบ.ม.")

# WATER - risk level ที่ถูกต้อง (แก้ query)
print("\n" + "=" * 70)
print("[B] ระดับความเสี่ยงน้ำ (ข้อมูลล่าสุด per สถานี)")
print("-" * 50)

cursor.execute("SELECT MAX(recorded_at) as latest FROM tbl_water_disaster_monitoring WHERE recorded_at < '2026-10-01'")
latest_water = cursor.fetchone()['latest']
print(f"  ข้อมูลล่าสุด: {latest_water}")

cursor.execute("""
    SELECT station_name, amphoe, risk_level, current_water_level_m
    FROM tbl_water_disaster_monitoring
    WHERE recorded_at = %s
    ORDER BY risk_level DESC, amphoe, station_name
""", (latest_water,))
stations = cursor.fetchall()
print(f"  จำนวนสถานี (snapshot ล่าสุด): {len(stations)}")

from collections import Counter
risk_cnt = Counter(s['risk_level'] for s in stations)
print("  ระดับความเสี่ยง:")
for r, cnt in risk_cnt.most_common():
    print(f"    {r}: {cnt} สถานี")

print("\n  สถานีที่มีความเสี่ยง (ไม่ปกติ):")
for s in stations:
    if s['risk_level'] != 'ปกติ':
        print(f"    [{s['risk_level']}] {s['station_name']} ({s['amphoe']}) ระดับน้ำ={s['current_water_level_m']}")

# ─── สรุปใหญ่ ─────────────────────────────────────────────────────────────
print("\n" + "=" * 70)
print("สรุปตัวเลขที่ถูกต้องสำหรับรายงาน กันยายน 2569")
print("=" * 70)

cursor.execute("SELECT COUNT(DISTINCT station_name) as cnt FROM tbl_water_disaster_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
water_stations = cursor.fetchone()['cnt']

cursor.execute("SELECT COUNT(DISTINCT dam_name) as cnt FROM tbl_drought_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
dam_count = cursor.fetchone()['cnt']

cursor.execute("SELECT COUNT(DISTINCT station_name) as cnt FROM tbl_pm25_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
pm_stations = cursor.fetchone()['cnt']

cursor.execute("SELECT COUNT(*) as cnt FROM tbl_complaints_monitoring WHERE ticket_datetime IS NOT NULL AND ticket_datetime != ''")
complaints_correct = cursor.fetchone()['cnt']

print(f"  สถานีน้ำ:            {water_stations} สถานี")
print(f"  อ่างเก็บน้ำ:          {dam_count} แห่ง")  
print(f"  สถานี PM2.5:         {pm_stations} สถานี")
print(f"  เรื่องร้องเรียน:       {complaints_correct} เรื่อง  *** (แก้จาก 28 เป็น 22)")
print()

conn.close()
