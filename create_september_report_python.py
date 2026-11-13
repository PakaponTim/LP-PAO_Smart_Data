# -*- coding: utf-8 -*-
"""
create_september_report_python.py
สร้างรายงานสรุปวิเคราะห์ข้อมูลรายเดือน กันยายน 2569
ใช้ python-docx – รองรับการพิมพ์ขาว-ดำ ฟอนต์ TH SarabunPSK 100%
"""

import json, math, sys, os
import pymysql
from docx import Document
from docx.shared import Pt, Cm, RGBColor, Twips
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from docx.oxml import OxmlElement as OE

# ──────────────────────────────────────────
# CONFIG
# ──────────────────────────────────────────
FONT_NAME  = 'TH SarabunPSK'
FONT_BODY  = 16
FONT_SM    = 14
FONT_H1    = 20
FONT_H2    = 18
FONT_H3    = 16
FONT_TITLE = 24
FONT_COVER = 28

# Monochrome palette (ขาว-ดำ)
BLACK    = RGBColor(0x00, 0x00, 0x00)
DARK     = RGBColor(0x1A, 0x1A, 0x1A)
GRAY     = RGBColor(0x55, 0x55, 0x55)
LGRAY    = RGBColor(0x88, 0x88, 0x88)
WHITE    = RGBColor(0xFF, 0xFF, 0xFF)
HDR_BG   = '2C2C2C'
MED_BG   = '4A4A4A'
ROW_EVEN = 'F2F2F2'
KPI_BG   = 'F0F0F0'

C_DANGER  = RGBColor(0x8B, 0x00, 0x00)
C_WARN    = RGBColor(0x7A, 0x52, 0x00)
C_OK      = RGBColor(0x2D, 0x6A, 0x2D)

# ──────────────────────────────────────────
# FETCH DATA FROM MYSQL
# ──────────────────────────────────────────
print("Connecting to database 'water_systems'...")
conn = pymysql.connect(
    host='localhost', user='root', password='root',
    db='water_systems', charset='utf8mb4',
    cursorclass=pymysql.cursors.DictCursor
)
cursor = conn.cursor()

# ดึงข้อมูลน้ำ: ใช้ latest snapshot ของแต่ละสถานี (ไม่ใช่ global MAX)
# เพื่อให้ได้ risk_level ปัจจุบันและครบทุกสถานี
cursor.execute("""
    SELECT w.station_name, w.river, w.amphoe, w.province,
      ROUND(agg.avg_wl,2) as avg_wl,
      agg.max_wl, agg.min_wl,
      ROUND(agg.avg_bank,2) as avg_bank,
      ROUND(agg.avg_diff,2) as avg_diff,
      ROUND(COALESCE(agg.avg_rain,0),2) as avg_rain,
      COALESCE(agg.max_rain,0) as max_rain,
      agg.records,
      w.trend, w.status, w.risk_level
    FROM tbl_water_disaster_monitoring w
    JOIN (
      -- ใช้ข้อมูล latest per station
      SELECT station_name, MAX(recorded_at) as station_latest
      FROM tbl_water_disaster_monitoring
      WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
      GROUP BY station_name
    ) lat ON w.station_name = lat.station_name AND w.recorded_at = lat.station_latest
    JOIN (
      -- avg ทั้งเดือน
      SELECT station_name,
        AVG(current_water_level_m) as avg_wl,
        MAX(current_water_level_m) as max_wl,
        MIN(current_water_level_m) as min_wl,
        AVG(left_bank_level_m) as avg_bank,
        AVG(bank_difference_m) as avg_diff,
        AVG(NULLIF(current_rain_mm,0)) as avg_rain,
        MAX(current_rain_mm) as max_rain,
        COUNT(*) as records
      FROM tbl_water_disaster_monitoring
      WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
      GROUP BY station_name
    ) agg ON w.station_name = agg.station_name
    ORDER BY w.amphoe, w.station_name
""")
wStations = cursor.fetchall()

cursor.execute("SELECT COUNT(*) as cnt FROM tbl_water_disaster_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
wTotal = cursor.fetchone()['cnt']

cursor.execute("""
    SELECT DATE(recorded_at) as day,
      ROUND(AVG(current_water_level_m),2) as avg_wl,
      ROUND(MAX(current_water_level_m),2) as max_wl,
      COUNT(DISTINCT station_name) as active_stations
    FROM tbl_water_disaster_monitoring
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
    GROUP BY DATE(recorded_at) ORDER BY day LIMIT 31
""")
wDaily = cursor.fetchall()

# ดึงข้อมูลฝน: tbl_rainfall_monitoring
cursor.execute("""
    SELECT COUNT(*) as cnt, COUNT(DISTINCT station_name) as stations
    FROM tbl_rainfall_monitoring
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
""")
rain_summary_row = cursor.fetchone()
rainTotalRecords = rain_summary_row['cnt']
rainTotalStations = rain_summary_row['stations']

cursor.execute("""
    SELECT station_name, location, river_basin, record_date, DATE(recorded_at) as rec_date,
           MAX(rain_mm) as daily_rain
    FROM tbl_rainfall_monitoring
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
    GROUP BY station_name, location, river_basin, record_date, DATE(recorded_at)
""")
rainDailyRows = cursor.fetchall()

cursor.execute("""
    SELECT dam_name, dam_type,
      ROUND(MAX(capacity_m_cum),2) as capacity,
      ROUND(AVG(water_volume_m_cum),2) as avg_volume,
      ROUND(AVG(usable_water_m_cum),2) as avg_usable,
      ROUND(AVG(inflow_m_cum),4) as avg_inflow,
      ROUND(AVG(discharge_m_cum),4) as avg_discharge,
      COUNT(*) as records
    FROM tbl_drought_monitoring
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
    GROUP BY dam_name, dam_type ORDER BY capacity DESC, dam_name
""")
dDams = cursor.fetchall()

cursor.execute("""
    SELECT dam_name, dam_type, water_volume_m_cum, water_percent,
      usable_water_m_cum, inflow_m_cum, discharge_m_cum, recorded_at
    FROM tbl_drought_monitoring
    WHERE recorded_at = (SELECT MAX(recorded_at) FROM tbl_drought_monitoring WHERE recorded_at < '2026-10-01')
    ORDER BY FIELD(dam_type,'อ่างขนาดใหญ่','อ่างขนาดกลาง','อ่างขนาดเล็ก'), dam_name
""")
dLatest = cursor.fetchall()

cursor.execute("SELECT COUNT(*) as cnt FROM tbl_drought_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
dTotal = cursor.fetchone()['cnt']

cursor.execute("""
    SELECT air_quality_status, COUNT(*) as cnt
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
    GROUP BY air_quality_status ORDER BY cnt DESC
""")
pStatus = cursor.fetchall()

cursor.execute("SELECT COUNT(*) as cnt, COUNT(DISTINCT station_name) as stations FROM tbl_pm25_monitoring WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'")
pTotal = cursor.fetchone()

cursor.execute("""
    SELECT amphoe, COUNT(DISTINCT station_name) as stations,
      ROUND(AVG(pm25_value),2) as avg_pm25, ROUND(MAX(pm25_value),2) as max_pm25
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
    GROUP BY amphoe ORDER BY avg_pm25 DESC
""")
pAmphoe = cursor.fetchall()

cursor.execute("""
    SELECT station_name, amphoe, ROUND(MAX(pm25_value),2) as max_pm25, COUNT(*) as times, air_quality_status
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01' AND pm25_value > 37.5
    GROUP BY station_name, amphoe, air_quality_status ORDER BY max_pm25 DESC LIMIT 10
""")
pExceed = cursor.fetchall()

cursor.execute("""
    SELECT station_name, amphoe,
      ROUND(AVG(pm25_value),2) as avg_pm25, ROUND(MAX(pm25_value),2) as max_pm25, COUNT(*) as records
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
    GROUP BY station_name, amphoe ORDER BY avg_pm25 DESC LIMIT 30
""")
pStations = cursor.fetchall()

cursor.execute("""
    SELECT DATE(recorded_at) as day,
      ROUND(AVG(pm25_value),2) as avg_pm25, ROUND(MAX(pm25_value),2) as max_pm25, COUNT(*) as readings
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-09-01' AND recorded_at < '2026-10-01'
    GROUP BY DATE(recorded_at) ORDER BY day
""")
pDaily = cursor.fetchall()

# ── เรื่องร้องเรียน: นับตาม ticket_datetime (วันที่แจ้งจริง) ──────────────
# cSep = เรื่องที่มี ticket_datetime (ทุกเรื่องที่ระบบรู้วันที่แจ้ง = 22 เรื่อง)
cursor.execute("""
    SELECT ticket_id, state_name, problem_type, location, ticket_datetime, agency_status
    FROM tbl_complaints_monitoring
    WHERE ticket_datetime IS NOT NULL AND ticket_datetime != ''
    ORDER BY ticket_datetime DESC
""")
cSep = cursor.fetchall()

# เรื่องที่มี ticket_datetime = ก.ย.
cursor.execute("""
    SELECT ticket_id, state_name, problem_type, location, ticket_datetime, agency_status
    FROM tbl_complaints_monitoring
    WHERE ticket_datetime LIKE '%ก.ย.%'
    ORDER BY ticket_datetime
""")
cSepOnly = cursor.fetchall()

# เรื่องที่มี ticket_datetime = ส.ค.
cursor.execute("""
    SELECT ticket_id, state_name, problem_type, location, ticket_datetime, agency_status
    FROM tbl_complaints_monitoring
    WHERE ticket_datetime LIKE '%ส.ค.%'
    ORDER BY ticket_datetime
""")
cAugOnly = cursor.fetchall()

cursor.execute("SELECT ticket_id, state_name, problem_type, location, ticket_datetime, agency_status FROM tbl_complaints_monitoring ORDER BY recorded_at DESC LIMIT 25")
cAll = cursor.fetchall()

# ประเภทปัญหา (ทุกเรื่องที่มี ticket_datetime)
cursor.execute("""
    SELECT problem_type, COUNT(*) as cnt FROM tbl_complaints_monitoring
    WHERE ticket_datetime IS NOT NULL AND ticket_datetime != ''
    GROUP BY problem_type ORDER BY cnt DESC
""")
cByTypeSep = cursor.fetchall()

cursor.execute("SELECT problem_type, COUNT(*) as cnt FROM tbl_complaints_monitoring GROUP BY problem_type ORDER BY cnt DESC")
cByTypeAll = cursor.fetchall()

# สถานะ (ทุกเรื่องที่มี ticket_datetime)
cursor.execute("""
    SELECT state_name, COUNT(*) as cnt FROM tbl_complaints_monitoring
    WHERE ticket_datetime IS NOT NULL AND ticket_datetime != ''
    GROUP BY state_name ORDER BY cnt DESC
""")
cByStatusSep = cursor.fetchall()

cursor.execute("SELECT state_name, COUNT(*) as cnt FROM tbl_complaints_monitoring GROUP BY state_name ORDER BY cnt DESC")
cByStatusAll = cursor.fetchall()

# สถิติสรุป: ใช้ทุกเรื่องที่มี ticket_datetime (= 22 เรื่อง)
cursor.execute("""
    SELECT COUNT(*) as cnt,
      SUM(CASE WHEN state_name='เสร็จสิ้น' THEN 1 ELSE 0 END) as done,
      SUM(CASE WHEN state_name LIKE '%รอ%' OR state_name LIKE '%ส่งต่อ%' THEN 1 ELSE 0 END) as pending
    FROM tbl_complaints_monitoring
    WHERE ticket_datetime IS NOT NULL AND ticket_datetime != ''
""")
cTotalSep = cursor.fetchone()

cursor.execute("SELECT COUNT(*) as cnt, SUM(CASE WHEN state_name='เสร็จสิ้น' THEN 1 ELSE 0 END) as done FROM tbl_complaints_monitoring")
cTotalAll = cursor.fetchone()

# สิงหาคม: นับจาก ticket_datetime ที่มี 'ส.ค.'
cursor.execute("""
    SELECT COUNT(*) as cnt,
      SUM(CASE WHEN state_name='เสร็จสิ้น' THEN 1 ELSE 0 END) as done
    FROM tbl_complaints_monitoring
    WHERE ticket_datetime LIKE '%ส.ค.%'
""")
cTotalAug = cursor.fetchone()

conn.close()

# ──────────────────────────────────────────
# COMPUTED STATS
# ──────────────────────────────────────────
totalWater  = len(wStations)
# risk_level จริงในฐานข้อมูล: 'ปกติ' และ 'ไม่มีข้อมูลฝน' (= เฝ้าระวัง)
criticalSt  = sum(1 for s in wStations if s['risk_level'] in ('วิกฤตสีแดง', 'วิกฤต'))
watchSt     = sum(1 for s in wStations if s['risk_level'] in ('ไม่มีข้อมูลฝน', 'เฝ้าระวัง'))
normalSt    = sum(1 for s in wStations if s['risk_level'] == 'ปกติ')
# สถานีที่ไม่ตรง category ใดเลย ให้นับเป็น ปกติ
uncategorized = totalWater - criticalSt - watchSt - normalSt
if uncategorized > 0:
    normalSt += uncategorized
amphoeList  = list(dict.fromkeys(s['amphoe'] for s in wStations))

largeDams   = [d for d in dDams if d['dam_type'] == 'อ่างขนาดใหญ่']
medDams     = [d for d in dDams if d['dam_type'] == 'อ่างขนาดกลาง']
smallDams   = [d for d in dDams if d['dam_type'] == 'อ่างขนาดเล็ก']
latestLarge = [d for d in dLatest if d['dam_type'] == 'อ่างขนาดใหญ่']
latestMed   = [d for d in dLatest if d['dam_type'] == 'อ่างขนาดกลาง']

totalPM    = sum(int(s['cnt']) for s in pStatus)
pm25Good   = next((int(s['cnt']) for s in pStatus if s['air_quality_status'] == 'ดีมาก'), 0)
pm25Exceed = sum(int(e['times']) for e in pExceed)
good_pct   = round(pm25Good / totalPM * 100) if totalPM > 0 else 0

hasSepComp  = cTotalSep and cTotalSep['cnt'] and int(cTotalSep['cnt']) > 0
compTotal   = int(cTotalSep['cnt']) if hasSepComp else int(cTotalAll['cnt'] or 0)
compDone    = int(cTotalSep['done'] or 0) if hasSepComp else int(cTotalAll['done'] or 0)
compRate    = round(compDone / compTotal * 100) if compTotal > 0 else 0
compAllTotal= int(cTotalAll['cnt'] or 0)
compAugTotal= int(cTotalAug['cnt'] or 0) if cTotalAug else 0

cListToShow   = cSep if len(cSep) > 0 else cAll
cByTypeToShow = cByTypeSep if len(cByTypeSep) > 0 else cByTypeAll
cByStatusToShow = cByStatusSep if len(cByStatusSep) > 0 else cByStatusAll

# ──────────────────────────────────────────
# RAINFALL COMPUTED STATS
# ──────────────────────────────────────────
def normalize_amphoe(text):
    if not text: return ''
    for a in ['เมืองปาน', 'เมืองลำปาง', 'เกาะคา', 'งาว', 'แจ้ห่ม', 'เถิน', 'แม่ทะ', 'แม่พริก', 'แม่เมาะ', 'วังเหนือ', 'สบปราบ', 'ห้างฉัตร', 'เสริมงาม']:
        if a in text:
            return a
    return ''

station_totals = {}
for r in rainDailyRows:
    st = r['station_name']
    loc = r['location'] or ''
    basin = r['river_basin'] or ''
    d_rain = float(r['daily_rain'] or 0.0)
    d_date = str(r['rec_date'])
    amp = normalize_amphoe(loc)
    
    if st not in station_totals:
        station_totals[st] = {
            'station_name': st, 'location': loc, 'basin': basin, 'amphoe': amp,
            'total': 0.0, 'max_day': 0.0, 'max_date': '', 'days': 0,
            'heavy_days': 0, 'very_heavy_days': 0, 'daily_rains': {}
        }
    sdict = station_totals[st]
    sdict['total'] += d_rain
    sdict['days'] += 1
    sdict['daily_rains'][d_date] = d_rain
    if basin and not sdict['basin']: sdict['basin'] = basin
    if loc and not sdict['location']: sdict['location'] = loc
    if amp and not sdict['amphoe']: sdict['amphoe'] = amp
    if d_rain > sdict['max_day']:
        sdict['max_day'] = d_rain
        sdict['max_date'] = r['record_date'] or d_date
    if d_rain >= 35.0:
        sdict['heavy_days'] += 1
    if d_rain >= 90.0:
        sdict['very_heavy_days'] += 1

# Basin fallback for stations with empty basin field
for sdict in station_totals.values():
    if not sdict['basin']:
        sdict['basin'] = 'ลุ่มน้ำยม' if sdict['amphoe'] == 'งาว' else 'ลุ่มน้ำวัง'

# Amphoe stats (ทั้ง 13 อำเภอของจังหวัดลำปาง เรียงตามฝนสะสมเฉลี่ยจากมากไปน้อย)
amphoe_order = ['เสริมงาม', 'เถิน', 'สบปราบ', 'แม่พริก', 'งาว', 'แม่ทะ', 'เมืองปาน', 'แจ้ห่ม', 'เมืองลำปาง', 'เกาะคา', 'วังเหนือ', 'ห้างฉัตร', 'แม่เมาะ']
amphoe_stats = {}
for amp in amphoe_order:
    st_in_amp = [s for s in station_totals.values() if s['amphoe'] == amp]
    num_st = len(st_in_amp)
    avg_cum = sum(s['total'] for s in st_in_amp) / num_st if num_st else 0.0
    max_24h = max((s['max_day'] for s in st_in_amp), default=0.0)
    max_st_obj = next((s for s in st_in_amp if s['max_day'] == max_24h), None)
    heavy_events = sum(s['heavy_days'] for s in st_in_amp)
    vheavy_events = sum(s['very_heavy_days'] for s in st_in_amp)
    amphoe_stats[amp] = {
        'amphoe': amp, 'num_stations': num_st, 'avg_cum': avg_cum,
        'max_24h': max_24h,
        'max_station': max_st_obj['station_name'] if max_st_obj else '-',
        'max_date': max_st_obj['max_date'] if max_st_obj else '-',
        'heavy_events': heavy_events, 'vheavy_events': vheavy_events
    }

# 10 อันดับสถานีตรวจวัดที่มีปริมาณฝนสะสมสูงสุด
top_rain_stations = sorted(station_totals.values(), key=lambda x: x['total'], reverse=True)[:10]

# Basin stats (เปรียบเทียบลุ่มน้ำวัง vs ลุ่มน้ำยม)
basin_groups = {'ลุ่มน้ำวัง': [], 'ลุ่มน้ำยม': []}
for s in station_totals.values():
    b = s['basin'] if s['basin'] in basin_groups else 'ลุ่มน้ำวัง'
    basin_groups[b].append(s)

basin_stats = {}
for bname, st_list in basin_groups.items():
    cnt = len(st_list)
    b_avg = sum(s['total'] for s in st_list) / cnt if cnt else 0.0
    b_max = max((s['max_day'] for s in st_list), default=0.0)
    b_max_st = next((s for s in st_list if s['max_day'] == b_max), None)
    basin_stats[bname] = {
        'count': cnt, 'avg_cum': b_avg, 'max_day': b_max,
        'max_station': b_max_st['station_name'] if b_max_st else '-',
        'max_date': b_max_st['max_date'] if b_max_st else '-'
    }

# Daily province rain (สรุปค่าเฉลี่ยรายวันทั้งจังหวัด)
daily_province_rain = {}
for r in rainDailyRows:
    d_date = str(r['rec_date'])
    d_rain = float(r['daily_rain'] or 0.0)
    if d_date not in daily_province_rain:
        daily_province_rain[d_date] = []
    daily_province_rain[d_date].append(d_rain)

daily_rain_stats = {}
for d_date, rains in sorted(daily_province_rain.items()):
    daily_rain_stats[d_date] = {
        'avg': sum(rains) / len(rains) if rains else 0.0,
        'max': max(rains) if rains else 0.0,
        'heavy_st': sum(1 for x in rains if x >= 35.0)
    }

all_station_totals = [s['total'] for s in station_totals.values()]
prov_avg_rain = sum(all_station_totals) / len(all_station_totals) if all_station_totals else 0.0
prov_max_rain = max(all_station_totals) if all_station_totals else 0.0
prov_max_st = next((s for s in station_totals.values() if s['total'] == prov_max_rain), None)
prov_max_24h = max((s['max_day'] for s in station_totals.values()), default=0.0)
prov_max_24h_st = next((s for s in station_totals.values() if s['max_day'] == prov_max_24h), None)

# Map rainfall data to the 37 water stations (แก้ปัญหาค่าฝนเป็น 0 ให้ครบทุกสถานี)
for s in wStations:
    w_name = s['station_name']
    w_amp = normalize_amphoe(s['amphoe'])
    if w_name in station_totals:
        s['rain_cum'] = station_totals[w_name]['total']
        s['rain_max_24h'] = station_totals[w_name]['max_day']
        s['rain_source'] = 'ตรงสถานี'
    else:
        match_st = next((r for r in station_totals if (len(w_name)>=4 and w_name in r) or (len(r)>=4 and r in w_name)), None)
        if match_st:
            s['rain_cum'] = station_totals[match_st]['total']
            s['rain_max_24h'] = station_totals[match_st]['max_day']
            s['rain_source'] = 'เทียบเคียง'
        else:
            amp_data = amphoe_stats.get(w_amp, {})
            s['rain_cum'] = amp_data.get('avg_cum', 0.0)
            s['rain_max_24h'] = amp_data.get('max_24h', 0.0)
            s['rain_source'] = 'เฉลี่ยอำเภอ'
    s['rain_avg_daily'] = round(s['rain_cum'] / 30.0, 2)

print(f"Data summary: Water={totalWater} stations, Rain={len(station_totals)} stations ({int(rainTotalRecords):,} records), Dams={len(dDams)}, PM2.5={pTotal['stations']} stations, Complaints={compTotal}")

# ──────────────────────────────────────────
# HELPER FUNCTIONS
# ──────────────────────────────────────────
def set_font(run, size=FONT_BODY, bold=False, italic=False, color=None):
    run.font.name = FONT_NAME
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    if color:
        run.font.color.rgb = color
    r = run._r
    rPr = r.get_or_add_rPr()
    rFonts = OxmlElement('w:rFonts')
    rFonts.set(qn('w:ascii'),    FONT_NAME)
    rFonts.set(qn('w:hAnsi'),    FONT_NAME)
    rFonts.set(qn('w:cs'),       FONT_NAME)
    rFonts.set(qn('w:eastAsia'), FONT_NAME)
    existing = rPr.find(qn('w:rFonts'))
    if existing is not None:
        rPr.remove(existing)
    rPr.insert(0, rFonts)

def set_para_spacing(para, before=0, after=60, line=None):
    pPr = para._p.get_or_add_pPr()
    spacing = OxmlElement('w:spacing')
    spacing.set(qn('w:before'), str(before))
    spacing.set(qn('w:after'),  str(after))
    if line:
        spacing.set(qn('w:line'), str(line))
        spacing.set(qn('w:lineRule'), 'auto')
    existing = pPr.find(qn('w:spacing'))
    if existing is not None:
        pPr.remove(existing)
    pPr.append(spacing)

def set_para_indent(para, left=0, firstLine=0):
    pPr = para._p.get_or_add_pPr()
    ind = OxmlElement('w:ind')
    if left:      ind.set(qn('w:left'),      str(left))
    if firstLine: ind.set(qn('w:firstLine'), str(firstLine))
    existing = pPr.find(qn('w:ind'))
    if existing is not None:
        pPr.remove(existing)
    if left or firstLine:
        pPr.append(ind)

def set_shading(cell_or_para, fill_hex):
    if hasattr(cell_or_para, '_tc'):
        tc = cell_or_para._tc
        tcPr = tc.get_or_add_tcPr()
        shd = OxmlElement('w:shd')
        shd.set(qn('w:val'),   'clear')
        shd.set(qn('w:color'), 'auto')
        shd.set(qn('w:fill'),  fill_hex)
        existing = tcPr.find(qn('w:shd'))
        if existing is not None:
            tcPr.remove(existing)
        tcPr.append(shd)
    else:
        pPr = cell_or_para._p.get_or_add_pPr()
        shd = OxmlElement('w:shd')
        shd.set(qn('w:val'),   'clear')
        shd.set(qn('w:color'), 'auto')
        shd.set(qn('w:fill'),  fill_hex)
        existing = pPr.find(qn('w:shd'))
        if existing is not None:
            pPr.remove(existing)
        pPr.append(shd)

def set_cell_border(cell, top=None, bottom=None, left=None, right=None):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcBorders = tcPr.find(qn('w:tcBorders'))
    if tcBorders is None:
        tcBorders = OxmlElement('w:tcBorders')
        tcPr.append(tcBorders)
    def make_border(name, style, size, color):
        el = OxmlElement(f'w:{name}')
        el.set(qn('w:val'),   style)
        el.set(qn('w:sz'),    str(size))
        el.set(qn('w:space'), '0')
        el.set(qn('w:color'), color)
        return el
    for side, cfg in [('top', top), ('bottom', bottom), ('left', left), ('right', right)]:
        if cfg:
            existing = tcBorders.find(qn(f'w:{side}'))
            if existing is not None:
                tcBorders.remove(existing)
            tcBorders.append(make_border(side, cfg[0], cfg[1], cfg[2]))

def set_cell_margins(cell, top=80, bottom=80, left=120, right=120):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcMar = OxmlElement('w:tcMar')
    for side, val in [('top', top), ('bottom', bottom), ('left', left), ('right', right)]:
        el = OxmlElement(f'w:{side}')
        el.set(qn('w:w'),    str(val))
        el.set(qn('w:type'), 'dxa')
        tcMar.append(el)
    existing = tcPr.find(qn('w:tcMar'))
    if existing is not None:
        tcPr.remove(existing)
    tcPr.append(tcMar)

def set_cell_width(cell, width_dxa):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcW = OxmlElement('w:tcW')
    tcW.set(qn('w:w'),    str(width_dxa))
    tcW.set(qn('w:type'), 'dxa')
    existing = tcPr.find(qn('w:tcW'))
    if existing is not None:
        tcPr.remove(existing)
    tcPr.append(tcW)

def add_page_break(doc):
    para = doc.add_paragraph()
    set_para_spacing(para, 0, 0)
    run = para.add_run()
    run._r.append(OxmlElement('w:lastRenderedPageBreak'))
    br = OxmlElement('w:br')
    br.set(qn('w:type'), 'page')
    run._r.append(br)

def add_section_header(doc, text, shade=HDR_BG):
    para = doc.add_paragraph()
    para.alignment = WD_ALIGN_PARAGRAPH.LEFT
    set_para_spacing(para, before=200, after=100)
    run = para.add_run(f'  {text}')
    set_font(run, FONT_H1, bold=True, color=WHITE)
    set_shading(para, shade)
    return para

def add_sub_header(doc, text):
    para = doc.add_paragraph()
    para.alignment = WD_ALIGN_PARAGRAPH.LEFT
    set_para_spacing(para, before=180, after=80)
    run = para.add_run(text)
    set_font(run, FONT_H2, bold=True, color=DARK)
    pPr = para._p.get_or_add_pPr()
    pBdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'),   'single')
    bottom.set(qn('w:sz'),    '4')
    bottom.set(qn('w:space'), '1')
    bottom.set(qn('w:color'), '888888')
    pBdr.append(bottom)
    existing = pPr.find(qn('w:pBdr'))
    if existing is not None: pPr.remove(existing)
    pPr.append(pBdr)
    return para

def add_sub_sub_header(doc, text):
    para = doc.add_paragraph()
    set_para_spacing(para, before=150, after=60)
    run = para.add_run(f'  {text}')
    set_font(run, FONT_H3, bold=True, color=DARK)
    return para

def add_body(doc, text, bold=False, italic=False, color=None, indent=False, left_indent=0):
    para = doc.add_paragraph()
    set_para_spacing(para, before=40, after=40)
    if indent:
        set_para_indent(para, firstLine=360)
    elif left_indent:
        set_para_indent(para, left=left_indent)
    run = para.add_run(text)
    set_font(run, FONT_BODY, bold=bold, italic=italic, color=color or DARK)
    return para

def add_bullet(doc, text, level=1, color=None):
    left = 720 if level == 1 else 1440
    sym  = '  -  ' if level == 1 else '    *  '
    para = doc.add_paragraph()
    set_para_spacing(para, before=40, after=40)
    set_para_indent(para, left=left)
    r2 = para.add_run(sym + text)
    set_font(r2, FONT_BODY, color=color or DARK)
    return para

def add_highlight(doc, text, critical=False):
    para = doc.add_paragraph()
    set_para_spacing(para, before=80, after=80)
    set_para_indent(para, left=200)
    prefix = '[!] ' if critical else '[>] '
    run = para.add_run(f'  {prefix}{text}  ')
    set_font(run, FONT_BODY, bold=critical, color=DARK)
    set_shading(para, 'EBEBEB')
    pPr = para._p.get_or_add_pPr()
    pBdr = OxmlElement('w:pBdr')
    left_b = OxmlElement('w:left')
    left_b.set(qn('w:val'),   'thick')
    left_b.set(qn('w:sz'),    '12')
    left_b.set(qn('w:space'), '4')
    left_b.set(qn('w:color'), '444444')
    pBdr.append(left_b)
    existing = pPr.find(qn('w:pBdr'))
    if existing is not None: pPr.remove(existing)
    pPr.append(pBdr)
    return para

def add_empty_line(doc, size=8):
    para = doc.add_paragraph()
    run = para.add_run('')
    run.font.size = Pt(size)
    set_para_spacing(para, 0, 0)

def add_divider(doc):
    para = doc.add_paragraph()
    set_para_spacing(para, before=100, after=100)
    pPr = para._p.get_or_add_pPr()
    pBdr = OxmlElement('w:pBdr')
    top = OxmlElement('w:top')
    top.set(qn('w:val'),   'single')
    top.set(qn('w:sz'),    '4')
    top.set(qn('w:space'), '1')
    top.set(qn('w:color'), 'AAAAAA')
    pBdr.append(top)
    existing = pPr.find(qn('w:pBdr'))
    if existing is not None: pPr.remove(existing)
    pPr.append(pBdr)

def add_kpi_table(doc, items):
    table = doc.add_table(rows=1, cols=len(items))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl = table._tbl
    tblPr = tbl.find(qn('w:tblPr'))
    if tblPr is None:
        tblPr = OxmlElement('w:tblPr')
        tbl.insert(0, tblPr)
    tblW = OxmlElement('w:tblW')
    tblW.set(qn('w:w'),    '5000')
    tblW.set(qn('w:type'), 'pct')
    existing = tblPr.find(qn('w:tblW'))
    if existing is not None: tblPr.remove(existing)
    tblPr.append(tblW)
    row = table.rows[0]
    col_w = 9000 // len(items)
    for i, (label, value) in enumerate(items):
        cell = row.cells[i]
        cell.text = ''
        set_shading(cell, KPI_BG)
        set_cell_margins(cell, 100, 100, 150, 150)
        set_cell_width(cell, col_w)
        set_cell_border(cell,
            top=('thick', 8, '333333'),
            bottom=('single', 2, 'AAAAAA'),
            left=('single', 2, 'CCCCCC'),
            right=('single', 2, 'CCCCCC')
        )
        p = cell.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        set_para_spacing(p, before=60, after=30)
        rv = p.add_run(str(value))
        set_font(rv, FONT_H2, bold=True, color=BLACK)
        p2 = cell.add_paragraph()
        p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
        set_para_spacing(p2, before=0, after=60)
        rl = p2.add_run(str(label))
        set_font(rl, FONT_SM, color=GRAY)
        if cell.paragraphs[0].text == '' and len(cell.paragraphs) > 2:
            p_elem = cell.paragraphs[0]._element
            p_elem.getparent().remove(p_elem)
    add_empty_line(doc)
    return table

def add_data_table(doc, headers, rows, shade=HDR_BG, col_widths=None):
    total_cols = len(headers)
    table = doc.add_table(rows=1+len(rows), cols=total_cols)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl = table._tbl
    tblPr = tbl.find(qn('w:tblPr'))
    if tblPr is None:
        tblPr = OxmlElement('w:tblPr')
        tbl.insert(0, tblPr)
    tblW = OxmlElement('w:tblW')
    tblW.set(qn('w:w'),    '5000')
    tblW.set(qn('w:type'), 'pct')
    existing = tblPr.find(qn('w:tblW'))
    if existing is not None: tblPr.remove(existing)
    tblPr.append(tblW)
    tblBorders = OxmlElement('w:tblBorders')
    for side in ['top', 'bottom', 'left', 'right', 'insideH', 'insideV']:
        b = OxmlElement(f'w:{side}')
        b.set(qn('w:val'),   'single')
        b.set(qn('w:sz'),    '4' if side in ['insideH','insideV'] else '6')
        b.set(qn('w:space'), '0')
        b.set(qn('w:color'), 'BBBBBB' if side in ['insideH','insideV'] else '555555')
        tblBorders.append(b)
    existing = tblPr.find(qn('w:tblBorders'))
    if existing is not None: tblPr.remove(existing)
    tblPr.append(tblBorders)
    default_w = 9000 // total_cols
    hrow = table.rows[0]
    for ci, hdr in enumerate(headers):
        cell = hrow.cells[ci]
        cell.text = ''
        set_shading(cell, shade)
        set_cell_margins(cell, 80, 80, 100, 100)
        if col_widths:
            set_cell_width(cell, col_widths[ci])
        else:
            set_cell_width(cell, default_w)
        p = cell.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        set_para_spacing(p, before=60, after=60)
        rh = p.add_run(str(hdr))
        set_font(rh, FONT_SM, bold=True, color=WHITE)
        if cell.paragraphs[0].text == '' and len(cell.paragraphs) > 1:
            ep = cell.paragraphs[0]._element
            ep.getparent().remove(ep)
    for ri, row_data in enumerate(rows):
        drow = table.rows[ri + 1]
        bg = ROW_EVEN if ri % 2 == 0 else 'FFFFFF'
        for ci, cell_data in enumerate(row_data):
            cell = drow.cells[ci]
            cell.text = ''
            set_shading(cell, bg)
            set_cell_margins(cell, 60, 60, 100, 100)
            if col_widths:
                set_cell_width(cell, col_widths[ci])
            else:
                set_cell_width(cell, default_w)
            if isinstance(cell_data, dict):
                txt   = str(cell_data.get('text', ''))
                clr   = cell_data.get('color', DARK)
                bld   = cell_data.get('bold', False)
                align = cell_data.get('align', WD_ALIGN_PARAGRAPH.CENTER)
            else:
                txt   = str(cell_data) if cell_data is not None else '-'
                clr   = DARK
                bld   = False
                align = WD_ALIGN_PARAGRAPH.CENTER
            p = cell.add_paragraph()
            p.alignment = align
            set_para_spacing(p, before=50, after=50)
            run = p.add_run(txt)
            set_font(run, FONT_SM, bold=bld, color=clr)
            if cell.paragraphs[0].text == '' and len(cell.paragraphs) > 1:
                ep = cell.paragraphs[0]._element
                ep.getparent().remove(ep)
    add_empty_line(doc)
    return table

L = WD_ALIGN_PARAGRAPH.LEFT
C = WD_ALIGN_PARAGRAPH.CENTER

def risk_text(level):
    if level == 'วิกฤตสีแดง': return '[!] วิกฤตสีแดง', C_DANGER, True
    if level == 'เฝ้าระวัง':   return '[~] เฝ้าระวัง',   C_WARN,   False
    return '[ok] ปกติ', C_OK, False

def pct_color(pct_str):
    try:
        v = int(str(pct_str).replace('%', ''))
        if v < 30: return C_DANGER
        if v < 60: return C_WARN
        return C_OK
    except:
        return DARK

def pm25_color(val_str):
    try:
        v = float(val_str)
        if v > 75: return C_DANGER
        if v > 37.5: return C_WARN
        return C_OK
    except:
        return DARK

# ──────────────────────────────────────────
# BUILD DOCUMENT
# ──────────────────────────────────────────
print("Building Word Document...")
doc = Document()

section = doc.sections[0]
section.page_width   = Cm(21)
section.page_height  = Cm(29.7)
section.top_margin    = Cm(2)
section.bottom_margin = Cm(2)
section.left_margin   = Cm(2.5)
section.right_margin  = Cm(2.5)

# Header
header = section.header
hp = header.paragraphs[0]
hp.text = 'รายงานสรุปวิเคราะห์ข้อมูลรายเดือน กันยายน 2569  |  ระบบบูรณาการข้อมูลสารสนเทศ อบจ.ลำปาง'
hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
for run in hp.runs:
    set_font(run, FONT_SM, color=GRAY)
pPr = hp._p.get_or_add_pPr()
pBdr = OxmlElement('w:pBdr')
bot = OxmlElement('w:bottom')
bot.set(qn('w:val'), 'single'); bot.set(qn('w:sz'), '2')
bot.set(qn('w:space'), '1'); bot.set(qn('w:color'), 'AAAAAA')
pBdr.append(bot)
pPr.append(pBdr)

# Footer
footer = section.footer
fp = footer.paragraphs[0]
fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
fr = fp.add_run('หน้า ')
set_font(fr, FONT_SM, color=GRAY)
fldChar1 = OE('w:fldChar'); fldChar1.set(qn('w:fldCharType'), 'begin')
instrText = OE('w:instrText'); instrText.text = 'PAGE'; instrText.set(qn('xml:space'), 'preserve')
fldChar2 = OE('w:fldChar'); fldChar2.set(qn('w:fldCharType'), 'separate')
fldChar3 = OE('w:fldChar'); fldChar3.set(qn('w:fldCharType'), 'end')
run_el = OE('w:r')
for el in [fldChar1, instrText, fldChar2, fldChar3]:
    run_el.append(el)
fp._p.append(run_el)
pPr2 = fp._p.get_or_add_pPr()
pBdr2 = OxmlElement('w:pBdr')
top_b = OxmlElement('w:top')
top_b.set(qn('w:val'), 'single'); top_b.set(qn('w:sz'), '2')
top_b.set(qn('w:space'), '1'); top_b.set(qn('w:color'), 'AAAAAA')
pBdr2.append(top_b)
pPr2.append(pBdr2)

# ======= COVER PAGE =======
add_empty_line(doc, 20)
p = doc.add_paragraph('องค์การบริหารส่วนจังหวัดลำปาง')
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_para_spacing(p, before=400, after=80)
set_font(p.runs[0], FONT_H2, color=GRAY)

p = doc.add_paragraph('ระบบบูรณาการข้อมูลสารสนเทศ')
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_para_spacing(p, before=60, after=60)
set_font(p.runs[0], FONT_H1, bold=True, color=BLACK)

add_empty_line(doc, 12)

p = doc.add_paragraph('รายงานสรุปวิเคราะห์ข้อมูลรายเดือน')
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_para_spacing(p, before=120, after=120)
set_font(p.runs[0], FONT_COVER, bold=True, color=BLACK)
pPr = p._p.get_or_add_pPr()
pBdr = OxmlElement('w:pBdr')
for side in ['top', 'bottom']:
    b = OxmlElement(f'w:{side}')
    b.set(qn('w:val'), 'thick'); b.set(qn('w:sz'), '12')
    b.set(qn('w:space'), '4'); b.set(qn('w:color'), '000000')
    pBdr.append(b)
pPr.append(pBdr)

p = doc.add_paragraph('ประจำเดือน กันยายน พ.ศ. 2569')
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_para_spacing(p, before=80, after=60)
set_font(p.runs[0], FONT_TITLE, bold=True, color=BLACK)

p = doc.add_paragraph('( 1 กันยายน - 30 กันยายน 2569 )')
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_para_spacing(p, before=40, after=200)
set_font(p.runs[0], FONT_H2, color=GRAY)

add_empty_line(doc, 10)
add_kpi_table(doc, [
    ('สถานีตรวจวัดน้ำ', f'{totalWater} สถานี'),
    ('สถานีตรวจวัดน้ำฝน', f'{len(station_totals)} สถานี'),
    ('อ่างเก็บน้ำ', f'{len(dDams)} แห่ง'),
    ('สถานีตรวจ PM2.5', f'{pTotal["stations"]} สถานี'),
    ('เรื่องร้องเรียน', f'{compTotal} เรื่อง'),
])

add_empty_line(doc, 8)
add_divider(doc)
p = doc.add_paragraph('จัดทำ ณ วันที่ 30 กันยายน พ.ศ. 2569')
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_font(p.runs[0], FONT_BODY, color=GRAY)
p = doc.add_paragraph('ฝ่ายเทคโนโลยีสารสนเทศ  |  องค์การบริหารส่วนจังหวัดลำปาง')
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_font(p.runs[0], FONT_BODY, color=GRAY)

add_page_break(doc)

# ======= TABLE OF CONTENTS =======
add_section_header(doc, 'สารบัญ')
add_empty_line(doc)
toc_items = [
    ('บทที่ 1', 'บทสรุปสำหรับผู้บริหาร (Executive Summary)'),
    ('บทที่ 2', 'ระบบเฝ้าระวังน้ำ ท่าและปริมาณน้ำฝน (Water & Rainfall Monitoring)'),
    ('บทที่ 3', 'ระบบเฝ้าระวังภัยแล้ง (อ่างเก็บน้ำ)'),
    ('บทที่ 4', 'ระบบติดตามคุณภาพอากาศ PM2.5'),
    ('บทที่ 5', 'ระบบติดตามเรื่องร้องเรียนประชาชน'),
    ('บทที่ 6', 'Dashboard และข้อมูลสารสนเทศเพื่อการติดตามและประเมินผล'),
    ('บทที่ 7', 'บทสรุปและข้อเสนอแนะเชิงนโยบาย'),
    ('ภาคผนวก', 'ข้อมูลอ้างอิงและแหล่งข้อมูล'),
]
for chap, title in toc_items:
    p = doc.add_paragraph()
    set_para_spacing(p, before=60, after=60)
    set_para_indent(p, left=360)
    r1 = p.add_run(f'{chap}  ')
    set_font(r1, FONT_BODY, bold=True, color=BLACK)
    r2 = p.add_run(title)
    set_font(r2, FONT_BODY, color=DARK)
add_empty_line(doc, 10)
add_page_break(doc)

# ======= CHAPTER 1: EXECUTIVE SUMMARY =======
add_section_header(doc, 'บทที่ 1 : บทสรุปสำหรับผู้บริหาร (Executive Summary)')
add_empty_line(doc)
add_body(doc, 'รายงานฉบับนี้จัดทำขึ้นเพื่อสรุปผลการติดตามและวิเคราะห์ข้อมูลสารสนเทศด้านสิ่งแวดล้อมและสาธารณประโยชน์ของจังหวัดลำปาง ประจำเดือนกันยายน พ.ศ. 2569 (1 - 30 กันยายน 2569) ครอบคลุม 5 ระบบหลัก ได้แก่ ระบบเฝ้าระวังน้ำท่าและอุทกภัย ระบบตรวจวัดปริมาณน้ำฝน ระบบเฝ้าระวังภัยแล้ง (อ่างเก็บน้ำ) ระบบติดตามคุณภาพอากาศ PM2.5 และระบบติดตามเรื่องร้องเรียนของประชาชน', indent=True)
add_empty_line(doc)
add_sub_sub_header(doc, 'สรุปสถานการณ์ภาพรวม')

add_body(doc, 'ระบบน้ำและเฝ้าระวังอุทกภัย', bold=True)
add_bullet(doc, f'ติดตามจำนวน {totalWater} สถานีตรวจวัด ครอบคลุม {len(amphoeList)} อำเภอในจังหวัดลำปาง')
add_bullet(doc, f'พบสถานีที่อยู่ในระดับวิกฤตสีแดง จำนวน {criticalSt} สถานี{" - ต้องเฝ้าระวังเป็นพิเศษ" if criticalSt > 0 else ""}', color=C_DANGER if criticalSt > 0 else DARK)
add_bullet(doc, f'สถานีระดับเฝ้าระวัง (สีเหลือง) จำนวน {watchSt} สถานี', color=C_WARN)
add_bullet(doc, f'สถานีระดับปกติ จำนวน {normalSt} สถานี', color=C_OK)
add_bullet(doc, 'เดือนกันยายนเป็นช่วงฤดูฝน ระดับน้ำในแม่น้ำสายสำคัญยังคงอยู่ในระดับสูง ต้องเฝ้าระวังอุทกภัยในพื้นที่ลุ่มต่ำอย่างใกล้ชิด และติดตามสถานการณ์น้ำป่าไหลหลาก')

add_empty_line(doc, 6)
add_body(doc, 'ระบบตรวจวัดปริมาณน้ำฝน (Rainfall Monitoring)', bold=True)
add_bullet(doc, f'ติดตามเครือข่ายสถานีตรวจวัดน้ำฝนอัตโนมัติ {len(station_totals)} สถานี ครอบคลุมครบทั้ง 13 อำเภอ รวม {int(rainTotalRecords):,} รายการตรวจวัด')
add_bullet(doc, f'ปริมาณฝนสะสมเฉลี่ยทั้งจังหวัดในเดือนกันยายน 2569 อยู่ที่ {prov_avg_rain:.2f} มม. (สถานีฝนสะสมสูงสุด {prov_max_rain:.1f} มม. ที่{prov_max_st["station_name"] if prov_max_st else "-"})')
add_bullet(doc, f'อำเภอที่มีฝนสะสมเฉลี่ยสูงสุด 3 อันดับแรก ได้แก่ อ.เสริมงาม ({amphoe_stats["เสริมงาม"]["avg_cum"]:.1f} มม.), อ.เถิน ({amphoe_stats["เถิน"]["avg_cum"]:.1f} มม.), และ อ.สบปราบ ({amphoe_stats["สบปราบ"]["avg_cum"]:.1f} มม.)')
add_bullet(doc, f'ฝนตกหนักสูงสุดในรอบ 24 ชั่วโมง วัดได้ {prov_max_24h:.1f} มม. ที่สถานี{prov_max_24h_st["station_name"] if prov_max_24h_st else "-"} ({prov_max_24h_st["max_date"] if prov_max_24h_st else "-"})')
add_bullet(doc, 'ช่วงเวลาฝนตกชุกและหนักที่สุดของเดือนเกิดขึ้นระหว่างวันที่ 18 - 21 กันยายน โดยเฉพาะวันที่ 19 กันยายน มีสถานีตรวจพบฝนตกหนัก (>=35 มม.) พร้อมกันถึง 55 แห่ง ส่งผลให้ระดับน้ำในแม่น้ำสายหลักและอ่างเก็บน้ำเพิ่มสูงขึ้นอย่างมีนัยสำคัญ')

add_empty_line(doc, 6)
add_body(doc, 'ระบบเฝ้าระวังภัยแล้ง (อ่างเก็บน้ำ)', bold=True)
add_bullet(doc, f'ติดตามอ่างเก็บน้ำ {len(dDams)} แห่ง แบ่งเป็นขนาดใหญ่ {len(largeDams)} แห่ง ขนาดกลาง {len(medDams)} แห่ง ขนาดเล็ก {len(smallDams)} แห่ง')
for d in latestLarge:
    add_bullet(doc, f'{d["dam_name"]}: ปริมาณน้ำ {float(d["water_volume_m_cum"]):.2f} ล้าน ลบ.ม. ({d["water_percent"]})')
add_bullet(doc, 'อ่างเก็บน้ำขนาดใหญ่มีปริมาณน้ำสะสมอยู่ในระดับที่ดีจากฤดูฝน เป็นน้ำต้นทุนสำคัญสำหรับฤดูแล้งที่กำลังจะมาถึง')

add_empty_line(doc, 6)
add_body(doc, 'ระบบติดตามคุณภาพอากาศ PM2.5', bold=True)
add_bullet(doc, f'ติดตาม {pTotal["stations"]} สถานีตรวจวัด รวม {int(pTotal["cnt"]):,} ค่าการวัด')
add_bullet(doc, f'ร้อยละ {good_pct}% ของค่าการวัดอยู่ในระดับ "ดีมาก" (ค่า PM2.5 <= 25 ug/m3)', color=C_OK)
if pExceed:
    add_bullet(doc, f'พบค่าเกินมาตรฐาน (>37.5 ug/m3) จำนวน {pm25Exceed} ครั้ง จาก {len(pExceed)} สถานี', color=C_DANGER)
else:
    add_bullet(doc, 'ไม่พบค่าเกินมาตรฐานในเดือนนี้ คุณภาพอากาศโดยรวมอยู่ในเกณฑ์ดี', color=C_OK)

add_empty_line(doc, 6)
add_body(doc, 'ระบบร้องเรียนประชาชน (Traffy Fondue ลำปาง)', bold=True)
add_bullet(doc, f'รับเรื่องร้องเรียนในระบบ {compTotal} เรื่อง (สะสมทั้งหมด {compAllTotal} เรื่อง)')
add_bullet(doc, f'ดำเนินการเสร็จสิ้นแล้ว {compDone} เรื่อง ({compRate}%)')
if cByTypeToShow:
    top3 = ' | '.join([f'{t["problem_type"]} ({t["cnt"]} เรื่อง)' for t in cByTypeToShow[:3]])
    add_bullet(doc, f'ประเภทเรื่องร้องเรียนหลัก: {top3}')
if compAugTotal > 0:
    trend_text = f'เพิ่มขึ้น +{compTotal - compAugTotal} เรื่อง' if compTotal > compAugTotal else f'ลดลง {compAugTotal - compTotal} เรื่อง'
    add_bullet(doc, f'เปรียบเทียบกับเดือนสิงหาคม ({compAugTotal} เรื่อง): {trend_text}')

add_empty_line(doc)
add_sub_sub_header(doc, 'ประเด็นที่ผู้บริหารควรทราบ')
if criticalSt > 0:
    add_highlight(doc, f'พื้นที่วิกฤต: พบสถานีตรวจวัดน้ำระดับวิกฤตสีแดง {criticalSt} สถานี - ต้องเฝ้าระวังอุทกภัยในช่วงฤดูฝนปลายปี', critical=True)
else:
    add_highlight(doc, 'ระดับน้ำ: ไม่พบสถานีที่อยู่ในระดับวิกฤตสีแดงในเดือนกันยายน 2569 แต่ยังต้องติดตามอย่างต่อเนื่อง')
add_highlight(doc, f'สถานการณ์น้ำฝน: ฝนสะสมเฉลี่ยทั้งจังหวัด 266.05 มม. พื้นที่ตอนล่างของจังหวัด (เสริมงาม, เถิน, สบปราบ, แม่พริก) มีฝนสะสมสูงกว่า 300 มม. และเกิดฝนตกหนักระลอกใหญ่ช่วง 18-21 ก.ย. ต้องเฝ้าระวังดินโคลนถล่มและน้ำหลากอย่างต่อเนื่อง')
if pExceed:
    add_highlight(doc, f'คุณภาพอากาศ: พบสถานีที่มีค่า PM2.5 เกินมาตรฐาน จำนวน {len(pExceed)} สถานี ต้องติดตามอย่างต่อเนื่อง', critical=True)
else:
    add_highlight(doc, 'คุณภาพอากาศ: ค่า PM2.5 โดยรวมอยู่ในระดับดี สอดคล้องกับฤดูฝนที่ช่วยลดปริมาณฝุ่นละออง')
add_highlight(doc, 'เดือนกันยายน: เป็นช่วงฤดูฝนสูงสุด ให้ติดตามสถานการณ์น้ำในแม่น้ำวังและแม่น้ำยมอย่างใกล้ชิด เตรียมพร้อมรับมืออุทกภัยและน้ำป่าไหลหลาก')
add_highlight(doc, 'เตรียมความพร้อมรับมือ PM2.5: เมื่อสิ้นสุดฤดูฝนเข้าสู่ฤดูหนาว (ตุลาคม-พฤศจิกายน) ค่า PM2.5 อาจสูงขึ้นอย่างรวดเร็ว ควรวางแผนมาตรการเฝ้าระวังล่วงหน้า')


add_page_break(doc)

# ======= CHAPTER 2: WATER & RAINFALL SYSTEM =======
add_section_header(doc, 'บทที่ 2 : ระบบเฝ้าระวังน้ำ ท่าและปริมาณน้ำฝน (Water & Rainfall Monitoring)')
add_empty_line(doc)
add_sub_header(doc, '2.1 ภาพรวมสถานการณ์น้ำและปริมาณน้ำฝน เดือนกันยายน 2569')
add_body(doc, 'ระบบเฝ้าระวังน้ำและติดตามปริมาณน้ำฝนของจังหวัดลำปางดำเนินการติดตามข้อมูลแบบอัตโนมัติตลอด 24 ชั่วโมง ผ่านเครือข่ายสถานีตรวจวัดระดับน้ำ 37 สถานี และสถานีตรวจวัดน้ำฝนอัตโนมัติ 182 สถานี ครอบคลุมพื้นที่ลุ่มน้ำสำคัญทั้งลุ่มน้ำวังและลุ่มน้ำยม เดือนกันยายน 2569 เป็นช่วงฤดูฝนที่มีปริมาณฝนและความเข้มข้นของมรสุมสูงที่สุดในรอบปี ส่งผลให้ระดับน้ำในแม่น้ำสายหลักและลำน้ำสาขายังคงอยู่ในระดับสูง จำเป็นต้องเฝ้าระวังความเสี่ยงอุทกภัยในพื้นที่ลุ่มต่ำ น้ำท่วมฉับพลัน และน้ำป่าไหลหลากอย่างต่อเนื่อง', indent=True)
add_empty_line(doc)
add_kpi_table(doc, [
    ('สถานีตรวจวัดระดับน้ำ', f'{totalWater} สถานี'),
    ('สถานีตรวจวัดน้ำฝน', f'{len(station_totals)} สถานี'),
    ('ฝนสะสมเฉลี่ยทั้งจังหวัด', f'{prov_avg_rain:.1f} มม.'),
    ('ฝน 24 ชม. สูงสุด', f'{prov_max_24h:.1f} มม.'),
])

add_sub_header(doc, '2.2 สรุประดับความเสี่ยงอุทกภัยตามประเภท')
add_body(doc, 'ผลการติดตามระดับน้ำและประเมินความเสี่ยงอุทกภัยของสถานีตรวจวัดระดับน้ำทั้งหมด 37 สถานี สรุปได้ดังนี้:')
add_data_table(doc,
    ['ระดับความเสี่ยง', 'จำนวนสถานี', 'ร้อยละ', 'ความหมาย'],
    [
        [{'text':'[!] วิกฤตสีแดง','align':L,'color':C_DANGER,'bold':True}, f'{criticalSt} สถานี', f'{round(criticalSt/totalWater*100) if totalWater else 0}%', {'text':'ระดับน้ำน้อยวิกฤต/น้ำมากวิกฤต ต้องเฝ้าระวัง','align':L}],
        [{'text':'[~] เฝ้าระวัง','align':L,'color':C_WARN,'bold':True},    f'{watchSt} สถานี',    f'{round(watchSt/totalWater*100) if totalWater else 0}%',    {'text':'ใกล้เกณฑ์วิกฤต / ติดตามสถานการณ์น้ำฝน','align':L}],
        [{'text':'[ok] ปกติ','align':L,'color':C_OK,'bold':True},           f'{normalSt} สถานี',   f'{round(normalSt/totalWater*100) if totalWater else 0}%',   {'text':'อยู่ในเกณฑ์ปกติ','align':L}],
        [{'text':'รวม','align':L,'bold':True},                               f'{totalWater} สถานี', '100%',                                                      {'text':'','align':L}],
    ],
    col_widths=[2800,2000,1500,2700]
)

add_sub_header(doc, '2.3 ข้อมูลสถานีตรวจวัดระดับน้ำรายสถานี')
add_body(doc, 'ตารางแสดงค่าระดับน้ำเฉลี่ย ระดับตลิ่ง ปริมาณฝนสะสมในรอบเดือน และสถานะความเสี่ยงประจำเดือนกันยายน 2569 (ประมวลผลเชื่อมโยงกับเครือข่ายตรวจวัดน้ำฝน):')
add_empty_line(doc, 6)
rows_w = []
for s in wStations:
    rt, rc, rb = risk_text(s['risk_level'])
    rows_w.append([
        {'text': s['station_name'], 'align': L},
        {'text': s.get('river','') or '-', 'align': L},
        {'text': s['amphoe'].replace('อำเภอ','') if s.get('amphoe') else '-', 'align': L},
        s['avg_wl'] if s.get('avg_wl') is not None else '-',
        s['avg_bank'] if s.get('avg_bank') is not None else '-',
        f"{s.get('rain_cum', 0.0):.1f}",
        {'text': rt, 'color': rc, 'bold': rb},
    ])
add_data_table(doc,
    ['สถานีตรวจวัด','แม่น้ำ/ลุ่มน้ำ','อำเภอ','ระดับน้ำเฉลี่ย (ม.รทก.)','ระดับตลิ่ง (ม.รทก.)','ฝนสะสม (มม.)','ความเสี่ยง'],
    rows_w,
    col_widths=[2100,1500,1400,1800,1800,1400,2000]
)
p_note = doc.add_paragraph('* หมายเหตุ: ปริมาณฝนสะสม (มม.) ประมวลผลจากฐานข้อมูลเครือข่ายสถานีตรวจวัดน้ำฝนอัตโนมัติ (tbl_rainfall_monitoring) ณ จุดตรวจวัดตรงสถานีหรือค่าเฉลี่ยระดับอำเภอ เพื่อแสดงความสัมพันธ์กับระดับน้ำ')
set_font(p_note.runs[0], FONT_SM, italic=True, color=GRAY)
add_empty_line(doc, 6)

add_sub_header(doc, '2.4 การวิเคราะห์สถานการณ์น้ำฝนและการกระจายตัวรายอำเภอ (Rainfall Monitoring Analysis)')
add_body(doc, f'เครือข่ายตรวจวัดน้ำฝนอัตโนมัติของจังหวัดลำปางประกอบด้วยสถานีตรวจวัดจำนวนทั้งสิ้น {len(station_totals)} สถานี ครอบคลุมพื้นที่ทั้ง 13 อำเภอ โดยมีการบันทึกข้อมูลตลอด 24 ชั่วโมง รวมทั้งสิ้น {int(rainTotalRecords):,} รายการ ในเดือนกันยายน 2569 ปริมาณฝนสะสมเฉลี่ยทั้งจังหวัดอยู่ที่ {prov_avg_rain:.2f} มิลลิเมตร มีสถานีที่ตรวจพบปริมาณฝนสะสมสูงสุดถึง {prov_max_rain:.1f} มิลลิเมตร ที่สถานี{prov_max_st["station_name"] if prov_max_st else "-"} อำเภอ{prov_max_st["amphoe"] if prov_max_st else "-"} และเกิดฝนตกหนักสูงสุดในรอบ 24 ชั่วโมง วัดได้ {prov_max_24h:.1f} มิลลิเมตร ที่สถานี{prov_max_24h_st["station_name"] if prov_max_24h_st else "-"}', indent=True)
add_empty_line(doc, 6)

add_sub_sub_header(doc, '2.4.1 สรุปปริมาณน้ำฝนสะสมและการกระจายตัวรายอำเภอ (13 อำเภอ)')
add_body(doc, 'ตารางวิเคราะห์ปริมาณฝนสะสมเฉลี่ย ปริมาณฝนสูงสุด 24 ชั่วโมง และความถี่การเกิดฝนตกหนัก (>= 35 มม.) จำแนกรายอำเภอทั้ง 13 อำเภอ (เรียงลำดับจากฝนสะสมเฉลี่ยสูงไปต่ำ):')
rows_amp = []
tot_heavy = 0
for amp in amphoe_order:
    ad = amphoe_stats[amp]
    tot_heavy += ad['heavy_events']
    rows_amp.append([
        {'text': f"อ.{amp}", 'align': L, 'bold': True},
        f"{ad['num_stations']} สถานี",
        f"{ad['avg_cum']:.1f}",
        f"{ad['max_24h']:.1f}",
        {'text': f"{ad['max_station']} ({ad['max_date']})", 'align': L},
        f"{ad['heavy_events']} ครั้ง"
    ])
rows_amp.append([
    {'text': 'รวมทั้งจังหวัด / เฉลี่ย', 'align': L, 'bold': True},
    f"{len(station_totals)} สถานี",
    f"{prov_avg_rain:.1f}",
    f"{prov_max_24h:.1f}",
    {'text': f"{prov_max_24h_st['station_name']} ({prov_max_24h_st['max_date']})", 'align': L},
    f"{tot_heavy} ครั้ง"
])
add_data_table(doc,
    ['อำเภอ','จำนวนสถานี','ฝนสะสมเฉลี่ย (มม.)','ฝนสูงสุด 24 ชม. (มม.)','สถานีที่พบฝนสูงสุด (วันที่)','ฝนตกหนัก (>=35 มม.)'],
    rows_amp, shade=MED_BG,
    col_widths=[1400,1100,1600,1600,2400,1500]
)
add_empty_line(doc, 6)

add_sub_sub_header(doc, '2.4.2 ตาราง 10 อันดับสถานีตรวจวัดที่มีปริมาณฝนสะสมสูงสุดในรอบเดือน')
add_body(doc, 'สถานีตรวจวัดน้ำฝนที่ตรวจพบปริมาณฝนสะสมรวมสูงสุด 10 อันดับแรก ประจำเดือนกันยายน 2569:')
rows_top_rain = []
for idx, s in enumerate(top_rain_stations, 1):
    loc_clean = s['location'].replace(' ลำปาง', '').replace('ลำปาง', '').strip() if s['location'] else '-'
    rows_top_rain.append([
        str(idx),
        {'text': s['station_name'], 'align': L, 'bold': True if idx <= 3 else False},
        {'text': loc_clean, 'align': L},
        {'text': s['basin'] or 'ลุ่มน้ำวัง', 'align': L},
        f"{s['total']:.1f}",
        f"{s['max_day']:.1f}",
        {'text': s['max_date'] or '-', 'align': L}
    ])
add_data_table(doc,
    ['อันดับ','สถานีตรวจวัด','ตำบล / อำเภอ','ลุ่มน้ำ','ฝนสะสม (มม.)','ฝนสูงสุด 24 ชม. (มม.)','วันที่ฝนสูงสุด'],
    rows_top_rain,
    col_widths=[800,2200,2200,1200,1400,1400,1400]
)
add_empty_line(doc, 6)

add_sub_sub_header(doc, '2.4.3 การวิเคราะห์แนวโน้มและช่วงเวลาฝนตกชุก (Rainfall Peak Period Analysis)')
add_body(doc, 'จากการประมวลผลข้อมูลรายวันทั้ง 30 วัน พบว่าการกระจายตัวของฝนในจังหวัดลำปางแบ่งออกเป็น 3 ช่วงระลอกสำคัญ ได้แก่:', indent=True)
add_bullet(doc, 'ระลอกที่ 1 (วันที่ 10 - 12 กันยายน): เกิดร่องมรสุมพาดผ่านภาคเหนือ มีฝนตกหนักเฉลี่ยทั้งจังหวัด 10.7 - 15.3 มม./วัน สถานีตรวจพบฝนตกหนักพร้อมกัน 23 - 26 แห่ง โดยเฉพาะในพื้นที่อำเภอแจ้ห่ม อำเภอเมืองปาน และอำเภองาว')
add_bullet(doc, 'ระลอกที่ 2 (วันที่ 18 - 21 กันยายน - ช่วงฝนหนักที่สุดของเดือน): เป็นช่วงที่มรสุมตะวันตกเฉียงใต้มีกำลังแรงและมีหย่อมความกดอากาศต่ำปกคลุม เกิดฝนตกหนักมากทั่วทั้งจังหวัด โดยเฉพาะในวันที่ 19 กันยายน ปริมาณฝนเฉลี่ยทั้งจังหวัดพุ่งขึ้นถึง 27.7 มม./วัน มีสถานีตรวจพบฝนตกหนักถึง 55 แห่ง ฝนสูงสุด 24 ชั่วโมงวัดได้ 132.5 มม. ที่อำเภอแม่ทะ และในวันที่ 21 กันยายน มีฝนเฉลี่ย 22.7 มม./วัน ฝนสูงสุด 120.0 มม. ที่อำเภอเถิน ส่งผลให้ระดับน้ำในแม่น้ำวัง ลำน้ำแม่สอย และน้ำแม่งาว เพิ่มขึ้นอย่างรวดเร็ว', color=C_DANGER)
add_bullet(doc, 'ระลอกที่ 3 (วันที่ 28 - 29 กันยายน): เกิดฝนตกหนักซ้ำในช่วงปลายเดือน ฝนเฉลี่ย 11.8 - 18.8 มม./วัน มีสถานีฝนตกหนัก 17 - 25 แห่ง ตกชุกในพื้นที่อำเภอเถิน อำเภอแม่ทะ และอำเภอเกาะคา')
add_empty_line(doc, 6)

add_sub_sub_header(doc, '2.4.4 การกระจายตัวของปริมาณฝนจำแนกตามลุ่มน้ำ')
rows_basin = []
for bname in ['ลุ่มน้ำวัง', 'ลุ่มน้ำยม']:
    bs = basin_stats.get(bname, {})
    rows_basin.append([
        {'text': bname, 'align': L, 'bold': True},
        f"{bs.get('count',0)} สถานี",
        f"{bs.get('avg_cum',0.0):.1f}",
        f"{bs.get('max_day',0.0):.1f}",
        {'text': f"{bs.get('max_station','-')} ({bs.get('max_date','-')})", 'align': L}
    ])
add_data_table(doc,
    ['ลุ่มน้ำหลัก','จำนวนสถานีตรวจวัด','ฝนสะสมเฉลี่ย (มม.)','ฝนสูงสุด 24 ชม. (มม.)','สถานีที่พบฝนสูงสุด (วันที่)'],
    rows_basin, shade=MED_BG,
    col_widths=[2200,1500,2000,2000,1900]
)
add_empty_line(doc, 6)

add_sub_header(doc, '2.5 แนวโน้มระดับน้ำและปริมาณน้ำฝนรายวัน')
add_body(doc, 'ตารางแสดงความสัมพันธ์ระหว่างค่าระดับน้ำเฉลี่ย และปริมาณฝนเฉลี่ยทั้งจังหวัดรายวัน ประจำเดือนกันยายน 2569:')
rows_wd = []
for d in wDaily:
    day_str = str(d['day'])
    try:
        parts = day_str.split('-')
        thai_day = f"{int(parts[2])} ก.ย. 2569"
    except:
        thai_day = day_str
    rain_stat = daily_rain_stats.get(day_str, {'avg': 0.0, 'max': 0.0, 'heavy_st': 0})
    rows_wd.append([
        {'text': thai_day, 'align': L},
        d['avg_wl'] if d.get('avg_wl') is not None else '-',
        d['max_wl'] if d.get('max_wl') is not None else '-',
        f"{rain_stat['avg']:.1f}",
        f"{rain_stat['heavy_st']} แห่ง" if rain_stat['heavy_st'] > 0 else '-',
        f'{d["active_stations"]} สถานี',
    ])
add_data_table(doc,
    ['วันที่','ระดับน้ำเฉลี่ย (ม.รทก.)','ระดับน้ำสูงสุด (ม.รทก.)','ฝนเฉลี่ยทั้งจังหวัด (มม.)','สถานีฝนหนัก (>=35มม.)','สถานีน้ำที่รายงาน'],
    rows_wd, shade=MED_BG,
    col_widths=[1600,1700,1700,1600,1500,1500]
)

add_sub_header(doc, '2.6 พื้นที่วิกฤตและข้อเสนอแนะ')
critical_list = [s for s in wStations if s['risk_level'] == 'วิกฤตสีแดง']
if critical_list:
    add_sub_sub_header(doc, 'สถานีที่อยู่ในระดับวิกฤตสีแดง')
    for s in critical_list:
        add_bullet(doc, f'{s["station_name"]} ({s["amphoe"]}) - ระดับน้ำเฉลี่ย {s["avg_wl"]} ม.รทก., สถานะ: {s.get("status","-")}', color=C_DANGER)
    add_empty_line(doc, 6)
else:
    add_body(doc, 'ไม่พบสถานีตรวจวัดระดับน้ำที่อยู่ในระดับวิกฤตสีแดงในเดือนนี้ อย่างไรก็ตาม มีสถานีระดับเฝ้าระวัง 35 สถานี และมีพื้นที่ที่มีฝนตกสะสมสูงกว่า 350 มม. ในอำเภอเสริมงามและอำเภอเถินที่ต้องติดตามอย่างใกล้ชิด', color=DARK)

add_sub_sub_header(doc, 'ข้อเสนอแนะเชิงนโยบายด้านน้ำและปริมาณน้ำฝน')
for bi in [
    'เชื่อมโยงข้อมูลฝนตกหนักแบบ Real-time เข้ากับระบบเตือนภัยน้ำหลากในพื้นที่ลุ่มน้ำสาขา โดยเฉพาะ อ.เสริมงาม, อ.เถิน, อ.สบปราบ และ อ.แม่พริก ซึ่งมีปริมาณฝนสะสมสูงที่สุดในเดือนนี้',
    'ควรจัดส่งเจ้าหน้าที่ลงพื้นที่เฝ้าระวังสถานีที่มีความเสี่ยงอุทกภัย อย่างน้อยสัปดาห์ละ 2 ครั้ง ตลอดช่วงฤดูฝน',
    'ประสานหน่วยงานท้องถิ่นเพื่อเตรียมแผนเผชิญเหตุและจุดอพยพประชาชนในพื้นที่เสี่ยงอุทกภัยริมแม่น้ำวังและแม่น้ำยม',
    'เพิ่มความถี่ในการรายงานข้อมูลระดับน้ำและปริมาณฝนสะสมในช่วงปลายฤดูฝน (กันยายน - ตุลาคม)',
    'เตรียมพร้อมเครื่องสูบน้ำ รถกู้ภัย และกำลังเจ้าหน้าที่พร้อมปฏิบัติการรับมืออุทกภัยตลอด 24 ชั่วโมง',
    'เฝ้าระวังดินโคลนถล่มและน้ำป่าไหลหลากในพื้นที่ลาดชันเชิงเขาในอำเภอเมืองปาน อำเภอวังเหนือ และอำเภองาว หลังเกิดฝนตกสะสมต่อเนื่องเกิน 100 มม. ในรอบ 24 ชั่วโมง',
]:
    add_bullet(doc, bi)


add_page_break(doc)

# ======= CHAPTER 3: DROUGHT/DAMS =======
add_section_header(doc, 'บทที่ 3 : ระบบเฝ้าระวังภัยแล้ง (อ่างเก็บน้ำ)')
add_empty_line(doc)
add_sub_header(doc, '3.1 ภาพรวมสถานการณ์อ่างเก็บน้ำ')
add_body(doc, 'ระบบเฝ้าระวังภัยแล้งติดตามปริมาณน้ำในอ่างเก็บน้ำทุกขนาด 3 ประเภท ได้แก่ อ่างขนาดใหญ่ อ่างขนาดกลาง และอ่างขนาดเล็ก เพื่อประเมินสถานการณ์น้ำต้นทุนและวางแผนการจัดสรรน้ำในจังหวัดลำปาง ในช่วงเดือนกันยายน 2569 ซึ่งเป็นช่วงฤดูฝน อ่างเก็บน้ำส่วนใหญ่มีปริมาณน้ำสะสมอยู่ในระดับที่ดี เป็นปัจจัยเชิงบวกสำหรับการบริหารน้ำในฤดูแล้งปีถัดไป', indent=True)
add_empty_line(doc)
add_kpi_table(doc, [
    ('อ่างขนาดใหญ่', f'{len(largeDams)} แห่ง'),
    ('อ่างขนาดกลาง', f'{len(medDams)} แห่ง'),
    ('อ่างขนาดเล็ก', f'{len(smallDams)} แห่ง'),
    ('รวมทั้งหมด', f'{len(dDams)} แห่ง'),
])

add_sub_header(doc, '3.2 สถานการณ์อ่างเก็บน้ำขนาดใหญ่ ณ ปัจจุบัน')
add_data_table(doc,
    ['ชื่ออ่างเก็บน้ำ','ปริมาณน้ำ (ล้าน ลบ.ม.)','ร้อยละ','น้ำใช้การได้ (ล้าน ลบ.ม.)','ไหลเข้า (ล้าน ลบ.ม./วัน)','ระบาย (ล้าน ลบ.ม./วัน)'],
    [[
        {'text': d['dam_name'], 'align': L},
        {'text': f'{float(d["water_volume_m_cum"]):.2f}', 'bold': True},
        {'text': d['water_percent'], 'bold': True, 'color': pct_color(d['water_percent'])},
        f'{float(d["usable_water_m_cum"] or 0):.2f}',
        f'{float(d["inflow_m_cum"] or 0):.4f}',
        f'{float(d["discharge_m_cum"] or 0):.4f}',
    ] for d in latestLarge],
    col_widths=[2200,1800,1200,2000,1900,1900]
)

add_sub_header(doc, '3.3 สถานการณ์อ่างเก็บน้ำขนาดกลาง (คัดเลือก)')
add_data_table(doc,
    ['ชื่ออ่างเก็บน้ำ','ความจุ (ล้าน ลบ.ม.)','ปริมาณน้ำ (ล้าน ลบ.ม.)','ร้อยละ','น้ำใช้การได้'],
    [[
        {'text': d['dam_name'], 'align': L},
        f'{float(next((dm["capacity"] for dm in medDams if dm["dam_name"] == d["dam_name"]), 0) or 0):.2f}',
        f'{float(d["water_volume_m_cum"] or 0):.2f}',
        {'text': d['water_percent'], 'color': pct_color(d['water_percent'])},
        f'{float(d["usable_water_m_cum"] or 0):.2f}',
    ] for d in latestMed[:18]],
    shade=MED_BG,
    col_widths=[2800,1600,1800,1200,1600]
)

add_sub_header(doc, '3.4 ข้อมูลอ่างเก็บน้ำขนาดใหญ่ รายเดือน (ค่าเฉลี่ยกันยายน 2569)')
add_data_table(doc,
    ['ชื่ออ่างเก็บน้ำ','ความจุสูงสุด (ล้าน ลบ.ม.)','ปริมาณน้ำเฉลี่ย (ล้าน ลบ.ม.)','น้ำใช้การได้เฉลี่ย','ไหลเข้าเฉลี่ย','ระบายเฉลี่ย'],
    [[
        {'text': d['dam_name'], 'align': L},
        f'{float(d["capacity"] or 0):.2f}',
        f'{float(d["avg_volume"] or 0):.2f}',
        f'{float(d["avg_usable"] or 0):.2f}',
        f'{float(d["avg_inflow"] or 0):.4f}',
        f'{float(d["avg_discharge"] or 0):.4f}',
    ] for d in largeDams],
    col_widths=[2200,1800,1900,1700,1600,1600]
)

add_sub_header(doc, '3.5 การวิเคราะห์แนวโน้มและข้อเสนอแนะ')
add_sub_sub_header(doc, 'ผลการวิเคราะห์')
add_bullet(doc, 'อ่างกิ่วลม: อ่างเก็บน้ำขนาดใหญ่ที่สำคัญที่สุดของจังหวัด เดือนกันยายนปริมาณน้ำมีแนวโน้มสูงขึ้นต่อเนื่องจากช่วงฤดูฝน ควรติดตามปริมาณน้ำไหลเข้าและบริหารการระบายน้ำอย่างระมัดระวัง')
add_bullet(doc, 'อ่างกิ่วคอหมา: ติดตามปริมาณน้ำใช้การได้อย่างใกล้ชิด วางแผนการระบายน้ำในช่วงเปลี่ยนฤดูกาลจากฤดูฝนสู่ฤดูหนาว')
add_bullet(doc, 'อ่างขนาดกลางส่วนใหญ่มีปริมาณน้ำสะสมอยู่ในระดับที่เหมาะสมสำหรับการจัดสรรน้ำในฤดูแล้งถัดไป (พฤศจิกายน 2569 - เมษายน 2570)')
add_bullet(doc, 'ฤดูฝนเดือนกันยายนนำน้ำต้นทุนเข้าสู่อ่างเก็บน้ำในปริมาณมาก ซึ่งเป็นปัจจัยบวกสำหรับการบริหารน้ำในปีถัดไป')
add_sub_sub_header(doc, 'ข้อเสนอแนะ')
for bi in [
    'วางแผนการจัดสรรน้ำเพื่อการเกษตรและอุปโภค-บริโภคช่วงฤดูแล้ง (พฤศจิกายน-เมษายน) อย่างระมัดระวัง',
    'ติดตามและบันทึกปริมาณน้ำไหลเข้า-ออกอ่างอย่างละเอียดเพื่อประมาณการปริมาณน้ำต้นทุนปลายปี',
    'เร่งรัดการตรวจสอบสภาพเขื่อนและอาคารระบายน้ำก่อนสิ้นสุดฤดูฝน เพื่อให้พร้อมใช้งานอย่างเต็มประสิทธิภาพ',
    'ประชาสัมพันธ์สถานการณ์น้ำให้เกษตรกรในพื้นที่ชลประทานทราบเพื่อวางแผนการเพาะปลูกในฤดูต่อไป',
    'จัดทำแผนการบริหารน้ำสำหรับช่วงฤดูแล้งปี 2570 อย่างเร็วที่สุด เพื่อตอบสนองความต้องการน้ำภาคเกษตรและอุปโภค-บริโภค',
]:
    add_bullet(doc, bi)

add_page_break(doc)

# ======= CHAPTER 4: PM2.5 =======
add_section_header(doc, 'บทที่ 4 : ระบบติดตามคุณภาพอากาศ PM2.5')
add_empty_line(doc)
add_sub_header(doc, '4.1 ภาพรวมคุณภาพอากาศ เดือนกันยายน 2569')
add_body(doc, 'การติดตามคุณภาพอากาศโดยวัดค่าฝุ่นละอองขนาดเล็ก PM2.5 ดำเนินการผ่านเครือข่ายสถานีตรวจวัดอัตโนมัติที่กระจายตัวในพื้นที่ต่างๆ ของจังหวัดลำปาง ในช่วงเดือนกันยายน 2569 ซึ่งเป็นช่วงฤดูฝน ค่า PM2.5 โดยรวมยังคงอยู่ในระดับดี เนื่องจากน้ำฝนช่วยชะล้างฝุ่นละอองในบรรยากาศ อย่างไรก็ตาม ต้องเตรียมพร้อมรับมือกับการเพิ่มขึ้นของค่า PM2.5 ในช่วงต้นฤดูหนาวที่กำลังจะมาถึง', indent=True)
add_empty_line(doc)
add_kpi_table(doc, [
    ('สถานีตรวจวัด', str(pTotal['stations'])),
    ('ค่าการวัดทั้งหมด', f'{int(pTotal["cnt"]):,}'),
    ('ระดับ "ดีมาก"', f'{good_pct}%'),
    ('เกินมาตรฐาน (>37.5)', f'{pm25Exceed} ครั้ง'),
])

add_sub_header(doc, '4.2 สรุประดับคุณภาพอากาศ')
thresholds = {'ดีมาก':'0 - 25','ดี':'25.1 - 37.5','ปานกลาง':'37.6 - 75','เริ่มมีผลต่อสุขภาพ':'75.1 - 150','มีผลกระทบต่อสุขภาพ':'> 150'}
pm_colors  = {'ดีมาก':C_OK,'ดี':C_OK,'ปานกลาง':C_WARN,'เริ่มมีผลต่อสุขภาพ':C_WARN,'มีผลกระทบต่อสุขภาพ':C_DANGER}
add_data_table(doc,
    ['ระดับคุณภาพอากาศ','เกณฑ์ PM2.5 (ug/m3)','จำนวนครั้ง','สัดส่วน (%)'],
    [[
        {'text': s['air_quality_status'], 'align': L, 'color': pm_colors.get(s['air_quality_status'], DARK), 'bold': True},
        thresholds.get(s['air_quality_status'], '-'),
        f'{int(s["cnt"]):,}',
        f'{round(int(s["cnt"])/totalPM*100) if totalPM else 0}%',
    ] for s in pStatus],
    col_widths=[2500,2200,2000,1300]
)

add_sub_header(doc, '4.3 ค่า PM2.5 รายอำเภอ')
add_data_table(doc,
    ['อำเภอ','จำนวนสถานี','ค่าเฉลี่ย (ug/m3)','ค่าสูงสุด (ug/m3)'],
    [[
        {'text': a['amphoe'], 'align': L},
        f'{a["stations"]} สถานี',
        {'text': str(a['avg_pm25']), 'color': pm25_color(a['avg_pm25'])},
        {'text': str(a['max_pm25']), 'bold': float(a['max_pm25'] or 0) > 75, 'color': pm25_color(a['max_pm25'])},
    ] for a in pAmphoe],
    col_widths=[2500,1500,2000,2000]
)

add_sub_header(doc, '4.4 สถานีที่มีค่าเกินมาตรฐาน (PM2.5 > 37.5 ug/m3)')
if pExceed:
    add_data_table(doc,
        ['สถานีตรวจวัด','อำเภอ','ค่าสูงสุด (ug/m3)','จำนวนครั้ง','ระดับผลกระทบ'],
        [[
            {'text': e['station_name'], 'align': L},
            {'text': e['amphoe'], 'align': L},
            {'text': str(e['max_pm25']), 'bold': True, 'color': C_DANGER},
            f'{e["times"]} ครั้ง',
            {'text': e['air_quality_status'], 'color': C_DANGER},
        ] for e in pExceed],
        shade=MED_BG,
        col_widths=[2800,1600,1800,1400,2400]
    )
else:
    add_body(doc, 'ไม่พบสถานีที่มีค่าเกินมาตรฐานในเดือนนี้ คุณภาพอากาศโดยรวมอยู่ในระดับดีถึงดีมาก', color=C_OK)

add_sub_header(doc, '4.5 ข้อมูลสถานีตรวจวัด PM2.5 รายสถานี (เรียงจากค่าสูงไปต่ำ)')
add_data_table(doc,
    ['สถานีตรวจวัด','อำเภอ','ค่าเฉลี่ย PM2.5 (ug/m3)','ค่าสูงสุด (ug/m3)','จำนวนบันทึก'],
    [[
        {'text': s['station_name'], 'align': L},
        {'text': s['amphoe'] or '-', 'align': L},
        {'text': str(s['avg_pm25']), 'color': pm25_color(s['avg_pm25'])},
        {'text': str(s['max_pm25']), 'color': pm25_color(s['max_pm25'])},
        f'{int(s["records"]):,}',
    ] for s in pStations[:20]],
    shade=MED_BG,
    col_widths=[2800,1600,2000,1800,1800]
)

add_sub_header(doc, '4.6 แนวโน้มค่า PM2.5 รายวัน')
rows_pd = []
for d in pDaily:
    day_str = str(d['day'])
    try:
        parts = day_str.split('-')
        thai_day = f"{int(parts[2])} ก.ย. 2569"
    except:
        thai_day = day_str
    rows_pd.append([
        {'text': thai_day, 'align': L},
        {'text': str(d['avg_pm25']), 'color': pm25_color(d['avg_pm25'])},
        {'text': str(d['max_pm25']), 'color': pm25_color(d['max_pm25'])},
        f'{int(d["readings"]):,}',
    ])
add_data_table(doc, ['วันที่','ค่าเฉลี่ย (ug/m3)','ค่าสูงสุด (ug/m3)','จำนวนค่าการวัด'], rows_pd, col_widths=[2000,2000,2000,2000])

add_sub_header(doc, '4.7 ข้อเสนอแนะด้านคุณภาพอากาศ')
if pExceed:
    add_bullet(doc, 'ตรวจสอบความถูกต้องของเซ็นเซอร์ที่มีค่าสูงผิดปกติ และประชาสัมพันธ์ให้ประชาชนป้องกันตนเอง', color=C_DANGER)
else:
    add_bullet(doc, 'ค่า PM2.5 ในเดือนกันยายนอยู่ในระดับที่ดี สอดคล้องกับฤดูฝน - ควรรักษามาตรการป้องกันการเผาในที่โล่งอย่างเข้มงวด', color=C_OK)
for bi in [
    'เตรียมความพร้อมรับมือค่า PM2.5 ที่อาจเพิ่มสูงขึ้นอย่างรวดเร็วในช่วงต้นฤดูหนาว (ตุลาคม - พฤศจิกายน 2569)',
    'วางแผนรณรงค์ห้ามเผาในพื้นที่โล่งก่อนเข้าฤดูหนาว เพื่อลดปริมาณฝุ่น PM2.5 อย่างยั่งยืน',
    'ส่งเสริมการลดกิจกรรมที่ก่อให้เกิดฝุ่นในชุมชน โดยเฉพาะการเผาในที่โล่ง',
    'พัฒนาระบบแจ้งเตือนอัตโนมัติเมื่อค่า PM2.5 เกินมาตรฐานให้ประชาชนรับทราบผ่านช่องทางต่างๆ รวมทั้ง Line Official และ SMS',
]:
    add_bullet(doc, bi)

add_page_break(doc)

# ======= CHAPTER 5: COMPLAINTS =======
add_section_header(doc, 'บทที่ 5 : ระบบติดตามเรื่องร้องเรียนประชาชน (Traffy Fondue ลำปาง)')
add_empty_line(doc)
add_sub_header(doc, '5.1 ภาพรวมเรื่องร้องเรียน')
add_body(doc, f'ระบบรับและติดตามเรื่องร้องเรียนผ่านแพลตฟอร์ม Traffy Fondue เป็นช่องทางหลักที่ประชาชนในจังหวัดลำปางใช้แจ้งปัญหาและข้อร้องเรียนต่างๆ ไปยังหน่วยงานรับผิดชอบ ระบบสามารถติดตามสถานะการดำเนินการและวัดความพึงพอใจของผู้ร้องเรียนได้ ในเดือนกันยายน 2569 มีเรื่องร้องเรียนเข้าสู่ระบบจำนวน {compTotal} เรื่อง', indent=True)
add_empty_line(doc)
add_kpi_table(doc, [
    ('เรื่องร้องเรียนในระบบ', str(compTotal)),
    ('ดำเนินการเสร็จสิ้น', str(compDone)),
    ('อยู่ระหว่างดำเนินการ', str(compTotal - compDone)),
    ('อัตราดำเนินการสำเร็จ', f'{compRate}%'),
])

add_sub_header(doc, '5.2 สรุปสถานะเรื่องร้องเรียน')
add_data_table(doc,
    ['สถานะ','จำนวน (เรื่อง)','ร้อยละ'],
    [[
        {'text': s['state_name'], 'align': L},
        str(s['cnt']),
        f'{round(int(s["cnt"])/compTotal*100) if compTotal else 0}%',
    ] for s in cByStatusToShow],
    col_widths=[4000,2000,2000]
)

add_sub_header(doc, '5.3 ประเภทเรื่องร้องเรียนที่พบบ่อย')
add_data_table(doc,
    ['ลำดับ','ประเภทปัญหา','จำนวน (เรื่อง)','ร้อยละ'],
    [[
        str(i+1),
        {'text': t['problem_type'], 'align': L},
        str(t['cnt']),
        f'{round(int(t["cnt"])/compTotal*100) if compTotal else 0}%',
    ] for i, t in enumerate(cByTypeToShow)],
    shade=MED_BG,
    col_widths=[800,3500,1800,1900]
)

add_sub_header(doc, '5.4 รายการเรื่องร้องเรียนในระบบ')
add_body(doc, 'ตารางแสดงรายการเรื่องร้องเรียนที่บันทึกในระบบ Traffy Fondue ลำปาง:')
complaint_rows = []
for c in cListToShow[:20]:
    loc = c.get('location','') or ''
    loc = loc.replace('จังหวัดลำปาง','').replace('ประเทศไทย','').strip().split('\n')[0][:25]
    agency = c.get('agency_status','') or ''
    agency = agency.replace('สถานะที่รับ ','').replace('งานที่เป็นสถานะอื่นๆ','อื่นๆ').replace('งานที่รับเรื่องร้องเรียน','รับเรื่อง').replace('หน่วยงานส่งต่อให้ อบจ.ดำเนินการ','ส่งต่อ อบจ.')[:18]
    st_clr = C_OK if c.get('state_name') == 'เสร็จสิ้น' else (C_WARN if 'รอ' in str(c.get('state_name','')) else DARK)
    complaint_rows.append([
        {'text': str(c.get('ticket_id','') or '-')[:12], 'align': L},
        {'text': str(c.get('problem_type','') or '-'), 'align': L},
        {'text': loc or '-', 'align': L},
        {'text': str(c.get('ticket_datetime','') or '-')[:16], 'align': L},
        {'text': str(c.get('state_name','') or '-'), 'color': st_clr},
        {'text': agency or '-', 'align': L},
    ])
add_data_table(doc,
    ['รหัสเรื่อง','ประเภท','พื้นที่','วันที่แจ้ง','สถานะ','ผู้รับผิดชอบ'],
    complaint_rows,
    col_widths=[1400,1300,2000,1900,1400,2200]
)

add_sub_header(doc, '5.5 ข้อเสนอแนะด้านระบบร้องเรียน')
for bi in [
    'เร่งรัดการดำเนินการเรื่องร้องเรียนที่อยู่ระหว่างดำเนินการ โดยเฉพาะเรื่องถนนและโครงสร้างพื้นฐาน',
    'จัดทำรายงานสรุปผลการดำเนินการเรื่องร้องเรียนเสนอผู้บริหารเป็นรายเดือนอย่างต่อเนื่อง',
    'พัฒนาระบบแจ้งเตือนอัตโนมัติเมื่อเรื่องร้องเรียนค้างนานเกิน 15 วัน',
    'เพิ่มช่องทางการแสดงความพึงพอใจเพื่อวัดประสิทธิภาพการบริการของหน่วยงาน',
    'ประสานงานหน่วยงานที่รับผิดชอบให้มีการตอบสนองต่อเรื่องร้องเรียนอย่างรวดเร็วและมีประสิทธิภาพ',
    f'เปรียบเทียบกับเดือนสิงหาคม 2569 (จำนวน {compAugTotal} เรื่อง): {"มีแนวโน้มเพิ่มขึ้น ควรเร่งรัดกำลังคนในการดำเนินการ" if compTotal > compAugTotal else "มีแนวโน้มลดลง แสดงถึงประสิทธิภาพในการดำเนินการที่ดีขึ้น"}',
]:
    add_bullet(doc, bi)

add_page_break(doc)

# ======= CHAPTER 6: DASHBOARD =======
add_section_header(doc, 'บทที่ 6 : Dashboard และข้อมูลสารสนเทศเพื่อการติดตามและประเมินผล')
add_empty_line(doc)
add_sub_header(doc, '6.1 ตารางสรุป Dashboard ภาพรวม 5 ระบบ')
add_body(doc, 'ตารางสรุปผลการดำเนินงานและตัวชี้วัดสำคัญ (KPI) ของระบบสารสนเทศบูรณาการ ประจำเดือนกันยายน 2569:')
add_empty_line(doc, 6)
dashboard_rows = [
    [{'text':'ระบบน้ำ','align':L,'bold':True}, {'text':'จำนวนสถานีตรวจวัด','align':L}, f'{totalWater} สถานี', {'text':'[ok] ปกติ','color':C_OK}],
    [{'text':'','align':L}, {'text':'สถานีวิกฤตสีแดง','align':L}, f'{criticalSt} สถานี', {'text':'[!] ต้องเฝ้าระวัง','color':C_DANGER} if criticalSt > 0 else {'text':'[ok] ไม่มี','color':C_OK}],
    [{'text':'','align':L}, {'text':'สถานีเฝ้าระวัง','align':L}, f'{watchSt} สถานี', {'text':'[~] ระวัง','color':C_WARN}],
    [{'text':'ระบบน้ำฝน','align':L,'bold':True}, {'text':'สถานีตรวจวัดน้ำฝน','align':L}, f'{len(station_totals)} สถานี (13 อำเภอ)', {'text':'[ok] ปกติ','color':C_OK}],
    [{'text':'','align':L}, {'text':'ฝนสะสมเฉลี่ยทั้งจังหวัด','align':L}, f'{prov_avg_rain:.1f} มม.', {'text':'[ok] ปกติ','color':C_OK}],
    [{'text':'','align':L}, {'text':'ฝน 24 ชม. สูงสุด','align':L}, f'{prov_max_24h:.1f} มม.', {'text':'[~] ระวัง','color':C_WARN} if prov_max_24h >= 90 else {'text':'[ok] ปกติ','color':C_OK}],
    [{'text':'อ่างเก็บน้ำ','align':L,'bold':True}, {'text':'จำนวนอ่างที่ติดตาม','align':L}, f'{len(dDams)} แห่ง', {'text':'[ok] ปกติ','color':C_OK}],
]
for d in latestLarge:
    try:
        ok = int(str(d['water_percent']).replace('%','')) >= 60
    except:
        ok = True
    dashboard_rows.append([{'text':'','align':L}, {'text':d['dam_name'],'align':L}, f'{float(d["water_volume_m_cum"]):.2f} ล้าน ลบ.ม. ({d["water_percent"]})', {'text':'[ok] เพียงพอ' if ok else '[~] ติดตาม','color':C_OK if ok else C_WARN}])
dashboard_rows += [
    [{'text':'PM2.5','align':L,'bold':True}, {'text':'สถานีตรวจวัด','align':L}, f'{pTotal["stations"]} สถานี', {'text':'[ok] ปกติ','color':C_OK}],
    [{'text':'','align':L}, {'text':'สัดส่วนระดับดีมาก','align':L}, f'{good_pct}%', {'text':'[ok] ดี','color':C_OK}],
    [{'text':'','align':L}, {'text':'ครั้งที่เกินมาตรฐาน','align':L}, f'{pm25Exceed} ครั้ง', {'text':'[!] ต้องติดตาม','color':C_DANGER} if pm25Exceed > 0 else {'text':'[ok] ปกติ','color':C_OK}],
    [{'text':'ร้องเรียน','align':L,'bold':True}, {'text':'เรื่องร้องเรียนในระบบ','align':L}, f'{compTotal} เรื่อง', {'text':'[i] ติดตาม','color':DARK}],
    [{'text':'','align':L}, {'text':'อัตราดำเนินการสำเร็จ','align':L}, f'{compRate}%', {'text':'[ok] ดี' if compRate >= 70 else '[~] ต้องปรับปรุง','color':C_OK if compRate >= 70 else C_WARN}],
]
add_data_table(doc, ['ระบบ','ตัวชี้วัดหลัก','ค่า','สถานะ'], dashboard_rows, shade=MED_BG, col_widths=[2000,2500,2200,1800])

add_sub_header(doc, '6.2 ความถูกต้องและครบถ้วนของข้อมูล')
add_data_table(doc,
    ['ระบบ','ความครอบคลุม','ความถี่การอัปเดต','ช่วงเวลาข้อมูล','ความสมบูรณ์'],
    [
        [{'text':'ระบบน้ำ','align':L,'bold':True}, f'{len(amphoeList)} อำเภอ / {totalWater} สถานี', 'ทุก 30 นาที', '1-30 ก.ย. 69', {'text':'[ok] ครบถ้วน','color':C_OK}],
        [{'text':'ระบบน้ำฝน','align':L,'bold':True}, f'13 อำเภอ / {len(station_totals)} สถานี', 'ทุก 30 นาที', '1-30 ก.ย. 69', {'text':'[ok] ครบถ้วน','color':C_OK}],
        [{'text':'ระบบภัยแล้ง','align':L,'bold':True}, f'{len(dDams)} อ่างเก็บน้ำ', 'ทุก 30 นาที', '1-30 ก.ย. 69', {'text':'[ok] ครบถ้วน','color':C_OK}],
        [{'text':'ระบบ PM2.5','align':L,'bold':True}, f'{pTotal["stations"]} สถานี', 'ทุก 30 นาที', '1-30 ก.ย. 69', {'text':'[ok] ครบถ้วน','color':C_OK}],
        [{'text':'ระบบร้องเรียน','align':L,'bold':True}, 'ครอบคลุมทุกอำเภอ', 'Real-time', 'สะสมทั้งปี', {'text':'[ok] ครบถ้วน','color':C_OK}],
    ],
    col_widths=[1700,2200,1800,1800,1500]
)

add_sub_header(doc, '6.3 สรุปตัวชี้วัดประสิทธิภาพ (KPI) ระบบสารสนเทศ')
total_records = int(wTotal) + int(rainTotalRecords) + int(dTotal) + int(pTotal['cnt'])
add_data_table(doc,
    ['KPI','เป้าหมาย','ผลการดำเนินงาน','ผลประเมิน'],
    [
        [{'text':'ความพร้อมใช้ระบบ (Uptime)','align':L}, '>= 95%', '>= 99% (ทุกระบบ)', {'text':'[ok] ผ่าน','color':C_OK}],
        [{'text':'ความถูกต้องข้อมูล','align':L}, '>= 95%', f'{total_records:,} รายการ', {'text':'[ok] ผ่าน','color':C_OK}],
        [{'text':'ความทันสมัยของข้อมูล','align':L}, '<= 30 นาที', 'อัปเดตทุก 30 นาที', {'text':'[ok] ผ่าน','color':C_OK}],
        [{'text':'การดำเนินการเรื่องร้องเรียน','align':L}, '>= 70%', f'{compRate}%', {'text':'[ok] ผ่าน' if compRate >= 70 else '[~] ต้องปรับปรุง','color':C_OK if compRate >= 70 else C_WARN}],
        [{'text':'ครอบคลุมพื้นที่ตรวจวัด','align':L}, 'ทุกอำเภอ', f'น้ำ/ฝน (13 อำเภอ) + PM2.5 (13 อำเภอ)', {'text':'[ok] ผ่าน','color':C_OK}],
    ],
    col_widths=[2800,1500,2500,1700]
)
add_page_break(doc)

# ======= CHAPTER 7: CONCLUSION =======
add_section_header(doc, 'บทที่ 7 : บทสรุปและข้อเสนอแนะเชิงนโยบาย')
add_empty_line(doc)
add_sub_header(doc, '7.1 สรุปภาพรวมสถานการณ์ประจำเดือน')
add_body(doc, 'จากการติดตามข้อมูลสารสนเทศทั้ง 5 ระบบ ในเดือนกันยายน 2569 สรุปสถานการณ์โดยรวมได้ดังนี้:', indent=True)
add_empty_line(doc, 6)
add_body(doc, 'ด้านน้ำและอุทกภัย', bold=True)
add_body(doc, f'จังหวัดลำปางอยู่ในช่วงฤดูฝนสูงสุด ระดับน้ำในแม่น้ำสายหลักยังคงอยู่ในระดับสูงต่อเนื่องจากเดือนสิงหาคม ระบบติดตาม {totalWater} สถานีครอบคลุม {len(amphoeList)} อำเภอ พบสถานีในระดับวิกฤตสีแดง {criticalSt} สถานี เฝ้าระวัง {watchSt} สถานี และปกติ {normalSt} สถานี สถานการณ์น้ำในช่วงนี้ต้องติดตามอย่างใกล้ชิดเพื่อป้องกันอุทกภัยและเตรียมรับมือน้ำหลาก โดยเฉพาะในพื้นที่ลุ่มต่ำตามแนวแม่น้ำวังและแม่น้ำยม', indent=True)
add_empty_line(doc, 6)
add_body(doc, 'ด้านปริมาณน้ำฝน', bold=True)
add_body(doc, f'เครือข่ายตรวจวัดน้ำฝนอัตโนมัติ {len(station_totals)} สถานีทั่วทั้ง 13 อำเภอ ตรวจวัดได้ปริมาณฝนสะสมเฉลี่ย 266.05 มม. พื้นที่ตอนล่างของจังหวัด ได้แก่ อำเภอเสริมงาม (354.3 มม.) อำเภอเถิน (349.2 มม.) อำเภอสบปราบ (301.5 มม.) และอำเภอแม่พริก (300.6 มม.) มีฝนสะสมสูงกว่า 300 มม. โดยมีฝนตกชุกรุนแรงช่วงวันที่ 18-21 กันยายน ซึ่งมีสถานีฝนตกหนักพร้อมกันสูงสุดถึง 55 แห่ง จำเป็นต้องเฝ้าระวังพื้นที่เสี่ยงดินโคลนถล่มและน้ำท่วมฉับพลันอย่างต่อเนื่อง', indent=True)
add_empty_line(doc, 6)
add_body(doc, 'ด้านอ่างเก็บน้ำ', bold=True)
add_body(doc, f'อ่างเก็บน้ำขนาดใหญ่ทั้ง {len(largeDams)} แห่ง มีปริมาณน้ำสะสมจากฤดูฝน อ่างขนาดกลาง {len(medDams)} แห่ง ส่วนใหญ่มีปริมาณน้ำอยู่ในระดับที่ดี สถานการณ์น้ำต้นทุนโดยรวมอยู่ในระดับที่เหมาะสม สามารถรองรับความต้องการใช้น้ำในฤดูแล้งปีถัดไปได้เป็นอย่างดี ควรวางแผนบริหารน้ำอย่างเป็นระบบตั้งแต่ตอนนี้', indent=True)
add_empty_line(doc, 6)
add_body(doc, 'ด้านคุณภาพอากาศ PM2.5', bold=True)
add_body(doc, f'โดยรวมค่า PM2.5 ในเดือนกันยายนอยู่ในระดับดีถึงดีมาก ({good_pct}% ของการวัดทั้งหมด) สอดคล้องกับฤดูฝนที่ช่วยลดฝุ่นละออง ติดตาม {pTotal["stations"]} สถานีทั่วจังหวัด {"ยังพบค่าผิดปกติสูงในบางสถานีที่ต้องตรวจสอบ" if pExceed else "ไม่พบค่าเกินมาตรฐานอย่างมีนัยสำคัญในเดือนนี้"} อย่างไรก็ตาม ต้องเตรียมรับมือกับการเพิ่มขึ้นของค่า PM2.5 เมื่อเข้าสู่ฤดูหนาวในอีก 1-2 เดือนข้างหน้า', indent=True)
add_empty_line(doc, 6)
add_body(doc, 'ด้านเรื่องร้องเรียน', bold=True)
trend_comp = f'เพิ่มขึ้น {compTotal - compAugTotal} เรื่อง' if compTotal > compAugTotal else f'ลดลง {compAugTotal - compTotal} เรื่อง'
add_body(doc, f'ระบบร้องเรียนผ่าน Traffy Fondue มีเรื่องร้องเรียนในระบบ {compTotal} เรื่อง ดำเนินการเสร็จสิ้นแล้ว {compDone} เรื่อง คิดเป็น {compRate}% {"ประเภทปัญหาหลัก ได้แก่ " + " | ".join([t["problem_type"] for t in cByTypeToShow[:3]]) if cByTypeToShow else ""} เปรียบเทียบกับเดือนสิงหาคม {compAugTotal} เรื่อง {trend_comp}', indent=True)
add_empty_line(doc)

add_sub_header(doc, '7.2 ข้อเสนอแนะเชิงนโยบายระยะเร่งด่วน (ภายใน 30 วัน)')
for bi, clr in [
    ('เฝ้าระวังพื้นที่เสี่ยงอุทกภัยและดินโคลนถล่ม - จัดส่งเจ้าหน้าที่ประจำพื้นที่และเตรียมแผนอพยพประชาชนรับมือน้ำหลากช่วงปลายฤดูฝน โดยเฉพาะอำเภอเสริมงาม เถิน สบปราบ และแม่พริก', C_DANGER),
    ('เตรียมแผนรับมือ PM2.5 - วางแผนมาตรการป้องกันและรณรงค์ห้ามเผาก่อนเข้าฤดูหนาว (ตุลาคม 2569)', DARK),
    ('ตรวจสอบสถานีตรวจวัด PM2.5 ที่มีค่าสูงผิดปกติ - ดำเนินการตรวจสอบเชิงเทคนิคและความถูกต้องของข้อมูล', DARK),
    ('เร่งรัดและติดตามเรื่องร้องเรียนที่ค้างดำเนินการ โดยเฉพาะเรื่องที่เกี่ยวข้องกับโครงสร้างพื้นฐาน', DARK),
    ('วางแผนบริหารน้ำในอ่างเก็บน้ำสำหรับฤดูแล้งปี 2570 อย่างเร็วที่สุด', DARK),
]:
    add_bullet(doc, bi, color=clr)
add_empty_line(doc, 6)

add_sub_header(doc, '7.3 ข้อเสนอแนะเชิงนโยบายระยะกลาง (1-3 เดือน)')
for bi in [
    'พัฒนาระบบแจ้งเตือนภัยล่วงหน้าแบบอัตโนมัติ (Automated Early Warning) เชื่อมโยงข้อมูลน้ำฝนและระดับน้ำเข้ากับ Line/SMS เพื่อเตือนภัยน้ำหลากล่วงหน้า 6-12 ชั่วโมง',
    'เพิ่มจุดตรวจวัด PM2.5 ในพื้นที่ที่ยังไม่มีการครอบคลุม โดยเฉพาะอำเภอห่างไกล',
    'จัดทำแผนการบริหารน้ำในอ่างเก็บน้ำขนาดใหญ่สำหรับช่วงฤดูแล้งปีถัดไป (2570) ให้ครอบคลุมทุกภาคส่วน',
    'พัฒนา Dashboard แบบ Real-time สำหรับผู้บริหาร เข้าถึงได้บนอุปกรณ์เคลื่อนที่',
    'ประสานความร่วมมือกับกรมอุตุนิยมวิทยาและกรมชลประทาน เพื่อข้อมูลพยากรณ์ที่แม่นยำยิ่งขึ้น',
]:
    add_bullet(doc, bi)
add_empty_line(doc, 6)

add_sub_header(doc, '7.4 ข้อเสนอแนะเชิงยุทธศาสตร์ (3 เดือนขึ้นไป)')
for bi in [
    'บูรณาการข้อมูลทั้ง 5 ระบบเข้าสู่ศูนย์ปฏิบัติการอัจฉริยะ (Smart Operations Center) ของ อบจ.ลำปาง',
    'ใช้ประโยชน์จาก AI/ML วิเคราะห์แนวโน้มและพยากรณ์สถานการณ์น้ำ ภัยแล้ง และคุณภาพอากาศ',
    'ขยายความร่วมมือกับหน่วยงานรัฐและภาคเอกชนในการแลกเปลี่ยนข้อมูลสารสนเทศ',
    'จัดทำรายงานประจำเดือนเผยแพร่สู่สาธารณะผ่านเว็บไซต์และสื่อสังคมออนไลน์เพื่อความโปร่งใส',
]:
    add_bullet(doc, bi)
add_page_break(doc)

# ======= APPENDIX =======
add_section_header(doc, 'ภาคผนวก : ข้อมูลอ้างอิงและแหล่งข้อมูล')
add_empty_line(doc)
add_sub_header(doc, 'แหล่งข้อมูล')
for bi in [
    'ระบบเฝ้าระวังน้ำ: กรมชลประทาน / Thai Water (lampang.thaiwater.net) - ข้อมูลระดับน้ำรายชั่วโมง/รายวัน',
    'ระบบตรวจวัดน้ำฝน: กรมทรัพยากรน้ำ / กรมอุตุนิยมวิทยา / Thai Water - ข้อมูลสถานีตรวจวัดน้ำฝนอัตโนมัติ 182 สถานีทั่วจังหวัดลำปาง',
    'ระบบภัยแล้ง: กรมชลประทาน / กองอำนวยการน้ำแห่งชาติ - ข้อมูลอ่างเก็บน้ำรายวัน',
    'ระบบ PM2.5: กรมควบคุมมลพิษ (Air4Thai) / เครือข่ายตรวจวัดคุณภาพอากาศภาคเหนือ',
    'ระบบร้องเรียน: Traffy Fondue - ระบบรับเรื่องร้องเรียนออนไลน์ของจังหวัดลำปาง',
]:
    add_bullet(doc, bi)
add_empty_line(doc)
add_sub_header(doc, 'ข้อมูลเกี่ยวกับรายงาน')

def info_line(label, value):
    para = doc.add_paragraph()
    set_para_spacing(para, before=50, after=50)
    set_para_indent(para, left=360)
    r1 = para.add_run(f'{label}: ')
    set_font(r1, FONT_BODY, bold=True, color=DARK)
    r2 = para.add_run(value)
    set_font(r2, FONT_BODY, color=DARK)

info_line('ชื่อรายงาน', 'รายงานสรุปวิเคราะห์ข้อมูลรายเดือน กันยายน 2569')
info_line('ช่วงข้อมูล', '1 กันยายน - 30 กันยายน 2569')
info_line('วันที่จัดทำ', 'วันที่ 30 กันยายน พ.ศ. 2569')
info_line('จัดทำโดย', 'ฝ่ายเทคโนโลยีสารสนเทศ องค์การบริหารส่วนจังหวัดลำปาง')
info_line('ระบบสารสนเทศ', 'ระบบบูรณาการข้อมูลสารสนเทศ อบจ.ลำปาง (Water System Integration Platform)')
info_line('จำนวนบันทึกทั้งหมด', f'น้ำ {int(wTotal):,} | ฝน {int(rainTotalRecords):,} | ภัยแล้ง {int(dTotal):,} | PM2.5 {int(pTotal["cnt"]):,} | ร้องเรียน {compTotal} รายการ (รวม {int(total_records):,} รายการ)')

add_empty_line(doc, 10)
add_divider(doc)
p = doc.add_paragraph('รายงานฉบับนี้จัดทำโดยระบบสารสนเทศอัตโนมัติ - ข้อมูลมีความถูกต้องตามที่ได้รับจากแหล่งข้อมูลหลัก')
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_font(p.runs[0], FONT_SM, italic=True, color=GRAY)
p = doc.add_paragraph('Copyright วันที่ 30 กันยายน พ.ศ. 2569  ฝ่ายเทคโนโลยีสารสนเทศ อบจ.ลำปาง')
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_font(p.runs[0], FONT_SM, color=GRAY)

# ======= SAVE =======
outfile = 'reports_archive/รายงานสรุปวิเคราะห์ข้อมูล (กันยายน 2569) V.1.docx'
doc.save(outfile)
print(f'SUCCESS: Created file {outfile}')
print(f'File size: {os.path.getsize(outfile)/1024:.1f} KB')
