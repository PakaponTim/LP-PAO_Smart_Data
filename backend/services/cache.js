export function createAsyncCache(ttlMs = 30000, maxEntries = 100) {
  const entries = new Map(); let generation = 0;
  const stats = { hits:0, misses:0, shared:0 };
  async function get(key, loader) {
    const entry = entries.get(key);
    if (entry?.promise) { stats.shared++; return entry.promise; }
    if (entry && entry.expires > Date.now()) { stats.hits++; return entry.value; }
    stats.misses++;
    const version = generation;
    const current = {};
    current.promise = Promise.resolve().then(loader).then(value => {
      if (generation === version && entries.get(key) === current) { current.value = value; current.expires = Date.now() + ttlMs; delete current.promise; }
      return value;
    }, error => { if (entries.get(key) === current) entries.delete(key); throw error; });
    if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
    entries.set(key,current); return current.promise;
  }
  return { get, stats, clear() { generation++; entries.clear(); } };
}

export function cacheJson(ttlMs = 30000) {
  const cache = createAsyncCache(ttlMs);
  const middleware = async (req, res, next) => {
    const key = req.originalUrl;
    try {
      const body = await cache.get(key, () => new Promise((resolve,reject) => {
        const original = res.json.bind(res);
        res.json = value => {
          res.json = original;
          if (res.statusCode >= 400) { reject(Object.assign(new Error('uncacheable'), { body:value,status:res.statusCode })); return res; }
          resolve(value); return res;
        };
        res.once('close', () => { if (!res.writableEnded) reject(new Error('request closed')); });
        next();
      }));
      if (!res.writableEnded) res.json(body);
    } catch (error) {
      if (!res.writableEnded && !res.destroyed) res.status(error.status || 500).json(error.body || { error:'โหลดข้อมูลไม่สำเร็จ' });
    }
  };
  return { middleware, ...cache };
}
