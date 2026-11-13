# -*- coding: utf-8 -*-
# verify2_complaints.py - ตรวจสอบข้อมูลร้องเรียนให้ละเอียด
import pymysql

conn = pymysql.connect(
    host='localhost', user='root', password='root',
    db='water_systems', charset='utf8mb4',
    cursorclass=pymysql.cursors.DictCursor
)
cursor = conn.cursor()

print("=" * 80)
print("ตรวจสอบเรื่องร้องเรียน - วิเคราะห์ความแตกต่างของ field วันที่")
print("=" * 80)

# ดู schema ของตาราง
cursor.execute("DESCRIBE tbl_complaints_monitoring")
print("\nSchema ของตาราง tbl_complaints_monitoring:")
for col in cursor.fetchall():
    print(f"  {col['Field']:25} {col['Type']:20} {col.get('Comment','')}")

print("\n" + "=" * 80)
print("รายการทั้งหมดในฐานข้อมูล (จัดเรียงตาม ticket_datetime จริง):")
print("-" * 80)
cursor.execute("""
    SELECT ticket_id, ticket_datetime, recorded_at, state_name, problem_type, agency_status
    FROM tbl_complaints_monitoring 
    ORDER BY ticket_datetime
""")
all_c = cursor.fetchall()
print(f"รวมทั้งสิ้น: {len(all_c)} รายการ")
print()

# แยกตาม ticket_datetime เดือน
cursor.execute("""
    SELECT 
      DATE_FORMAT(recorded_at, '%Y-%m') as rec_month,
      COUNT(*) as cnt
    FROM tbl_complaints_monitoring
    GROUP BY DATE_FORMAT(recorded_at, '%Y-%m')
    ORDER BY rec_month
""")
print("จำนวนตาม recorded_at (เดือน-ปี):")
for r in cursor.fetchall():
    print(f"  {r['rec_month']}: {r['cnt']} รายการ")

# นับเฉพาะที่ ticket_datetime เป็นเดือนกันยายน
cursor.execute("""
    SELECT COUNT(*) as cnt FROM tbl_complaints_monitoring
    WHERE ticket_datetime LIKE '%ก.ย.%' OR ticket_datetime LIKE '%กันยายน%' OR ticket_datetime LIKE '%09%'
""")
print(f"\nที่ ticket_datetime มีคำว่า ก.ย.: {cursor.fetchone()['cnt']} รายการ")

# ดูตัวอย่าง ticket_datetime format
print("\nตัวอย่าง ticket_datetime ทั้งหมด:")
cursor.execute("SELECT DISTINCT ticket_datetime FROM tbl_complaints_monitoring ORDER BY ticket_datetime LIMIT 40")
for r in cursor.fetchall():
    print(f"  '{r['ticket_datetime']}'")

# ตรวจสอบว่า UI แสดงอะไร - น่าจะ filter ตาม ticket_datetime เดือนกันยายน
print("\n" + "=" * 80)
print("วิเคราะห์: UI แสดง 22 รายการ - น่าจะนับเฉพาะ ticket ที่แจ้งในเดือนกันยายน")
print("ตรวจสอบ ticket ที่มี ticket_datetime ในเดือนกันยายน 2569:")
cursor.execute("""
    SELECT ticket_id, ticket_datetime, state_name, problem_type
    FROM tbl_complaints_monitoring
    WHERE ticket_datetime != '' AND ticket_datetime IS NOT NULL
    ORDER BY ticket_datetime
""")
tickets_with_date = cursor.fetchall()
print(f"  มี ticket_datetime: {len(tickets_with_date)} รายการ")

sep_tickets = [t for t in tickets_with_date if 'ก.ย.' in str(t['ticket_datetime'])]
aug_tickets = [t for t in tickets_with_date if 'ส.ค.' in str(t['ticket_datetime'])]
print(f"  มี ก.ย. ใน ticket_datetime: {len(sep_tickets)} รายการ")
print(f"  มี ส.ค. ใน ticket_datetime: {len(aug_tickets)} รายการ")

print("\nรายการที่มี ก.ย. ใน ticket_datetime:")
for t in sep_tickets:
    print(f"  {t['ticket_id']} | {t['ticket_datetime']} | {t['state_name']}")

print("\nรายการที่ ticket_datetime ว่าง (ไม่มีวันที่แจ้ง):")
cursor.execute("SELECT ticket_id, recorded_at, state_name FROM tbl_complaints_monitoring WHERE ticket_datetime = '' OR ticket_datetime IS NULL")
empty = cursor.fetchall()
print(f"  จำนวน: {len(empty)} รายการ")
for t in empty:
    print(f"  {t['ticket_id']} | recorded:{t['recorded_at']} | {t['state_name']}")

print("\n" + "=" * 80)
print("สรุป: ค่าที่ UI แสดง 22 รายการ = ?")
print("  - ทั้งหมดในตาราง:", len(all_c))
print("  - มี ticket_datetime:", len(tickets_with_date))
print("  - เดือน ก.ย. ใน ticket_datetime:", len(sep_tickets))
print("  - ไม่มี ticket_datetime:", len(empty))
print(f"  - tickets ที่ recorded ใน ก.ย.: นับตาม recorded_at")

cursor.execute("SELECT COUNT(*) as cnt FROM tbl_complaints_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
print(f"  - recorded_at ในกันยายน: {cursor.fetchone()['cnt']} รายการ")

# ลองตรวจสอบ: ถ้า filter ด้วย ticket ที่ไม่ซ้ำกันด้วย ticket_id และ recorded ช่วง ก.ย.
cursor.execute("""
    SELECT COUNT(DISTINCT ticket_id) as cnt 
    FROM tbl_complaints_monitoring 
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
""")
print(f"  - DISTINCT ticket_id ใน recorded ก.ย.: {cursor.fetchone()['cnt']} รายการ")

# นับเฉพาะที่ไม่มี ส.ค. ใน ticket_datetime (ตัด Aug tickets)
cursor.execute("""
    SELECT COUNT(*) as cnt FROM tbl_complaints_monitoring 
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
    AND (ticket_datetime NOT LIKE '%ส.ค.%' OR ticket_datetime = '' OR ticket_datetime IS NULL)
""")
print(f"  - ใน ก.ย. ที่ไม่มี ส.ค. ใน ticket_datetime: {cursor.fetchone()['cnt']} รายการ")

conn.close()
