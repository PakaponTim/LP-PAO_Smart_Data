export const DATA_DEFINITIONS = Object.freeze({
  version: '2026-09-07.1',
  timezone: 'Asia/Bangkok',
  recorded_at: 'เวลาที่ระบบบันทึกข้อมูล ไม่ใช่เวลาที่สถานีตรวจวัด',
  rainfall_accum_3d_mm: 'ฝนสะสมย้อนหลัง 3 วันจาก widget ระดับอำเภอ; คอลัมน์เก่า forecast_rain_24h_mm ใช้เก็บค่านี้ใน scraper ที่ตรวจพบ ไม่ใช่พยากรณ์',
  current_rain_mm: 'ฝนที่จับคู่จากพื้นที่ของสถานี ไม่ใช่เครื่องวัดฝนที่สถานีระดับน้ำเสมอไป',
  drought_daily_volume: 'ผลรวมค่าล่าสุดต่ออ่างต่อวัน หน่วยล้านลูกบาศก์เมตร ไม่รวมหลายรอบของอ่างเดิม',
  complaints: 'นับเรื่องที่ระบบพบครั้งแรกในช่วงเวลา พร้อมสถานะล่าสุด; ประวัติสถานะเริ่มตั้งแต่ติดตั้งรุ่นนี้',
  water_projection: 'ภาพจำลองจากประวัติและสมมติฐาน ไม่ใช่พยากรณ์ที่ผ่านการตรวจสอบ',
  missing_values: 'null หมายถึงไม่มีข้อมูล; 0 หมายถึงตรวจได้ศูนย์'
});
export function bangkokDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Bangkok', year:'numeric', month:'2-digit', day:'2-digit' }).format(date);
}
export function recentDates(days, now = new Date()) {
  const today = new Date(`${bangkokDate(now)}T00:00:00+07:00`);
  return Array.from({ length:days }, (_, i) => bangkokDate(new Date(today.getTime() - (days - i - 1) * 86400000)));
}
export function dailyDamQuery(dateFilter = '', limit = 'LIMIT 7') {
  return `SELECT DATE_FORMAT(d.recorded_at, '%Y-%m-%d') AS date, SUM(d.water_volume_m_cum) AS total_val
    FROM tbl_drought_monitoring d INNER JOIN (
      SELECT MAX(id) AS id FROM tbl_drought_monitoring ${dateFilter}
      GROUP BY dam_name, DATE_FORMAT(recorded_at, '%Y-%m-%d')
    ) latest ON latest.id = d.id GROUP BY DATE_FORMAT(d.recorded_at, '%Y-%m-%d') ORDER BY date DESC ${limit}`;
}
