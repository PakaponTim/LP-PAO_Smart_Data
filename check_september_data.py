# -*- coding: utf-8 -*-
import pymysql
conn = pymysql.connect(host='localhost', user='root', password='root', db='water_systems', charset='utf8mb4', cursorclass=pymysql.cursors.DictCursor)
cursor = conn.cursor()

cursor.execute("SELECT COUNT(*) as cnt FROM tbl_water_disaster_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
print('Water records Sep:', cursor.fetchone())

cursor.execute("SELECT COUNT(*) as cnt FROM tbl_drought_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
print('Drought records Sep:', cursor.fetchone())

cursor.execute("SELECT COUNT(*) as cnt FROM tbl_pm25_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
print('PM25 records Sep:', cursor.fetchone())

cursor.execute("SELECT COUNT(*) as cnt FROM tbl_complaints_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
print('Complaints records Sep:', cursor.fetchone())

cursor.execute("SELECT MIN(recorded_at) as min_date, MAX(recorded_at) as max_date FROM tbl_water_disaster_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
print('Water date range:', cursor.fetchone())

cursor.execute("SELECT COUNT(DISTINCT station_name) as stations FROM tbl_water_disaster_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
print('Water distinct stations:', cursor.fetchone())

cursor.execute("SELECT COUNT(DISTINCT station_name) as stations FROM tbl_pm25_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
print('PM25 distinct stations:', cursor.fetchone())

# Check risk levels
cursor.execute("""
    SELECT risk_level, COUNT(*) as cnt FROM tbl_water_disaster_monitoring 
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
    GROUP BY risk_level
""")
print('Risk levels:', cursor.fetchall())

# Sample water station data
cursor.execute("""
    SELECT station_name, river, amphoe, 
      ROUND(AVG(current_water_level_m),2) as avg_wl,
      MAX(current_water_level_m) as max_wl,
      MAX(risk_level) as risk_level, MAX(status) as status
    FROM tbl_water_disaster_monitoring
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
    GROUP BY station_name, river, amphoe
    ORDER BY amphoe, station_name LIMIT 10
""")
print('Sample water stations:')
for r in cursor.fetchall():
    print(' ', r)

conn.close()
print('Done')
