export function installIngestionRoutes(app, ingestion, { onSaved = () => {} } = {}) {
  const routes = { '/api/append-data':'water', '/api/append-data-db':'water', '/api/append-drought-data':'drought', '/api/append-drought-db':'drought', '/api/append-pm25-data':'pm25', '/api/append-pm25-db':'pm25', '/api/append-rainfall-db':'rainfall', '/api/append-complaints-db':'complaints' };
  for (const [route, kind] of Object.entries(routes)) app.post(route, async (req, res) => {
    try {
      let rows = req.body;
      if (Array.isArray(rows) && Array.isArray(rows[0])) {
        const first = rows[0];
        if ((kind === 'water' && first[0] === 'ชื่อสถานี') || (kind === 'drought' && (first[0] === 'วันที่เก็บข้อมูล' || first[3] === 'ชื่ออ่าง')) || (kind === 'pm25' && (first[0] === 'วันที่เก็บข้อมูล' || first[2] === 'ชื่อสถานี'))) rows = rows.slice(1);
      }
      const key = req.headers['x-ingest-key'];
      const result = await ingestion.save(kind, rows, key);
      if (result.success) onSaved(kind, result, req.user);
      res.status(result.success ? 200 : 503).json({ ...result, message: result.status === 'pending_backup' ? 'ฐานข้อมูลสำเร็จ รอเขียน Excel ตามรอบ' : result.status === 'saved' ? 'บันทึกข้อมูลแล้ว' : result.status === 'partial' ? 'ฐานข้อมูลสำเร็จ แต่ Excel ยังไม่สำเร็จ' : result.status === 'fallback' ? 'ฐานข้อมูลไม่สำเร็จ เก็บสำรองใน Excel แล้ว' : 'บันทึกข้อมูลไม่สำเร็จ' });
    } catch (error) { res.status(error.status || 500).json({ success: false, error: error.status ? error.message : 'บันทึกข้อมูลไม่สำเร็จ' }); }
  });
}
