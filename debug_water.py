# -*- coding: utf-8 -*-
# debug_water.py - ตรวจสอบข้อมูลน้ำเชิงลึก
import pymysql

conn = pymysql.connect(
    host='localhost', user='root', password='root',
    db='water_systems', charset='utf8mb4',
    cursorclass=pymysql.cursors.DictCursor
)
cursor = conn.cursor()

# หา MAX recorded_at
cursor.execute("SELECT MAX(recorded_at) as latest FROM tbl_water_disaster_monitoring WHERE recorded_at < '2026-10-01'")
latest = cursor.fetchone()['latest']
print(f"Latest recorded_at: {latest}")

# ดูข้อมูล snapshot ล่าสุด
cursor.execute("""
    SELECT station_name, amphoe, risk_level, current_water_level_m, current_rain_mm, trend, status
    FROM tbl_water_disaster_monitoring
    WHERE recorded_at = %s
    ORDER BY amphoe, station_name
    LIMIT 5
""", (latest,))
rows = cursor.fetchall()
print(f"\nSnapshot ล่าสุด ({len(rows)} rows first 5):")
for r in rows:
    print(f"  risk_level='{r['risk_level']}' | rain={r['current_rain_mm']} | station={r['station_name']}")
    print(f"    repr(risk_level)={repr(r['risk_level'])}")

# ดู DISTINCT risk_level values พร้อม repr
cursor.execute("SELECT DISTINCT risk_level FROM tbl_water_disaster_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
print("\nDistinct risk_level values (raw):")
for r in cursor.fetchall():
    rl = r['risk_level']
    print(f"  repr='{repr(rl)}' | len={len(rl) if rl else 0}")

# ตรวจ JOIN query ว่าได้ผลถูกไหม
cursor.execute("""
    SELECT w.station_name, w.risk_level, agg.avg_rain, agg.records
    FROM tbl_water_disaster_monitoring w
    JOIN (
      SELECT station_name,
        AVG(current_water_level_m) as avg_wl,
        MAX(current_water_level_m) as max_wl,
        MIN(current_water_level_m) as min_wl,
        AVG(left_bank_level_m) as avg_bank,
        AVG(bank_difference_m) as avg_diff,
        AVG(current_rain_mm) as avg_rain,
        MAX(current_rain_mm) as max_rain,
        COUNT(*) as records
      FROM tbl_water_disaster_monitoring
      WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
      GROUP BY station_name
    ) agg ON w.station_name = agg.station_name
    WHERE w.recorded_at = %s
    ORDER BY w.amphoe, w.station_name
    LIMIT 5
""", (latest,))
joined = cursor.fetchall()
print(f"\nJOIN query result (first 5):")
for r in joined:
    print(f"  station={r['station_name']} | risk='{r['risk_level']}' | avg_rain={r['avg_rain']} | records={r['records']}")

# ตรวจสอบ current_rain_mm
cursor.execute("""
    SELECT COUNT(*) as total,
      SUM(CASE WHEN current_rain_mm IS NULL THEN 1 ELSE 0 END) as null_cnt,
      SUM(CASE WHEN current_rain_mm = 0 THEN 1 ELSE 0 END) as zero_cnt,
      AVG(current_rain_mm) as avg_rain,
      MAX(current_rain_mm) as max_rain
    FROM tbl_water_disaster_monitoring
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
""")
r = cursor.fetchone()
print(f"\nฝน (current_rain_mm) ทั้งเดือนกันยายน:")
print(f"  total={r['total']}, NULL={r['null_cnt']}, zero={r['zero_cnt']}, avg={r['avg_rain']}, max={r['max_rain']}")

# ดู column ทั้งหมดที่มี
cursor.execute("DESCRIBE tbl_water_disaster_monitoring")
print("\nColumns ในตาราง:")
for col in cursor.fetchall():
    print(f"  {col['Field']:30} {col['Type']}")

# ดูตัวอย่าง row จริง (ทั้งหมด columns)
cursor.execute("SELECT * FROM tbl_water_disaster_monitoring WHERE recorded_at >= '2026-09-01' LIMIT 2")
sample = cursor.fetchall()
print("\nSample rows:")
for r in sample:
    for k, v in r.items():
        print(f"  {k}: {repr(v)}")
    print("  ---")

conn.close()
