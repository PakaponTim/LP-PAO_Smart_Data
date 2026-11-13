# -*- coding: utf-8 -*-
# check_risk_exact.py
import pymysql

conn = pymysql.connect(
    host='localhost', user='root', password='root',
    db='water_systems', charset='utf8mb4',
    cursorclass=pymysql.cursors.DictCursor
)
cursor = conn.cursor()

# ดู risk_level values จริงพร้อม hex
cursor.execute("SELECT DISTINCT risk_level, HEX(risk_level) as hex_val FROM tbl_water_disaster_monitoring WHERE recorded_at >= '2026-09-01'")
print("risk_level values:")
for r in cursor.fetchall():
    rl = r['risk_level'] or ''
    print(f"  '{rl}' | hex={r['hex_val']} | len={len(rl)}")

# ทดสอบ JOIN query ใหม่
cursor.execute("""
    SELECT w.station_name, w.amphoe, w.risk_level, agg.avg_wl, COALESCE(agg.avg_rain,0) as avg_rain
    FROM tbl_water_disaster_monitoring w
    JOIN (
      SELECT station_name, MAX(recorded_at) as station_latest
      FROM tbl_water_disaster_monitoring
      WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
      GROUP BY station_name
    ) lat ON w.station_name = lat.station_name AND w.recorded_at = lat.station_latest
    JOIN (
      SELECT station_name,
        AVG(current_water_level_m) as avg_wl,
        AVG(NULLIF(current_rain_mm,0)) as avg_rain,
        COUNT(*) as records
      FROM tbl_water_disaster_monitoring
      WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
      GROUP BY station_name
    ) agg ON w.station_name = agg.station_name
    ORDER BY w.amphoe, w.station_name
""")
rows = cursor.fetchall()
print(f"\nJOIN ใหม่ - จำนวนสถานี: {len(rows)}")

from collections import Counter
risk_c = Counter(r['risk_level'] for r in rows)
print("risk_level summary:")
for rl, cnt in risk_c.most_common():
    print(f"  '{rl}': {cnt} สถานี")

conn.close()
