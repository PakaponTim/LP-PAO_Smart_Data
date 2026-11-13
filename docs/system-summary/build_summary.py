from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from docx import Document
from docx.shared import Cm, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT

ROOT = Path(__file__).parent
ASSETS = ROOT / 'assets'
FONT = 'TH SarabunPSK'

def diagram(name, cards, cols=2, footer=None):
    w=1600; cw=740 if cols==2 else 1480; ch=205
    rows=(len(cards)+cols-1)//cols
    im=Image.new('RGB',(w,rows*255+50+(85 if footer else 0)),'white')
    d=ImageDraw.Draw(im)
    normal=ImageFont.truetype(str(ASSETS/'THSarabunPSK.ttf'),48)
    bold=ImageFont.truetype(str(ASSETS/'THSarabunPSK-Bold.ttf'),54)
    colors=['#126F91','#20866E','#956C20','#7D5796']
    for i,(title,body) in enumerate(cards):
        x=40+(i%cols)*780; y=25+(i//cols)*255
        color=colors[i%4]
        d.rounded_rectangle((x,y,x+cw,y+ch),radius=24,fill='#F1F6F8',outline='#D6E2E7',width=3)
        d.rounded_rectangle((x,y,x+14,y+ch),radius=6,fill=color)
        d.text((x+38,y+20),title,font=bold,fill=color)
        d.text((x+38,y+91),body,font=normal,fill='#20333B',spacing=6)
        if cols==1 and i<len(cards)-1:
            cx=800; ay=y+ch+6
            d.line((cx,ay,cx,ay+29),fill='#829BA6',width=5)
            d.polygon([(cx-11,ay+20),(cx+11,ay+20),(cx,ay+35)],fill='#829BA6')
    if footer: d.text((50,rows*255+35),footer,font=normal,fill='#20333B')
    out=ASSETS/(name+'.png'); im.save(out); return out

overview=diagram('overview',[
 ('น้ำและฝน','ระดับน้ำ สถานี และปริมาณฝน'),
 ('อ่างเก็บน้ำ','ปริมาณน้ำและสัดส่วนความจุ'),
 ('คุณภาพอากาศ','ข้อมูล PM2.5 รายสถานี'),
 ('เรื่องร้องเรียน','รายการปัญหาและสถานะล่าสุด')],footer='ข้อมูลรวมในระบบเดียว เพื่อดูสถานการณ์และติดตามงาน')
pipeline=diagram('pipeline',[
 ('1  แหล่งข้อมูล','ThaiWater ลำปาง และ Traffy'),
 ('2  เก็บและตรวจข้อมูล','ตัวดึงข้อมูลบนเซิร์ฟเวอร์ หรือ Chrome Extension'),
 ('3  บันทึกข้อมูลหลัก','จัดเก็บใน MySQL และตรวจการส่งข้อมูลชุดเดิมซ้ำ'),
 ('4  นำข้อมูลไปใช้','แดชบอร์ด แผนที่ รายงาน และการแจ้งเตือน')],cols=1)
incident=diagram('incident',[
 ('1  พบเหตุแจ้งเตือน','ตรวจข้อมูลล่าสุดและรายละเอียดพื้นที่'),
 ('2  รับทราบเหตุ','ระบุผู้รับผิดชอบและบันทึกข้อสังเกต'),
 ('3  ดำเนินการ','ปรับสถานะและติดตามความคืบหน้า'),
 ('4  ปิดเหตุหรือเปิดใหม่','เก็บประวัติผู้ดำเนินการไว้ตรวจสอบ')])

doc=Document(); sec=doc.sections[0]
sec.page_width=Cm(21); sec.page_height=Cm(29.7)
sec.top_margin=Cm(1.8); sec.bottom_margin=Cm(1.7)
sec.left_margin=Cm(2); sec.right_margin=Cm(2)
for name in ['Normal','Title','Heading 1','Heading 2','Caption']:
    s=doc.styles[name]; s.font.name=FONT; s.font.size=Pt(18 if name in ['Title','Heading 1','Heading 2'] else 16)
    s.font.color.rgb=RGBColor(0,0,0)
    s.font.bold=name in ['Title','Heading 1','Heading 2']
    rpr=s.element.get_or_add_rPr()
    for attr in list(rpr.rFonts.attrib):
        if 'Theme' in attr: del rpr.rFonts.attrib[attr]
    for a in ['ascii','hAnsi','eastAsia','cs']: rpr.rFonts.set(qn('w:'+a),FONT)
    sz=OxmlElement('w:szCs');sz.set(qn('w:val'),'36' if name in ['Title','Heading 1','Heading 2'] else '32');rpr.append(sz)
    s.paragraph_format.space_after=Pt(6); s.paragraph_format.line_spacing=1.05
doc.styles['Heading 1'].paragraph_format.space_before=Pt(8)
doc.styles['Heading 2'].paragraph_format.space_before=Pt(6)

def p(t): return doc.add_paragraph(t)
def h(t): return doc.add_heading(t,level=1)
def pic(path):
    para=doc.add_paragraph();para.alignment=WD_ALIGN_PARAGRAPH.CENTER
    run=para.add_run();run.add_picture(str(path),width=Cm(17))
    props=run._r.xpath('.//wp:docPr')[0];props.set('descr',path.stem+' แผนภาพสรุประบบ')
def page(title): doc.add_page_break();h(title)
def table(headers, rows, widths):
    t=doc.add_table(rows=1,cols=len(headers));t.alignment=WD_TABLE_ALIGNMENT.CENTER;t.autofit=False
    for c,w in zip(t.columns,widths):c.width=Cm(w)
    for cell,txt in zip(t.rows[0].cells,headers):cell.text=txt
    for row in rows:
        for cell,txt in zip(t.add_row().cells,row):cell.text=txt
    for i,row in enumerate(t.rows):
        for j,c in enumerate(row.cells):
            c.width=Cm(widths[j]);c.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
            pr=c._tc.get_or_add_tcPr();shade=OxmlElement('w:shd');shade.set(qn('w:fill'),'DDECF3' if i==0 else ('F5F8FA' if i%2==0 else 'FFFFFF'));pr.append(shade)
            borders=OxmlElement('w:tcBorders')
            for side in ['top','left','bottom','right']:
                e=OxmlElement('w:'+side);e.set(qn('w:val'),'single');e.set(qn('w:sz'),'4');e.set(qn('w:color'),'D9D9D9');borders.append(e)
            pr.append(borders)
            margins=OxmlElement('w:tcMar')
            for side in ['top','left','bottom','right']:
                e=OxmlElement('w:'+side);e.set(qn('w:w'),'95');e.set(qn('w:type'),'dxa');margins.append(e)
            pr.append(margins)
            for para in c.paragraphs:
                para.paragraph_format.space_after=Pt(2)
                for r in para.runs:r.bold=i==0
        trpr=row._tr.get_or_add_trPr(); trpr.append(OxmlElement('w:cantSplit'))
    t.rows[0]._tr.get_or_add_trPr().append(OxmlElement('w:tblHeader'))

doc.add_paragraph('สรุประบบบูรณาการข้อมูลจังหวัดลำปาง',style='Title')
p('Water System  |  ฉบับอ่านง่ายพร้อมภาพประกอบ')
p('สำหรับผู้บริหาร เจ้าหน้าที่ และผู้ดูแลระบบ\nจัดทำวันที่ 22 กันยายน 2569')
h('ระบบนี้ช่วยอะไร')
p('ระบบรวบรวมข้อมูลน้ำ ฝน อ่างเก็บน้ำ คุณภาพอากาศ และเรื่องร้องเรียนมาแสดงในเว็บไซต์เดียว ช่วยให้ผู้ใช้ดูภาพรวม เปรียบเทียบข้อมูล ติดตามเหตุแจ้งเตือน และจัดทำรายงานได้สะดวกขึ้น')
pic(overview)
h('ภาพรวมที่ผู้อ่านควรรู้')
p('ระบบมีข้อมูลหลัก 4 กลุ่ม โดยน้ำและฝนแยกจัดเก็บเป็นคนละประเภท รวมเป็นข้อมูลนำเข้า 5 ประเภท ข้อมูลมาจากเว็บไซต์ต้นทางและถูกเก็บเป็นประวัติในฐานข้อมูลของระบบ')
p('ผู้บริหารใช้ดูสถานการณ์ เจ้าหน้าที่ใช้เก็บข้อมูลและติดตามงาน ส่วนผู้ดูแลระบบจัดการบัญชี อุปกรณ์รับข้อมูล และการแจ้งเตือน')
p('เอกสารนี้อธิบายภาพรวม เส้นทางข้อมูล เมนูหลัก วิธีใช้งาน และข้อควรรู้ในการดูแลระบบ โดยไม่ลงรายละเอียดโค้ดทุกส่วน')

page('1  ข้อมูลเดินทางผ่านระบบอย่างไร')
p('ระบบรับข้อมูลจาก ThaiWater ลำปางสำหรับข้อมูลสิ่งแวดล้อม และ Traffy สำหรับเรื่องร้องเรียน โดยมีทั้งตัวดึงข้อมูลบนเซิร์ฟเวอร์และส่วนขยาย Chrome ตามงานที่เลือกใช้')
pic(pipeline)
h('ฐานข้อมูลกับ Excel ทำหน้าที่ต่างกัน')
p('MySQL เป็นแหล่งจัดเก็บหลักสำหรับค้นหาและแสดงผล หลังบันทึกฐานข้อมูลสำเร็จ ระบบจะเข้าคิวเขียน Excel ซึ่งรวมงานเป็นรอบประมาณ 30 วินาที ดังนั้นสถานะฐานข้อมูลสำเร็จไม่ได้แปลว่า Excel เขียนเสร็จแล้วทันที')
p('หากการบันทึกฐานข้อมูลล้มเหลว ระบบพยายามสำรอง Excel และเก็บชุดข้อมูลที่รับมาไว้ให้เจ้าหน้าที่ลองบันทึกใหม่ หาก Excel เปิดค้างจนเขียนไม่ได้ ให้ปิดไฟล์แล้วลองงานสำรองอีกครั้ง')

page('2  เมนูหลักและสิทธิ์ผู้ใช้งาน')
table(['ส่วนใช้งาน','ใช้ทำอะไร'],[
 ('แดชบอร์ดและหน้าหลัก','ดูภาพรวม ตัวเลขสรุป กราฟ และข้อมูลเชิงพื้นที่'),
 ('ข้อมูลน้ำและภัยแล้ง','ติดตามระดับน้ำ ฝน และปริมาณน้ำในอ่างเก็บน้ำ'),
 ('PM 2.5','ดูข้อมูลคุณภาพอากาศและแนวโน้มรายสถานี'),
 ('ข้อมูลระบบร้องเรียน','ดูรายการเรื่องร้องเรียนและสถานะที่ระบบได้รับ'),
 ('ดึงข้อมูลรายงาน','เลือกช่วงเวลาและหัวข้อเพื่อจัดทำรายงานหรือส่งออกข้อมูล'),
 ('ตั้งเวลาทำงาน','กำหนดรอบเก็บข้อมูลและเปิดหรือปิดตารางเวลา'),
 ('แจ้งเตือนและติดตามงาน','ดูเหตุแจ้งเตือน ผู้รับผิดชอบ ข้อมูลขาด และงานที่ต้องลองใหม่')],[5,12])
p('เมนูหมอกควันไฟป่ายังแสดงว่าอยู่ระหว่างการพัฒนา จึงยังไม่ควรนับเป็นความสามารถที่พร้อมใช้งาน')
h('ใครทำอะไรได้บ้าง')
table(['บทบาท','ขอบเขตหลัก'],[
 ('ผู้ดูแลระบบ  admin','จัดการบัญชี อุปกรณ์ และตั้งค่าแจ้งเตือน รวมถึงงานเจ้าหน้าที่'),
 ('เจ้าหน้าที่  operator','ดูข้อมูล สั่งเก็บข้อมูล ตั้งเวลา ติดตามเหตุ และลองงานที่ล้มเหลวใหม่'),
 ('ผู้ดูข้อมูล  viewer','ดูข้อมูลโดยไม่เปลี่ยนการตั้งค่าหรือสั่งงาน'),
 ('อุปกรณ์เก็บข้อมูล  collector','ส่งข้อมูลและสถานะการเชื่อมต่อผ่านกุญแจอุปกรณ์ ไม่ใช่บัญชีผู้ใช้งานทั่วไป')],[5,12])

page('3  วิธีใช้งานประจำวันและติดตามเหตุ')
h('เริ่มใช้งานใน 5 ขั้นตอน')
for t in [
 '1. เข้าสู่ระบบด้วยบัญชีที่ได้รับ แล้วเปิดแดชบอร์ดเพื่อดูภาพรวม',
 '2. ตรวจเวลารับข้อมูลล่าสุดและสถานะการเชื่อมต่อ ก่อนใช้ตัวเลขตัดสินใจ',
 '3. เปิดหมวดที่ต้องการ เลือกช่วงเวลา และดูกราฟหรือตารางประกอบกัน',
 '4. หากมีเหตุแจ้งเตือน ให้ตรวจรายละเอียด ระบุผู้รับผิดชอบ และติดตามสถานะ',
 '5. เมื่อต้องสรุปผล ให้เลือกช่วงเวลาและหัวข้อรายงาน พร้อมตรวจความครบถ้วนของข้อมูล']:p(t)
h('วงจรติดตามเหตุแจ้งเตือน')
pic(incident)
p('ระบบตรวจเงื่อนไขแจ้งเตือนจากข้อมูลน้ำ ฝน อ่างเก็บน้ำ และ PM2.5 สามารถส่งอีเมลเมื่อเปิดใช้งานและตั้งค่าผู้รับกับ SMTP ถูกต้อง การมีเหตุในหน้าระบบจึงควรตรวจแยกจากผลส่งอีเมล')
h('ถ้าข้อมูลไม่อัปเดต')
p('ตรวจเซิร์ฟเวอร์และอินเทอร์เน็ต ตรวจการจับคู่ Extension และหน้าเว็บต้นทาง แล้วเปิดหน้าติดตามงานเพื่อตรวจข้อมูลขาดหรือรายการบันทึกที่ล้มเหลว เจ้าหน้าที่สามารถลองงานที่ค้างใหม่ได้ตามสิทธิ์')

page('4  อ่านข้อมูลให้ถูกต้องก่อนนำไปใช้')
table(['สิ่งที่เห็น','ความหมายที่ควรเข้าใจ'],[
 ('เวลาบันทึกข้อมูล','เป็นเวลาที่ระบบรับข้อมูล ไม่จำเป็นต้องตรงกับเวลาตรวจวัดจริง'),
 ('ฝนสะสม 3 วัน','เป็นฝนย้อนหลัง ไม่ใช่ฝนพยากรณ์ และไม่ควรนำไปบวกกับฝนรายวันที่ช่วงเวลาทับซ้อนกัน'),
 ('น้ำในอ่างรวมรายวัน','รวมค่าล่าสุดของแต่ละอ่างในวันนั้น ไม่บวกทุกรอบการเก็บข้อมูล'),
 ('ไม่มีข้อมูลกับค่า 0','ไม่มีข้อมูลหมายถึงยังไม่มีค่าที่ใช้ได้ ส่วน 0 หมายถึงค่าที่บันทึกได้เป็นศูนย์'),
 ('กราฟคาดการณ์','เป็นภาพจำลองจากประวัติและสมมติฐาน ยังไม่ใช่แบบจำลองที่รับรองความแม่นยำ'),
 ('ตำแหน่งบนแผนที่','บางจุดใช้ศูนย์กลางอำเภอแทนพิกัดจริง ต้องตรวจความละเอียดของพิกัดก่อนใช้งาน'),
 ('ประวัติเรื่องร้องเรียน','ประวัติการเปลี่ยนสถานะเริ่มเก็บหลังติดตั้งรุ่นที่รองรับ ไม่ใช่ประวัติทั้งหมดจากต้นทาง')],[5,12])
h('การตรวจข้อมูลขาดมีขอบเขต')
p('ระบบอ้างอิงรายชื่อสถานีจากประวัติที่เคยได้รับ สถานีที่ไม่เคยส่งข้อมูลอาจยังไม่อยู่ในรายการตรวจ และวันปัจจุบันถือว่ายังรอข้อมูล ไม่สรุปว่าขาดทั้งวัน โดยใช้วันที่ตามเขตเวลาไทย')
h('การลองใหม่ไม่ใช่การดึงข้อมูลย้อนหลังทั้งหมด')
p('งานกู้คืนช่วยส่งชุดข้อมูลที่ระบบเคยรับแต่บันทึกไม่สำเร็จอีกครั้ง ส่วนข้อมูลที่ต้นทางไม่เคยส่งเข้าระบบยังไม่มีฟังก์ชันย้อนดึงย้อนหลังทั้งหมดโดยอัตโนมัติ')

page('5  โครงสร้างและการดูแลระบบแบบย่อ')
p('เว็บไซต์ทำงานด้วย Node.js และ Express ใช้ MySQL เก็บข้อมูลหลัก มีตัวดึงข้อมูลเว็บด้วย Puppeteer และส่วนขยาย Chrome ช่วยรับข้อมูล ระบบชุดปัจจุบันออกแบบให้ทำงานเป็นเซิร์ฟเวอร์หนึ่งกระบวนการ')
table(['ส่วนของระบบ','หน้าที่'],[
 ('backend_ui','หน้าจอสำหรับผู้ใช้งานและเจ้าหน้าที่'),
 ('server.js และ backend','API การรับข้อมูล สิทธิ์ การประมวลผล และคิวงาน'),
 ('MySQL และไฟล์ Excel','ประวัติข้อมูลหลัก และสำเนาข้อมูลตามประเภท'),
 ('01System_Water','ส่วนขยาย Chrome สำหรับข้อมูลสิ่งแวดล้อม'),
 ('04ext_TraffyLP','ส่วนขยาย Chrome สำหรับเรื่องร้องเรียน'),
 ('runtime','สถานะภายใน บัญชี งานค้าง และข้อมูลรอกู้คืน')],[6,11])
h('การเตรียมใช้งานครั้งแรก')
p('ผู้ดูแลเตรียม Node.js และ MySQL ตั้งค่าการเชื่อมต่อ ติดตั้งส่วนประกอบ และรัน migration จากนั้นเริ่มเซิร์ฟเวอร์ สร้างบัญชีผู้ดูแลผ่านหน้าตั้งค่าครั้งแรก และจับคู่ Extension กับเซิร์ฟเวอร์ รายละเอียดคำสั่งอยู่ใน README.md')
h('งานดูแลที่ควรทำสม่ำเสมอ')
p('ตรวจข้อมูลล่าสุดและงานค้าง สำรองฐานข้อมูล ไฟล์ Excel และข้อมูลภายใน runtime พร้อมทดสอบกู้คืน จัดสิทธิ์บัญชีให้ตรงหน้าที่ และตรวจตัวดึงข้อมูลเมื่อเว็บไซต์ต้นทางเปลี่ยนแปลง')
p('หากเปิดใช้งานผ่านเครือข่าย ให้ผู้ดูแลกำหนด HOST และแหล่งที่อนุญาต พร้อม HTTPS และคุกกี้ที่ปลอดภัยตามคู่มือติดตั้ง การรีสตาร์ตเซิร์ฟเวอร์ทำให้ผู้ใช้ต้องเข้าสู่ระบบใหม่')
h('แหล่งอ้างอิงภายในโครงการ')
p('README.md และ docs/implementation-2026-09-07.md\nserver.js และ notification_module.js\nbackend/services/data-definitions.js และ backend/routes/operations.js\nbackend/collectors/index.js และ backend_ui/index.html')

# Footer page numbers help navigate the six-page summary.
foot=sec.footer.paragraphs[0];foot.alignment=WD_ALIGN_PARAGRAPH.RIGHT
foot.add_run('หน้า ')
field=OxmlElement('w:fldSimple');field.set(qn('w:instr'),'PAGE');foot._p.append(field)
doc.core_properties.title='สรุประบบบูรณาการข้อมูลจังหวัดลำปาง'
doc.core_properties.subject='ภาพรวมและการใช้งาน Water System'
doc.core_properties.author=''
for element in [doc.element,doc.styles.element]:
    for border in element.xpath('.//w:pBdr'):
        border.getparent().remove(border)
out=ROOT/'สรุประบบ_Water_System.docx';doc.save(out)
print(out)
