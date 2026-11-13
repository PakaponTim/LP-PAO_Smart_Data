export function createMetrics() {
  const entries = new Map();
  function middleware(req,res,next) {
    const start = performance.now();
    res.once('finish',() => {
      if (!req.path.startsWith('/api/')) return;
      const key = `${req.method} ${req.route?.path || req.path}`;
      if (!entries.has(key) && entries.size >= 200) return;
      const entry = entries.get(key) || {count:0,errors:0,totalMs:0,maxMs:0,samples:[]};
      const elapsed = performance.now()-start;
      entry.count++; entry.errors += res.statusCode >= 400 ? 1 : 0; entry.totalMs += elapsed; entry.maxMs = Math.max(entry.maxMs,elapsed);
      entry.samples.push(elapsed); if (entry.samples.length > 200) entry.samples.shift(); entries.set(key,entry);
    });
    next();
  }
  function snapshot() { return [...entries].map(([route,e]) => ({route,count:e.count,errors:e.errors,avgMs:Math.round(e.totalMs/e.count),p95Ms:Math.round([...e.samples].sort((a,b)=>a-b)[Math.ceil(e.samples.length*.95)-1]),maxMs:Math.round(e.maxMs)})); }
  return { middleware,snapshot };
}
