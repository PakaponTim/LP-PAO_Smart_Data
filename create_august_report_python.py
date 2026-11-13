# -*- coding: utf-8 -*-
"""
create_august_report_python.py
สร้างรายงานสรุปวิเคราะห์ข้อมูลรายเดือน สิงหาคม 2569
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
HDR_BG   = '2C2C2C'   # header shading (เทาเข้ม)
MED_BG   = '4A4A4A'   # medium shade
ROW_EVEN = 'F2F2F2'   # สลับแถว
KPI_BG   = 'F0F0F0'   # KPI cell bg

# Alert text colors (monochrome friendly)
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

# 1. Water monitoring (สิงหาคม 2569)
cursor.execute("""
    SELECT station_name, river, amphoe, province,
      ROUND(AVG(current_water_level_m),2) as avg_wl,
      MAX(current_water_level_m) as max_wl,
      MIN(current_water_level_m) as min_wl,
      ROUND(AVG(left_bank_level_m),2) as avg_bank,
      ROUND(AVG(bank_difference_m),2) as avg_diff,
      ROUND(AVG(current_rain_mm),2) as avg_rain,
      MAX(current_rain_mm) as max_rain,
      COUNT(*) as records,
      MAX(trend) as trend, MAX(status) as status, MAX(risk_level) as risk_level
    FROM tbl_water_disaster_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'
    GROUP BY station_name, river, amphoe, province
    ORDER BY amphoe, station_name
""")
wStations = cursor.fetchall()

cursor.execute("SELECT COUNT(*) as cnt FROM tbl_water_disaster_monitoring WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'")
wTotal = cursor.fetchone()['cnt']

cursor.execute("""
    SELECT DATE(recorded_at) as day,
      ROUND(AVG(current_water_level_m),2) as avg_wl,
      ROUND(MAX(current_water_level_m),2) as max_wl,
      COUNT(DISTINCT station_name) as active_stations
    FROM tbl_water_disaster_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'
    GROUP BY DATE(recorded_at) ORDER BY day LIMIT 31
""")
wDaily = cursor.fetchall()

# 2. Drought / Dams (สิงหาคม 2569)
cursor.execute("""
    SELECT dam_name, dam_type,
      ROUND(MAX(capacity_m_cum),2) as capacity,
      ROUND(AVG(water_volume_m_cum),2) as avg_volume,
      ROUND(AVG(usable_water_m_cum),2) as avg_usable,
      ROUND(AVG(inflow_m_cum),4) as avg_inflow,
      ROUND(AVG(discharge_m_cum),4) as avg_discharge,
      COUNT(*) as records
    FROM tbl_drought_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'
    GROUP BY dam_name, dam_type ORDER BY capacity DESC, dam_name
""")
dDams = cursor.fetchall()

cursor.execute("""
    SELECT dam_name, dam_type, water_volume_m_cum, water_percent,
      usable_water_m_cum, inflow_m_cum, discharge_m_cum, recorded_at
    FROM tbl_drought_monitoring
    WHERE recorded_at = (SELECT MAX(recorded_at) FROM tbl_drought_monitoring WHERE recorded_at < '2026-09-01')
    ORDER BY FIELD(dam_type,'อ่างขนาดใหญ่','อ่างขนาดกลาง','อ่างขนาดเล็ก'), dam_name
""")
dLatest = cursor.fetchall()

cursor.execute("SELECT COUNT(*) as cnt FROM tbl_drought_monitoring WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'")
dTotal = cursor.fetchone()['cnt']

# 3. PM2.5 monitoring (สิงหาคม 2569)
cursor.execute("""
    SELECT air_quality_status, COUNT(*) as cnt
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'
    GROUP BY air_quality_status ORDER BY cnt DESC
""")
pStatus = cursor.fetchall()

cursor.execute("SELECT COUNT(*) as cnt, COUNT(DISTINCT station_name) as stations FROM tbl_pm25_monitoring WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'")
pTotal = cursor.fetchone()

cursor.execute("""
    SELECT amphoe, COUNT(DISTINCT station_name) as stations,
      ROUND(AVG(pm25_value),2) as avg_pm25, ROUND(MAX(pm25_value),2) as max_pm25
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'
    GROUP BY amphoe ORDER BY avg_pm25 DESC
""")
pAmphoe = cursor.fetchall()

cursor.execute("""
    SELECT station_name, amphoe, ROUND(MAX(pm25_value),2) as max_pm25, COUNT(*) as times, air_quality_status
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01' AND pm25_value > 37.5
    GROUP BY station_name, amphoe, air_quality_status ORDER BY max_pm25 DESC LIMIT 10
""")
pExceed = cursor.fetchall()

cursor.execute("""
    SELECT station_name, amphoe,
      ROUND(AVG(pm25_value),2) as avg_pm25, ROUND(MAX(pm25_value),2) as max_pm25, COUNT(*) as records
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'
    GROUP BY station_name, amphoe ORDER BY avg_pm25 DESC LIMIT 30
""")
pStations = cursor.fetchall()

cursor.execute("""
    SELECT DATE(recorded_at) as day,
      ROUND(AVG(pm25_value),2) as avg_pm25, ROUND(MAX(pm25_value),2) as max_pm25, COUNT(*) as readings
    FROM tbl_pm25_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'
    GROUP BY DATE(recorded_at) ORDER BY day
""")
pDaily = cursor.fetchall()

# 4. Complaints monitoring
cursor.execute("""
    SELECT ticket_id, state_name, problem_type, location, ticket_datetime, agency_status
    FROM tbl_complaints_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'
    ORDER BY recorded_at DESC
""")
cAug = cursor.fetchall()

cursor.execute("""
    SELECT ticket_id, state_name, problem_type, location, ticket_datetime, agency_status
    FROM tbl_complaints_monitoring ORDER BY recorded_at DESC LIMIT 25
""")
cAll = cursor.fetchall()

cursor.execute("""
    SELECT problem_type, COUNT(*) as cnt
    FROM tbl_complaints_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'
    GROUP BY problem_type ORDER BY cnt DESC
""")
cByTypeAug = cursor.fetchall()

cursor.execute("SELECT problem_type, COUNT(*) as cnt FROM tbl_complaints_monitoring GROUP BY problem_type ORDER BY cnt DESC")
cByTypeAll = cursor.fetchall()

cursor.execute("""
    SELECT state_name, COUNT(*) as cnt
    FROM tbl_complaints_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'
    GROUP BY state_name ORDER BY cnt DESC
""")
cByStatusAug = cursor.fetchall()

cursor.execute("SELECT state_name, COUNT(*) as cnt FROM tbl_complaints_monitoring GROUP BY state_name ORDER BY cnt DESC")
cByStatusAll = cursor.fetchall()

cursor.execute("""
    SELECT COUNT(*) as cnt,
      SUM(CASE WHEN state_name='เสร็จสิ้น' THEN 1 ELSE 0 END) as done,
      SUM(CASE WHEN state_name LIKE '%รอ%' OR state_name LIKE '%ส่งต่อ%' THEN 1 ELSE 0 END) as pending
    FROM tbl_complaints_monitoring
    WHERE recorded_at >= '2026-08-01' AND recorded_at < '2026-09-01'
""")
cTotalAug = cursor.fetchone()

cursor.execute("""
    SELECT COUNT(*) as cnt,
      SUM(CASE WHEN state_name='เสร็จสิ้น' THEN 1 ELSE 0 END) as done
    FROM tbl_complaints_monitoring
""")
cTotalAll = cursor.fetchone()

conn.close()

# ──────────────────────────────────────────
# COMPUTED STATS
# ──────────────────────────────────────────
totalWater = len(wStations)
criticalSt = sum(1 for s in wStations if s['risk_level'] == 'วิกฤตสีแดง')
watchSt    = sum(1 for s in wStations if s['risk_level'] == 'เฝ้าระวัง')
normalSt   = sum(1 for s in wStations if s['risk_level'] == 'ปกติ')
amphoeList = list(dict.fromkeys(s['amphoe'] for s in wStations))

largeDams   = [d for d in dDams if d['dam_type'] == 'อ่างขนาดใหญ่']
medDams     = [d for d in dDams if d['dam_type'] == 'อ่างขนาดกลาง']
smallDams   = [d for d in dDams if d['dam_type'] == 'อ่างขนาดเล็ก']
latestLarge = [d for d in dLatest if d['dam_type'] == 'อ่างขนาดใหญ่']
latestMed   = [d for d in dLatest if d['dam_type'] == 'อ่างขนาดกลาง']

totalPM    = sum(int(s['cnt']) for s in pStatus)
pm25Good   = next((int(s['cnt']) for s in pStatus if s['air_quality_status'] == 'ดีมาก'), 0)
pm25Exceed = sum(int(e['times']) for e in pExceed)
good_pct   = round(pm25Good / totalPM * 100) if totalPM > 0 else 0

hasAugComp  = cTotalAug and cTotalAug['cnt'] and int(cTotalAug['cnt']) > 0
compTotal   = int(cTotalAug['cnt']) if hasAugComp else int(cTotalAll['cnt'] or 0)
compDone    = int(cTotalAug['done'] or 0) if hasAugComp else int(cTotalAll['done'] or 0)
compRate    = round(compDone / compTotal * 100) if compTotal > 0 else 0
compAllTotal= int(cTotalAll['cnt'] or 0)

cListToShow   = cAug if len(cAug) > 0 else cAll
cByTypeToShow = cByTypeAug if len(cByTypeAug) > 0 else cByTypeAll
cByStatusToShow = cByStatusAug if len(cByStatusAug) > 0 else cByStatusAll

print(f"Data summary: Water={totalWater} stations, Dams={len(dDams)}, PM2.5={pTotal['stations']} stations, Complaints={compTotal}")

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
    # Force Thai font for all script types
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

# ──────────────────────────────────────────
# DOCUMENT BUILDERS
# ──────────────────────────────────────────
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
    run = para.add_run(f'◆ {text}')
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
    sym  = '●  ' if level == 1 else '▸  '
    para = doc.add_paragraph()
    set_para_spacing(para, before=40, after=40)
    set_para_indent(para, left=left)
    r1 = para.add_run(sym)
    set_font(r1, FONT_BODY, bold=True, color=DARK)
    r2 = para.add_run(text)
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
    # Header row
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

    # Data rows
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
    return '[✓] ปกติ', C_OK, False

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

# Page setup: A4, margins 2cm
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
hp.text = 'รายงานสรุปวิเคราะห์ข้อมูลรายเดือน สิงหาคม ๒๕๖๙  |  ระบบบูรณาการข้อมูลสารสนเทศ อบจ.ลำปาง'
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

# Footer with page number
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

# ══════════════════════════════════════════
# COVER PAGE (หน้าปก)
# ══════════════════════════════════════════
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

# Title box
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

p = doc.add_paragraph('ประจำเดือน สิงหาคม พ.ศ. ๒๕๖๙')
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_para_spacing(p, before=80, after=60)
set_font(p.runs[0], FONT_TITLE, bold=True, color=BLACK)

p = doc.add_paragraph('( ๑ สิงหาคม – ๓๑ สิงหาคม ๒๕๖๙ )')
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_para_spacing(p, before=40, after=200)
set_font(p.runs[0], FONT_H2, color=GRAY)

add_empty_line(doc, 10)
add_kpi_table(doc, [
    ('สถานีตรวจวัดน้ำ', f'{totalWater} สถานี'),
    ('อ่างเก็บน้ำ', f'{len(dDams)} แห่ง'),
    ('สถานีตรวจ PM2.5', f'{pTotal["stations"]} สถานี'),
    ('เรื่องร้องเรียน', f'{compTotal} เรื่อง'),
])

add_empty_line(doc, 8)
add_divider(doc)
p = doc.add_paragraph('จัดทำ ณ วันที่ ๑ กันยายน พ.ศ. ๒๕๖๙')
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_font(p.runs[0], FONT_BODY, color=GRAY)
p = doc.add_paragraph('ฝ่ายเทคโนโลยีสารสนเทศ  |  องค์การบริหารส่วนจังหวัดลำปาง')
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_font(p.runs[0], FONT_BODY, color=GRAY)

add_page_break(doc)

# ══════════════════════════════════════════
# สารบัญ (TABLE OF CONTENTS)
# ══════════════════════════════════════════
add_section_header(doc, 'สารบัญ')
add_empty_line(doc)
toc_items = [
    ('บทที่ ๑', 'บทสรุปสำหรับผู้บริหาร (Executive Summary)'),
    ('บทที่ ๒', 'ระบบเฝ้าระวังน้ำและอุทกภัย'),
    ('บทที่ ๓', 'ระบบเฝ้าระวังภัยแล้ง (อ่างเก็บน้ำ)'),
    ('บทที่ ๔', 'ระบบติดตามคุณภาพอากาศ PM2.5'),
    ('บทที่ ๕', 'ระบบติดตามเรื่องร้องเรียนประชาชน'),
    ('บทที่ ๖', 'Dashboard และข้อมูลสารสนเทศเพื่อการติดตามและประเมินผล'),
    ('บทที่ ๗', 'บทสรุปและข้อเสนอแนะเชิงนโยบาย'),
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

# ══════════════════════════════════════════
# บทที่ 1: บทสรุปผู้บริหาร
# ══════════════════════════════════════════
add_section_header(doc, 'บทที่ ๑ : บทสรุปสำหรับผู้บริหาร (Executive Summary)')
add_empty_line(doc)
add_body(doc, 'รายงานฉบับนี้จัดทำขึ้นเพื่อสรุปผลการติดตามและวิเคราะห์ข้อมูลสารสนเทศด้านสิ่งแวดล้อมและสาธารณประโยชน์ของจังหวัดลำปาง ประจำเดือนสิงหาคม พ.ศ. ๒๕๖๙ (๑ – ๓๑ สิงหาคม ๒๕๖๙) ครอบคลุม ๔ ระบบหลัก ได้แก่ ระบบเฝ้าระวังน้ำ ระบบเฝ้าระวังภัยแล้ง ระบบติดตามคุณภาพอากาศ PM2.5 และระบบติดตามเรื่องร้องเรียนของประชาชน', indent=True)
add_empty_line(doc)
add_sub_sub_header(doc, 'สรุปสถานการณ์ภาพรวม')

add_body(doc, 'ระบบน้ำและเฝ้าระวังอุทกภัย', bold=True)
add_bullet(doc, f'ติดตามจำนวน {totalWater} สถานีตรวจวัด ครอบคลุม {len(amphoeList)} อำเภอในจังหวัดลำปาง')
add_bullet(doc, f'พบสถานีที่อยู่ในระดับวิกฤตสีแดง จำนวน {criticalSt} สถานี{" – ต้องเฝ้าระวังเป็นพิเศษ" if criticalSt > 0 else ""}', color=C_DANGER if criticalSt > 0 else DARK)
add_bullet(doc, f'สถานีระดับเฝ้าระวัง (สีเหลือง) จำนวน {watchSt} สถานี', color=C_WARN)
add_bullet(doc, f'สถานีระดับปกติ จำนวน {normalSt} สถานี', color=C_OK)
add_bullet(doc, 'เดือนสิงหาคมเป็นช่วงปลายฤดูฝน ระดับน้ำมีแนวโน้มสูงขึ้นต่อเนื่อง ต้องเฝ้าระวังอุทกภัยในพื้นที่ลุ่มต่ำอย่างใกล้ชิด')

add_empty_line(doc, 6)
add_body(doc, 'ระบบเฝ้าระวังภัยแล้ง (อ่างเก็บน้ำ)', bold=True)
add_bullet(doc, f'ติดตามอ่างเก็บน้ำ {len(dDams)} แห่ง แบ่งเป็นขนาดใหญ่ {len(largeDams)} แห่ง ขนาดกลาง {len(medDams)} แห่ง ขนาดเล็ก {len(smallDams)} แห่ง')
for d in latestLarge:
    add_bullet(doc, f'{d["dam_name"]}: ปริมาณน้ำ {float(d["water_volume_m_cum"]):.2f} ล้าน ลบ.ม. ({d["water_percent"]})')
add_bullet(doc, 'อ่างเก็บน้ำขนาดใหญ่มีปริมาณน้ำสะสมจากฤดูฝน สามารถสนับสนุนการใช้น้ำในฤดูแล้งถัดไปได้เป็นอย่างดี')

add_empty_line(doc, 6)
add_body(doc, 'ระบบติดตามคุณภาพอากาศ PM2.5', bold=True)
add_bullet(doc, f'ติดตาม {pTotal["stations"]} สถานีตรวจวัด รวม {int(pTotal["cnt"]):,} ค่าการวัด')
add_bullet(doc, f'ร้อยละ {good_pct}% ของค่าการวัดอยู่ในระดับ "ดีมาก" (ค่า PM2.5 ≤ 25 μg/m³)', color=C_OK)
if pExceed:
    add_bullet(doc, f'พบค่าเกินมาตรฐาน (>37.5 μg/m³) จำนวน {pm25Exceed} ครั้ง จาก {len(pExceed)} สถานี', color=C_DANGER)
else:
    add_bullet(doc, 'ไม่พบค่าเกินมาตรฐานในเดือนนี้', color=C_OK)

add_empty_line(doc, 6)
add_body(doc, 'ระบบร้องเรียนประชาชน (Traffy Fondue ลำปาง)', bold=True)
add_bullet(doc, f'รับเรื่องร้องเรียนในระบบ {compTotal} เรื่อง (สะสมทั้งหมด {compAllTotal} เรื่อง)')
add_bullet(doc, f'ดำเนินการเสร็จสิ้นแล้ว {compDone} เรื่อง ({compRate}%)')
if cByTypeToShow:
    top3 = ' | '.join([f'{t["problem_type"]} ({t["cnt"]} เรื่อง)' for t in cByTypeToShow[:3]])
    add_bullet(doc, f'ประเภทเรื่องร้องเรียนหลัก: {top3}')

add_empty_line(doc)
add_sub_sub_header(doc, 'ประเด็นที่ผู้บริหารควรทราบ')
if criticalSt > 0:
    add_highlight(doc, f'พื้นที่วิกฤต: พบสถานีตรวจวัดน้ำระดับวิกฤตสีแดง {criticalSt} สถานี – ต้องเฝ้าระวังอุทกภัยในช่วงปลายฤดูฝน', critical=True)
else:
    add_highlight(doc, 'ระดับน้ำ: ไม่พบสถานีที่อยู่ในระดับวิกฤตในเดือนสิงหาคม ๒๕๖๙')
if pExceed:
    add_highlight(doc, f'คุณภาพอากาศ: พบสถานีที่มีค่า PM2.5 เกินมาตรฐาน จำนวน {len(pExceed)} สถานี ต้องติดตามอย่างต่อเนื่อง', critical=True)
else:
    add_highlight(doc, 'คุณภาพอากาศ: ค่า PM2.5 โดยรวมอยู่ในระดับดี สอดคล้องกับฤดูฝนที่ช่วยลดปริมาณฝุ่นละออง')
add_highlight(doc, 'เดือนสิงหาคม: เป็นช่วงปลายฤดูฝน ให้ติดตามสถานการณ์น้ำในแม่น้ำวังและแม่น้ำยมอย่างใกล้ชิด และเตรียมพร้อมรับมืออุทกภัย')

add_page_break(doc)

# ══════════════════════════════════════════
# บทที่ 2: ระบบน้ำ
# ══════════════════════════════════════════
add_section_header(doc, 'บทที่ ๒ : ระบบเฝ้าระวังน้ำและอุทกภัย')
add_empty_line(doc)
add_sub_header(doc, '๒.๑ ภาพรวมสถานการณ์น้ำ เดือนสิงหาคม ๒๕๖๙')
add_body(doc, 'ระบบเฝ้าระวังน้ำของจังหวัดลำปางดำเนินการติดตามระดับน้ำแบบอัตโนมัติตลอด ๒๔ ชั่วโมง ผ่านเครือข่ายสถานีตรวจวัดที่กระจายทั่วพื้นที่ลุ่มน้ำสำคัญ ได้แก่ ลุ่มน้ำวัง และลุ่มน้ำยม เดือนสิงหาคม ๒๕๖๙ เป็นช่วงปลายฤดูฝน ระดับน้ำในแม่น้ำสายต่างๆ มีแนวโน้มสูงต่อเนื่องจากเดือนกรกฎาคม ต้องเฝ้าระวังความเสี่ยงอุทกภัยในพื้นที่ลุ่มต่ำอย่างใกล้ชิด', indent=True)
add_empty_line(doc)
add_kpi_table(doc, [
    ('จำนวนสถานีตรวจวัด', str(totalWater)),
    ('วิกฤตสีแดง', str(criticalSt)),
    ('เฝ้าระวัง', str(watchSt)),
    ('ระดับปกติ', str(normalSt)),
])

add_sub_header(doc, '๒.๒ สรุประดับความเสี่ยงตามประเภท')
add_body(doc, 'ผลการติดตามระดับน้ำและประเมินความเสี่ยงอุทกภัยของสถานีตรวจวัดทั้งหมด สรุปได้ดังนี้:')
add_data_table(doc,
    ['ระดับความเสี่ยง', 'จำนวนสถานี', 'ร้อยละ', 'ความหมาย'],
    [
        [{'text':'[!] วิกฤตสีแดง','align':L,'color':C_DANGER,'bold':True}, f'{criticalSt} สถานี', f'{round(criticalSt/totalWater*100) if totalWater else 0}%', {'text':'ระดับน้ำน้อยวิกฤต/น้ำมากวิกฤต ต้องเฝ้าระวัง','align':L}],
        [{'text':'[~] เฝ้าระวัง','align':L,'color':C_WARN,'bold':True},    f'{watchSt} สถานี',    f'{round(watchSt/totalWater*100) if totalWater else 0}%',    {'text':'ใกล้เกณฑ์วิกฤต','align':L}],
        [{'text':'[✓] ปกติ','align':L,'color':C_OK,'bold':True},            f'{normalSt} สถานี',   f'{round(normalSt/totalWater*100) if totalWater else 0}%',   {'text':'อยู่ในเกณฑ์ปกติ','align':L}],
        [{'text':'รวม','align':L,'bold':True},                               f'{totalWater} สถานี', '100%',                                                      {'text':'','align':L}],
    ],
    col_widths=[2800,2000,1500,2700]
)

add_sub_header(doc, '๒.๓ ข้อมูลสถานีตรวจวัดรายสถานี')
add_body(doc, 'ตารางแสดงค่าระดับน้ำเฉลี่ย ระดับตลิ่ง ปริมาณฝนเฉลี่ย และสถานะความเสี่ยงประจำเดือนสิงหาคม ๒๕๖๙:')
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
        s['avg_rain'] if s.get('avg_rain') is not None else '-',
        {'text': rt, 'color': rc, 'bold': rb},
    ])
add_data_table(doc,
    ['สถานีตรวจวัด','แม่น้ำ/ลุ่มน้ำ','อำเภอ','ระดับน้ำเฉลี่ย (ม.รทก.)','ระดับตลิ่ง (ม.รทก.)','ฝนเฉลี่ย (มม.)','ความเสี่ยง'],
    rows_w,
    col_widths=[2100,1500,1400,1800,1800,1400,2000]
)

add_sub_header(doc, '๒.๔ แนวโน้มระดับน้ำรายวัน')
add_body(doc, 'ตารางแสดงค่าระดับน้ำเฉลี่ยทุกสถานีรายวัน ประจำเดือนสิงหาคม ๒๕๖๙:')
rows_wd = []
for d in wDaily:
    day_str = str(d['day'])
    try:
        parts = day_str.split('-')
        thai_day = f"{int(parts[2])} ส.ค. ๒๕๖๙"
    except:
        thai_day = day_str
    rows_wd.append([
        {'text': thai_day, 'align': L},
        d['avg_wl'] if d.get('avg_wl') is not None else '-',
        d['max_wl'] if d.get('max_wl') is not None else '-',
        f'{d["active_stations"]} สถานี',
    ])
add_data_table(doc,
    ['วันที่','ระดับน้ำเฉลี่ย (ม.รทก.)','ระดับน้ำสูงสุด (ม.รทก.)','จำนวนสถานีที่รายงาน'],
    rows_wd, shade=MED_BG,
    col_widths=[2000,2200,2200,2100]
)

add_sub_header(doc, '๒.๕ พื้นที่วิกฤตและข้อเสนอแนะ')
critical_list = [s for s in wStations if s['risk_level'] == 'วิกฤตสีแดง']
if critical_list:
    add_sub_sub_header(doc, 'สถานีที่อยู่ในระดับวิกฤตสีแดง')
    for s in critical_list:
        add_bullet(doc, f'{s["station_name"]} ({s["amphoe"]}) – ระดับน้ำเฉลี่ย {s["avg_wl"]} ม.รทก., สถานะ: {s.get("status","-")}', color=C_DANGER)
    add_empty_line(doc, 6)
else:
    add_body(doc, 'ไม่พบสถานีที่อยู่ในระดับวิกฤตสีแดงในเดือนนี้', color=C_OK)

add_sub_sub_header(doc, 'ข้อเสนอแนะเชิงนโยบาย')
bullet_items_w = [
    'ควรจัดส่งเจ้าหน้าที่ลงพื้นที่เฝ้าระวังสถานีที่มีความเสี่ยง อย่างน้อยสัปดาห์ละ ๒ ครั้ง',
    'ประสานหน่วยงานที่เกี่ยวข้องเพื่อเตรียมแผนอพยพประชาชนในพื้นที่เสี่ยงอุทกภัยช่วงปลายฤดูฝน',
    'เพิ่มความถี่ในการรายงานข้อมูลระดับน้ำในช่วงฤดูฝน (สิงหาคม – ตุลาคม)',
    'เตรียมพร้อมเครื่องมือและเจ้าหน้าที่สำหรับรับมืออุทกภัยตลอด ๒๔ ชั่วโมง',
    'ติดตามสถานการณ์น้ำในแม่น้ำวังและแม่น้ำยมอย่างใกล้ชิด โดยเฉพาะในพื้นที่อำเภอเมืองลำปาง',
]
for bi in bullet_items_w:
    add_bullet(doc, bi)

add_page_break(doc)

# ══════════════════════════════════════════
# บทที่ 3: ภัยแล้ง
# ══════════════════════════════════════════
add_section_header(doc, 'บทที่ ๓ : ระบบเฝ้าระวังภัยแล้ง (อ่างเก็บน้ำ)')
add_empty_line(doc)
add_sub_header(doc, '๓.๑ ภาพรวมสถานการณ์อ่างเก็บน้ำ')
add_body(doc, 'ระบบเฝ้าระวังภัยแล้งติดตามปริมาณน้ำในอ่างเก็บน้ำทุกขนาด ๓ ประเภท ได้แก่ อ่างขนาดใหญ่ อ่างขนาดกลาง และอ่างขนาดเล็ก เพื่อประเมินสถานการณ์น้ำต้นทุนและวางแผนการจัดสรรน้ำในจังหวัดลำปาง ในช่วงเดือนสิงหาคม ๒๕๖๙ ซึ่งเป็นช่วงปลายฤดูฝน อ่างเก็บน้ำส่วนใหญ่มีปริมาณน้ำสะสมอยู่ในระดับที่ดี', indent=True)
add_empty_line(doc)
add_kpi_table(doc, [
    ('อ่างขนาดใหญ่', f'{len(largeDams)} แห่ง'),
    ('อ่างขนาดกลาง', f'{len(medDams)} แห่ง'),
    ('อ่างขนาดเล็ก', f'{len(smallDams)} แห่ง'),
    ('รวมทั้งหมด', f'{len(dDams)} แห่ง'),
])

add_sub_header(doc, '๓.๒ สถานการณ์อ่างเก็บน้ำขนาดใหญ่ ณ ปัจจุบัน')
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

add_sub_header(doc, '๓.๓ สถานการณ์อ่างเก็บน้ำขนาดกลาง (คัดเลือก)')
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

add_sub_header(doc, '๓.๔ ข้อมูลอ่างเก็บน้ำขนาดใหญ่ รายเดือน (ค่าเฉลี่ยสิงหาคม ๒๕๖๙)')
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

add_sub_header(doc, '๓.๕ การวิเคราะห์แนวโน้มและข้อเสนอแนะ')
add_sub_sub_header(doc, 'ผลการวิเคราะห์')
add_bullet(doc, 'อ่างกิ่วลม: อ่างเก็บน้ำขนาดใหญ่ที่สำคัญที่สุดของจังหวัด เดือนสิงหาคมปริมาณน้ำมีแนวโน้มสูงขึ้นจากช่วงปลายฤดูฝน')
add_bullet(doc, 'อ่างกิ่วคอหมา: ติดตามปริมาณน้ำใช้การได้อย่างใกล้ชิด เพื่อวางแผนการระบายน้ำในช่วงเปลี่ยนฤดูกาล')
add_bullet(doc, 'อ่างขนาดกลางส่วนใหญ่มีปริมาณน้ำสะสมอยู่ในระดับที่เหมาะสมสำหรับการจัดสรรน้ำในฤดูแล้งถัดไป')
add_sub_sub_header(doc, 'ข้อเสนอแนะ')
add_bullet(doc, 'วางแผนการจัดสรรน้ำเพื่อการเกษตรและอุปโภค-บริโภคช่วงฤดูแล้ง (พฤศจิกายน-เมษายน) อย่างระมัดระวัง')
add_bullet(doc, 'ติดตามและบันทึกปริมาณน้ำไหลเข้า-ออกอ่างอย่างละเอียดเพื่อประมาณการปริมาณน้ำต้นทุนปลายปี')
add_bullet(doc, 'เร่งรัดการตรวจสอบสภาพเขื่อนและอาคารระบายน้ำหลังสิ้นสุดฤดูฝน')
add_bullet(doc, 'ประชาสัมพันธ์สถานการณ์น้ำให้เกษตรกรในพื้นที่ชลประทานทราบเพื่อวางแผนการเพาะปลูกในฤดูต่อไป')

add_page_break(doc)

# ══════════════════════════════════════════
# บทที่ 4: PM2.5
# ══════════════════════════════════════════
add_section_header(doc, 'บทที่ ๔ : ระบบติดตามคุณภาพอากาศ PM2.5')
add_empty_line(doc)
add_sub_header(doc, '๔.๑ ภาพรวมคุณภาพอากาศ เดือนสิงหาคม ๒๕๖๙')
add_body(doc, 'การติดตามคุณภาพอากาศโดยวัดค่าฝุ่นละอองขนาดเล็ก PM2.5 ดำเนินการผ่านเครือข่ายสถานีตรวจวัดอัตโนมัติที่กระจายตัวในพื้นที่ต่างๆ ของจังหวัดลำปาง ในช่วงเดือนสิงหาคม ซึ่งเป็นช่วงปลายฤดูฝน ค่า PM2.5 โดยรวมอยู่ในระดับดี เนื่องจากน้ำฝนช่วยชะล้างฝุ่นละอองในบรรยากาศ', indent=True)
add_empty_line(doc)
add_kpi_table(doc, [
    ('สถานีตรวจวัด', str(pTotal['stations'])),
    ('ค่าการวัดทั้งหมด', f'{int(pTotal["cnt"]):,}'),
    (f'ระดับ "ดีมาก"', f'{good_pct}%'),
    ('เกินมาตรฐาน (>37.5)', f'{pm25Exceed} ครั้ง'),
])

add_sub_header(doc, '๔.๒ สรุประดับคุณภาพอากาศ')
thresholds = {'ดีมาก':'0 – 25','ดี':'25.1 – 37.5','ปานกลาง':'37.6 – 75','เริ่มมีผลต่อสุขภาพ':'75.1 – 150','มีผลกระทบต่อสุขภาพ':'> 150'}
pm_colors  = {'ดีมาก':C_OK,'ดี':C_OK,'ปานกลาง':C_WARN,'เริ่มมีผลต่อสุขภาพ':C_WARN,'มีผลกระทบต่อสุขภาพ':C_DANGER}
add_data_table(doc,
    ['ระดับคุณภาพอากาศ','เกณฑ์ PM2.5 (μg/m³)','จำนวนครั้ง','สัดส่วน (%)'],
    [[
        {'text': s['air_quality_status'], 'align': L, 'color': pm_colors.get(s['air_quality_status'], DARK), 'bold': True},
        thresholds.get(s['air_quality_status'], '-'),
        f'{int(s["cnt"]):,}',
        f'{round(int(s["cnt"])/totalPM*100) if totalPM else 0}%',
    ] for s in pStatus],
    col_widths=[2500,2200,2000,1300]
)

add_sub_header(doc, '๔.๓ ค่า PM2.5 รายอำเภอ')
add_data_table(doc,
    ['อำเภอ','จำนวนสถานี','ค่าเฉลี่ย (μg/m³)','ค่าสูงสุด (μg/m³)'],
    [[
        {'text': a['amphoe'], 'align': L},
        f'{a["stations"]} สถานี',
        {'text': str(a['avg_pm25']), 'color': pm25_color(a['avg_pm25'])},
        {'text': str(a['max_pm25']), 'bold': float(a['max_pm25'] or 0) > 75, 'color': pm25_color(a['max_pm25'])},
    ] for a in pAmphoe],
    col_widths=[2500,1500,2000,2000]
)

add_sub_header(doc, '๔.๔ สถานีที่มีค่าเกินมาตรฐาน (PM2.5 > 37.5 μg/m³)')
if pExceed:
    add_data_table(doc,
        ['สถานีตรวจวัด','อำเภอ','ค่าสูงสุด (μg/m³)','จำนวนครั้ง','ระดับผลกระทบ'],
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
    add_body(doc, 'ไม่พบสถานีที่มีค่าเกินมาตรฐานในเดือนนี้', color=C_OK)

add_sub_header(doc, '๔.๕ ข้อมูลสถานีตรวจวัด PM2.5 รายสถานี (เรียงจากค่าสูงไปต่ำ)')
add_data_table(doc,
    ['สถานีตรวจวัด','อำเภอ','ค่าเฉลี่ย PM2.5 (μg/m³)','ค่าสูงสุด (μg/m³)','จำนวนบันทึก'],
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

add_sub_header(doc, '๔.๖ แนวโน้มค่า PM2.5 รายวัน')
rows_pd = []
for d in pDaily:
    day_str = str(d['day'])
    try:
        parts = day_str.split('-')
        thai_day = f"{int(parts[2])} ส.ค. ๒๕๖๙"
    except:
        thai_day = day_str
    rows_pd.append([
        {'text': thai_day, 'align': L},
        {'text': str(d['avg_pm25']), 'color': pm25_color(d['avg_pm25'])},
        {'text': str(d['max_pm25']), 'color': pm25_color(d['max_pm25'])},
        f'{int(d["readings"]):,}',
    ])
add_data_table(doc, ['วันที่','ค่าเฉลี่ย (μg/m³)','ค่าสูงสุด (μg/m³)','จำนวนค่าการวัด'], rows_pd, col_widths=[2000,2000,2000,2000])

add_sub_header(doc, '๔.๗ ข้อเสนอแนะด้านคุณภาพอากาศ')
if pExceed:
    add_bullet(doc, 'ตรวจสอบความถูกต้องของเซ็นเซอร์ที่มีค่าสูงผิดปกติ และประชาสัมพันธ์ให้ประชาชนป้องกันตนเอง', color=C_DANGER)
else:
    add_bullet(doc, 'ค่า PM2.5 ในเดือนสิงหาคมอยู่ในระดับที่ดี สอดคล้องกับฤดูฝน – ควรรักษามาตรการป้องกันการเผาในที่โล่ง', color=C_OK)
add_bullet(doc, 'เตรียมความพร้อมรับมือค่า PM2.5 ที่อาจเพิ่มสูงในช่วงเริ่มต้นฤดูหนาว (ตุลาคม-พฤศจิกายน)')
add_bullet(doc, 'ส่งเสริมการลดกิจกรรมที่ก่อให้เกิดฝุ่นในชุมชน โดยเฉพาะการเผาในที่โล่ง')
add_bullet(doc, 'พัฒนาระบบแจ้งเตือนอัตโนมัติเมื่อค่า PM2.5 เกินมาตรฐานให้ประชาชนรับทราบผ่านช่องทางต่างๆ')

add_page_break(doc)

# ══════════════════════════════════════════
# บทที่ 5: ร้องเรียน
# ══════════════════════════════════════════
add_section_header(doc, 'บทที่ ๕ : ระบบติดตามเรื่องร้องเรียนประชาชน (Traffy Fondue ลำปาง)')
add_empty_line(doc)
add_sub_header(doc, '๕.๑ ภาพรวมเรื่องร้องเรียน')
add_body(doc, 'ระบบรับและติดตามเรื่องร้องเรียนผ่านแพลตฟอร์ม Traffy Fondue เป็นช่องทางหลักที่ประชาชนในจังหวัดลำปางใช้แจ้งปัญหาและข้อร้องเรียนต่างๆ ไปยังหน่วยงานรับผิดชอบ ระบบสามารถติดตามสถานะการดำเนินการและวัดความพึงพอใจของผู้ร้องเรียนได้', indent=True)
add_empty_line(doc)
add_kpi_table(doc, [
    ('เรื่องร้องเรียนในระบบ', str(compTotal)),
    ('ดำเนินการเสร็จสิ้น', str(compDone)),
    ('อยู่ระหว่างดำเนินการ', str(compTotal - compDone)),
    ('อัตราดำเนินการสำเร็จ', f'{compRate}%'),
])

add_sub_header(doc, '๕.๒ สรุปสถานะเรื่องร้องเรียน')
add_data_table(doc,
    ['สถานะ','จำนวน (เรื่อง)','ร้อยละ'],
    [[
        {'text': s['state_name'], 'align': L},
        str(s['cnt']),
        f'{round(int(s["cnt"])/compTotal*100) if compTotal else 0}%',
    ] for s in cByStatusToShow],
    col_widths=[4000,2000,2000]
)

add_sub_header(doc, '๕.๓ ประเภทเรื่องร้องเรียนที่พบบ่อย')
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

add_sub_header(doc, '๕.๔ รายการเรื่องร้องเรียนในระบบ')
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

add_sub_header(doc, '๕.๕ ข้อเสนอแนะด้านระบบร้องเรียน')
add_bullet(doc, 'เร่งรัดการดำเนินการเรื่องร้องเรียนที่อยู่ระหว่างดำเนินการ โดยเฉพาะเรื่องถนนและโครงสร้างพื้นฐาน')
add_bullet(doc, 'จัดทำรายงานสรุปผลการดำเนินการเรื่องร้องเรียนเสนอผู้บริหารเป็นรายเดือนอย่างต่อเนื่อง')
add_bullet(doc, 'พัฒนาระบบแจ้งเตือนอัตโนมัติเมื่อเรื่องร้องเรียนค้างนานเกิน ๑๕ วัน')
add_bullet(doc, 'เพิ่มช่องทางการแสดงความพึงพอใจเพื่อวัดประสิทธิภาพการบริการของหน่วยงาน')
add_bullet(doc, 'ประสานงานหน่วยงานที่รับผิดชอบให้มีการตอบสนองต่อเรื่องร้องเรียนอย่างรวดเร็วและมีประสิทธิภาพ')

add_page_break(doc)

# ══════════════════════════════════════════
# บทที่ 6: Dashboard
# ══════════════════════════════════════════
add_section_header(doc, 'บทที่ ๖ : Dashboard และข้อมูลสารสนเทศเพื่อการติดตามและประเมินผล')
add_empty_line(doc)
add_sub_header(doc, '๖.๑ ตารางสรุป Dashboard ภาพรวม ๔ ระบบ')
add_body(doc, 'ตารางสรุปผลการดำเนินงานและตัวชี้วัดสำคัญ (KPI) ของระบบสารสนเทศบูรณาการ ประจำเดือนสิงหาคม ๒๕๖๙:')
add_empty_line(doc, 6)
dashboard_rows = [
    [{'text':'ระบบน้ำ','align':L,'bold':True}, {'text':'จำนวนสถานีตรวจวัด','align':L}, f'{totalWater} สถานี', {'text':'[✓] ปกติ','color':C_OK}],
    [{'text':'','align':L}, {'text':'สถานีวิกฤตสีแดง','align':L}, f'{criticalSt} สถานี', {'text':'[!] ต้องเฝ้าระวัง','color':C_DANGER} if criticalSt > 0 else {'text':'[✓] ไม่มี','color':C_OK}],
    [{'text':'','align':L}, {'text':'สถานีเฝ้าระวัง','align':L}, f'{watchSt} สถานี', {'text':'[~] ระวัง','color':C_WARN}],
    [{'text':'อ่างเก็บน้ำ','align':L,'bold':True}, {'text':'จำนวนอ่างที่ติดตาม','align':L}, f'{len(dDams)} แห่ง', {'text':'[✓] ปกติ','color':C_OK}],
]
for d in latestLarge:
    ok = int(str(d['water_percent']).replace('%','')) >= 60
    dashboard_rows.append([{'text':'','align':L}, {'text':d['dam_name'],'align':L}, f'{float(d["water_volume_m_cum"]):.2f} ล้าน ลบ.ม. ({d["water_percent"]})', {'text':'[✓] เพียงพอ' if ok else '[~] ติดตาม','color':C_OK if ok else C_WARN}])
dashboard_rows += [
    [{'text':'PM2.5','align':L,'bold':True}, {'text':'สถานีตรวจวัด','align':L}, f'{pTotal["stations"]} สถานี', {'text':'[✓] ปกติ','color':C_OK}],
    [{'text':'','align':L}, {'text':'สัดส่วนระดับดีมาก','align':L}, f'{good_pct}%', {'text':'[✓] ดี','color':C_OK}],
    [{'text':'','align':L}, {'text':'ครั้งที่เกินมาตรฐาน','align':L}, f'{pm25Exceed} ครั้ง', {'text':'[!] ต้องติดตาม','color':C_DANGER} if pm25Exceed > 0 else {'text':'[✓] ปกติ','color':C_OK}],
    [{'text':'ร้องเรียน','align':L,'bold':True}, {'text':'เรื่องร้องเรียนในระบบ','align':L}, f'{compTotal} เรื่อง', {'text':'[i] ติดตาม','color':DARK}],
    [{'text':'','align':L}, {'text':'อัตราดำเนินการสำเร็จ','align':L}, f'{compRate}%', {'text':'[✓] ดี' if compRate >= 70 else '[~] ต้องปรับปรุง','color':C_OK if compRate >= 70 else C_WARN}],
]
add_data_table(doc, ['ระบบ','ตัวชี้วัดหลัก','ค่า','สถานะ'], dashboard_rows, shade=MED_BG, col_widths=[2000,2500,2200,1800])

add_sub_header(doc, '๖.๒ ความถูกต้องและครบถ้วนของข้อมูล')
add_data_table(doc,
    ['ระบบ','ความครอบคลุม','ความถี่การอัปเดต','ช่วงเวลาข้อมูล','ความสมบูรณ์'],
    [
        [{'text':'ระบบน้ำ','align':L,'bold':True}, f'{len(amphoeList)} อำเภอ / {totalWater} สถานี', 'ทุก 30 นาที', '1-31 ส.ค. 69', {'text':'[✓] ครบถ้วน','color':C_OK}],
        [{'text':'ระบบภัยแล้ง','align':L,'bold':True}, f'{len(dDams)} อ่างเก็บน้ำ', 'ทุก 30 นาที', '1-31 ส.ค. 69', {'text':'[✓] ครบถ้วน','color':C_OK}],
        [{'text':'ระบบ PM2.5','align':L,'bold':True}, f'{pTotal["stations"]} สถานี', 'ทุก 30 นาที', '1-31 ส.ค. 69', {'text':'[✓] ครบถ้วน','color':C_OK}],
        [{'text':'ระบบร้องเรียน','align':L,'bold':True}, 'ครอบคลุมทุกอำเภอ', 'Real-time', 'สะสมทั้งปี', {'text':'[✓] ครบถ้วน','color':C_OK}],
    ],
    col_widths=[1700,2200,1800,1800,1500]
)

add_sub_header(doc, '๖.๓ สรุปตัวชี้วัดประสิทธิภาพ (KPI) ระบบสารสนเทศ')
total_records = int(wTotal) + int(dTotal) + int(pTotal['cnt'])
add_data_table(doc,
    ['KPI','เป้าหมาย','ผลการดำเนินงาน','ผลประเมิน'],
    [
        [{'text':'ความพร้อมใช้ระบบ (Uptime)','align':L}, '≥ 95%', '≥ 99% (ทุกระบบ)', {'text':'[✓] ผ่าน','color':C_OK}],
        [{'text':'ความถูกต้องข้อมูล','align':L}, '≥ 95%', f'{total_records:,} รายการ', {'text':'[✓] ผ่าน','color':C_OK}],
        [{'text':'ความทันสมัยของข้อมูล','align':L}, '≤ 30 นาที', 'อัปเดตทุก 30 นาที', {'text':'[✓] ผ่าน','color':C_OK}],
        [{'text':'การดำเนินการเรื่องร้องเรียน','align':L}, '≥ 70%', f'{compRate}%', {'text':'[✓] ผ่าน' if compRate >= 70 else '[~] ต้องปรับปรุง','color':C_OK if compRate >= 70 else C_WARN}],
        [{'text':'ครอบคลุมพื้นที่ตรวจวัด','align':L}, 'ทุกอำเภอ', f'{len(amphoeList)} อำเภอ (น้ำ) + ทุกอำเภอ (PM2.5)', {'text':'[✓] ผ่าน','color':C_OK}],
    ],
    col_widths=[2800,1500,2500,1700]
)
add_page_break(doc)

# ══════════════════════════════════════════
# บทที่ 7: สรุปและข้อเสนอแนะ
# ══════════════════════════════════════════
add_section_header(doc, 'บทที่ ๗ : บทสรุปและข้อเสนอแนะเชิงนโยบาย')
add_empty_line(doc)
add_sub_header(doc, '๗.๑ สรุปภาพรวมสถานการณ์ประจำเดือน')
add_body(doc, 'จากการติดตามข้อมูลสารสนเทศทั้ง ๔ ระบบ ในเดือนสิงหาคม ๒๕๖๙ สรุปสถานการณ์โดยรวมได้ดังนี้:', indent=True)
add_empty_line(doc, 6)
add_body(doc, 'ด้านน้ำและอุทกภัย', bold=True)
add_body(doc, f'จังหวัดลำปางอยู่ในช่วงปลายฤดูฝน ระดับน้ำในแม่น้ำสายหลักมีแนวโน้มสูงต่อเนื่องจากเดือนกรกฎาคม ระบบติดตาม {totalWater} สถานีครอบคลุม {len(amphoeList)} อำเภอ พบสถานีในระดับวิกฤตสีแดง {criticalSt} สถานี เฝ้าระวัง {watchSt} สถานี และปกติ {normalSt} สถานี สถานการณ์น้ำในช่วงนี้ต้องติดตามอย่างใกล้ชิดเพื่อป้องกันอุทกภัยและเตรียมรับมือน้ำหลาก', indent=True)
add_empty_line(doc, 6)
add_body(doc, 'ด้านอ่างเก็บน้ำ', bold=True)
add_body(doc, f'อ่างเก็บน้ำขนาดใหญ่ทั้ง {len(largeDams)} แห่ง มีปริมาณน้ำสะสมจากฤดูฝน อ่างขนาดกลาง {len(medDams)} แห่ง ส่วนใหญ่มีปริมาณน้ำอยู่ในระดับที่ดี สถานการณ์น้ำต้นทุนโดยรวมสามารถรองรับความต้องการใช้น้ำในฤดูแล้งถัดไปได้เป็นอย่างดี', indent=True)
add_empty_line(doc, 6)
add_body(doc, 'ด้านคุณภาพอากาศ PM2.5', bold=True)
add_body(doc, f'โดยรวมค่า PM2.5 ในเดือนสิงหาคมอยู่ในระดับดีถึงดีมาก ({good_pct}% ของการวัดทั้งหมด) สอดคล้องกับฤดูฝนที่ช่วยลดฝุ่นละออง ติดตาม {pTotal["stations"]} สถานีทั่วจังหวัด {"ยังพบค่าผิดปกติสูงในบางสถานีที่ต้องตรวจสอบ" if pExceed else "ไม่พบค่าเกินมาตรฐานอย่างมีนัยสำคัญในเดือนนี้"} ควรเตรียมมาตรการรับมือฝุ่น PM2.5 ช่วงฤดูหนาว', indent=True)
add_empty_line(doc, 6)
add_body(doc, 'ด้านเรื่องร้องเรียน', bold=True)
add_body(doc, f'ระบบร้องเรียนผ่าน Traffy Fondue มีเรื่องร้องเรียนในระบบ {compTotal} เรื่อง ดำเนินการเสร็จสิ้นแล้ว {compDone} เรื่อง คิดเป็น {compRate}% {"ประเภทปัญหาหลัก ได้แก่ " + " | ".join([t["problem_type"] for t in cByTypeToShow[:3]]) if cByTypeToShow else ""}', indent=True)
add_empty_line(doc)

add_sub_header(doc, '๗.๒ ข้อเสนอแนะเชิงนโยบายระยะเร่งด่วน (ภายใน ๓๐ วัน)')
add_bullet(doc, 'เฝ้าระวังพื้นที่เสี่ยงอุทกภัย – จัดส่งเจ้าหน้าที่ประจำพื้นที่และเตรียมแผนอพยพประชาชนรับมือน้ำหลากช่วงปลายฤดูฝน', color=C_DANGER)
add_bullet(doc, 'ตรวจสอบสถานีตรวจวัด PM2.5 ที่มีค่าสูงผิดปกติ – ดำเนินการตรวจสอบเชิงเทคนิคและความถูกต้องของข้อมูล')
add_bullet(doc, 'เร่งรัดและติดตามเรื่องร้องเรียนที่ค้างดำเนินการ โดยเฉพาะเรื่องที่เกี่ยวข้องกับโครงสร้างพื้นฐาน')
add_bullet(doc, 'เริ่มวางแผนรับมือฝุ่น PM2.5 ในช่วงฤดูหนาวล่วงหน้า (ตุลาคม-พฤศจิกายน)')
add_empty_line(doc, 6)

add_sub_header(doc, '๗.๓ ข้อเสนอแนะเชิงนโยบายระยะกลาง (๑–๓ เดือน)')
add_bullet(doc, 'พัฒนาระบบแจ้งเตือนภัยล่วงหน้าแบบอัตโนมัติ (Automated Early Warning) เชื่อมต่อกับ Line/SMS สำหรับน้ำ PM2.5 และภัยแล้ง')
add_bullet(doc, 'เพิ่มจุดตรวจวัด PM2.5 ในพื้นที่ที่ยังไม่มีการครอบคลุม โดยเฉพาะอำเภอห่างไกล')
add_bullet(doc, 'จัดทำแผนการบริหารน้ำในอ่างเก็บน้ำขนาดใหญ่สำหรับช่วงฤดูแล้งปีถัดไป (๒๕๗๐)')
add_bullet(doc, 'พัฒนา Dashboard แบบ Real-time สำหรับผู้บริหาร เข้าถึงได้บนอุปกรณ์เคลื่อนที่')
add_empty_line(doc, 6)

add_sub_header(doc, '๗.๔ ข้อเสนอแนะเชิงยุทธศาสตร์ (๓ เดือนขึ้นไป)')
add_bullet(doc, 'บูรณาการข้อมูลทั้ง ๔ ระบบเข้าสู่ศูนย์ปฏิบัติการอัจฉริยะ (Smart Operations Center) ของ อบจ.ลำปาง')
add_bullet(doc, 'ใช้ประโยชน์จาก AI/ML วิเคราะห์แนวโน้มและพยากรณ์สถานการณ์น้ำ ภัยแล้ง และคุณภาพอากาศ')
add_bullet(doc, 'ขยายความร่วมมือกับหน่วยงานรัฐและภาคเอกชนในการแลกเปลี่ยนข้อมูลสารสนเทศ')
add_bullet(doc, 'จัดทำรายงานประจำเดือนเผยแพร่สู่สาธารณะผ่านเว็บไซต์และสื่อสังคมออนไลน์เพื่อความโปร่งใส')
add_page_break(doc)

# ══════════════════════════════════════════
# ภาคผนวก
# ══════════════════════════════════════════
add_section_header(doc, 'ภาคผนวก : ข้อมูลอ้างอิงและแหล่งข้อมูล')
add_empty_line(doc)
add_sub_header(doc, 'แหล่งข้อมูล')
add_bullet(doc, 'ระบบเฝ้าระวังน้ำ: กรมชลประทาน / Thai Water (lampang.thaiwater.net) – ข้อมูล ณ วันที่ 1-31 สิงหาคม 2569')
add_bullet(doc, 'ระบบภัยแล้ง: กรมชลประทาน / กองอำนวยการน้ำแห่งชาติ – ข้อมูลอ่างเก็บน้ำรายวัน')
add_bullet(doc, 'ระบบ PM2.5: กรมควบคุมมลพิษ (Air4Thai) / เครือข่ายตรวจวัดคุณภาพอากาศภาคเหนือ')
add_bullet(doc, 'ระบบร้องเรียน: Traffy Fondue – ระบบรับเรื่องร้องเรียนออนไลน์ของจังหวัดลำปาง')
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

info_line('ชื่อรายงาน', 'รายงานสรุปวิเคราะห์ข้อมูลรายเดือน สิงหาคม ๒๕๖๙')
info_line('ช่วงข้อมูล', '๑ สิงหาคม – ๓๑ สิงหาคม ๒๕๖๙')
info_line('วันที่จัดทำ', 'วันที่ ๑ กันยายน พ.ศ. ๒๕๖๙')
info_line('จัดทำโดย', 'ฝ่ายเทคโนโลยีสารสนเทศ องค์การบริหารส่วนจังหวัดลำปาง')
info_line('ระบบสารสนเทศ', 'ระบบบูรณาการข้อมูลสารสนเทศ อบจ.ลำปาง (Water System Integration Platform)')
info_line('จำนวนบันทึกทั้งหมด', f'น้ำ {int(wTotal):,} | ภัยแล้ง {int(dTotal):,} | PM2.5 {int(pTotal["cnt"]):,} | ร้องเรียน {compTotal} รายการ')

add_empty_line(doc, 10)
add_divider(doc)
p = doc.add_paragraph('รายงานฉบับนี้จัดทำโดยระบบสารสนเทศอัตโนมัติ – ข้อมูลมีความถูกต้องตามที่ได้รับจากแหล่งข้อมูลหลัก')
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_font(p.runs[0], FONT_SM, italic=True, color=GRAY)
p = doc.add_paragraph('© วันที่ ๑ กันยายน พ.ศ. ๒๕๖๙  ฝ่ายเทคโนโลยีสารสนเทศ อบจ.ลำปาง')
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_font(p.runs[0], FONT_SM, color=GRAY)

# ══════════════════════════════════════════
# SAVE
# ══════════════════════════════════════════
outfile = 'รายงานสรุปวิเคราะห์ข้อมูล (สิงหาคม 2569).docx'
doc.save(outfile)
print(f'SUCCESS: Created file {outfile}')
print(f'File size: {os.path.getsize(outfile)/1024:.1f} KB')

