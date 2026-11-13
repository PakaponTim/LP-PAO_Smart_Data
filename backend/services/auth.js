import { randomBytes, randomUUID, scrypt as derive, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import path from 'node:path';
import { FileStore } from './file-store.js';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';

const scrypt = promisify(derive);
const digest = value => createHash('sha256').update(value).digest('hex');
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const publicUser = ({ id, username, role }) => ({ id, username, role });
const roles = new Set(['admin', 'operator', 'viewer']);
export const collectorPaths = new Set(['/api/append-data', '/api/append-data-db', '/api/append-drought-data', '/api/append-drought-db', '/api/append-pm25-data', '/api/append-pm25-db', '/api/append-rainfall-db', '/api/append-complaints-db', '/api/ping']);

export async function createAuth({ directory, sessionMs = 8 * 60 * 60 * 1000 }) {
  const store = new FileStore(path.join(directory, 'accounts.json'), { users: [], devices: [] });
  const sessions = new Map();
  const changes = new EventEmitter();
  const attempts = new Map();
  const bootstrapPath = path.join(directory, 'setup-token');
  let bootstrap = randomBytes(32).toString('hex');
  if (!(await store.read()).users.length) {
    await fs.mkdir(directory, { recursive: true });
    try { await fs.writeFile(bootstrapPath, bootstrap, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; bootstrap = (await fs.readFile(bootstrapPath, 'utf8')).trim(); }
  } else { await fs.rm(bootstrapPath, { force: true }); }
  const dummySalt = randomBytes(16).toString('hex');
  const dummyHash = (await scrypt('invalid-password', dummySalt, 64)).toString('hex');
  async function addUser(username, password, role = 'viewer', initial = false) {
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_.@+-]{3,128}$/.test(username) || (username.includes('@') && !/^[^@]+@[^@]+\.[^@]+$/.test(username)) || typeof password !== 'string' || password.length < 12 || password.length > 256 || !roles.has(role)) throw new Error('ระบุอีเมลหรือชื่อผู้ใช้ 3–128 ตัว และรหัสผ่านอย่างน้อย 12 ตัวอักษร');
    const salt = randomBytes(16).toString('hex');
    const hash = (await scrypt(password, salt, 64)).toString('hex');
    return store.update(data => {
      if (initial && data.users.length) throw new Error('สร้างผู้ดูแลเริ่มต้นแล้ว');
      if (data.users.some(u => u.username.toLowerCase() === username.toLowerCase())) throw new Error('ชื่อผู้ใช้นี้มีอยู่แล้ว');
      const user = { id: randomUUID(), username, salt, hash, role, active: true };
      data.users.push(user);
      return publicUser(user);
    });
  }
  async function verify(username, password) {
    if (typeof username !== 'string' || typeof password !== 'string' || password.length > 256) return null;
    const data = await store.read();
    const user = data.users.find(u => u.active && u.username.toLowerCase() === username.toLowerCase());
    const hash = (await scrypt(password, user?.salt || dummySalt, 64)).toString('hex');
    return safeEqual(hash, user?.hash || dummyHash) && user ? publicUser(user) : null;
  }
  async function identity(req) {
    const authorization = req.headers.authorization || '';
    if (authorization.startsWith('Bearer ')) {
      const hashed = digest(authorization.slice(7));
      const data = await store.read();
      const device = data.devices.find(d => !d.revoked && safeEqual(d.hash, hashed));
      if (device && data.users.some(u => u.id === device.owner && u.active && u.role === 'admin')) return { id: device.id, username: device.name, role: 'collector', device: true };
      return null;
    }
    const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('water_session_7000='))?.slice(19);
    const session = token && sessions.get(digest(token));
    if (!session || session.expires <= Date.now()) { if (token) sessions.delete(digest(token)); return null; }
    const user = (await store.read()).users.find(u => u.id === session.user.id && u.active);
    return user ? { ...publicUser(user), csrf: session.csrf } : null;
  }
  function rateLimit(req, res, next) {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const key = req.ip;
    const entry = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    if (++entry.count > 15) return res.status(429).json({ error: 'ลองเข้าสู่ระบบมากเกินไป กรุณารอ 15 นาที' });
    attempts.set(key, entry); next();
  }
  function csrf(req, res, next) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.user?.device && !safeEqual(req.headers['x-csrf-token'], req.user?.csrf)) return res.status(403).json({ error: 'CSRF token ไม่ถูกต้อง' });
    next();
  }
  async function guard(req, res, next) {
    try {
      req.user = await identity(req);
      if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
      const pathname = req.originalUrl.split('?')[0];
      if (req.user.device) {
        if (req.method !== 'POST' || !collectorPaths.has(pathname)) return res.status(403).json({ error: 'อุปกรณ์ไม่มีสิทธิ์ใช้คำสั่งนี้' });
        return next();
      }
      const adminOnly = /^\/api\/(auth\/(users|devices)|notifications\/(config|recipients|smtp|toggle|test|check-now))/.test(pathname);
      if (adminOnly && req.user.role !== 'admin') return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบ' });
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && pathname !== '/api/ping' && req.user.role === 'viewer' && pathname !== '/api/auth/logout') return res.status(403).json({ error: 'บัญชีนี้อ่านข้อมูลได้เท่านั้น' });
      csrf(req, res, next);
    } catch (error) { next(error); }
  }
  function install(app) {
    app.get('/api/auth/bootstrap-status', async (req, res) => res.json({ required: !(await store.read()).users.length }));
    app.post('/api/auth/bootstrap', rateLimit, async (req, res) => {
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || !safeEqual(req.headers['x-bootstrap-token'], bootstrap)) return res.status(403).json({ error: 'ใช้ลิงก์ตั้งค่าจากเครื่องเซิร์ฟเวอร์' });
      try { const user = await addUser(req.body.username, req.body.password, 'admin', true); await fs.rm(bootstrapPath, { force: true }); res.status(201).json({ user }); }
      catch (error) { res.status(400).json({ error: error.message }); }
    });
    app.post('/api/auth/login', rateLimit, async (req, res) => {
      const user = await verify(req.body.username, req.body.password);
      if (!user) return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
      const token = randomBytes(32).toString('hex');
      for (const [key, value] of sessions) if (value.expires <= Date.now()) sessions.delete(key);
      const old = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('water_session_7000='))?.slice(19);
      if (old) sessions.delete(digest(old));
      const csrfToken = randomBytes(24).toString('hex');
      sessions.set(digest(token), { user, csrf: csrfToken, expires: Date.now() + sessionMs });
      res.cookie('water_session_7000', token, { httpOnly: true, sameSite: 'strict', secure: req.secure || process.env.COOKIE_SECURE === 'true', maxAge: sessionMs, path: '/' });
      res.set('Cache-Control', 'no-store').json({ user, csrfToken });
    });
    // Pair only from the extension's options page; credentials are never stored there.
    app.post('/api/auth/pair-device', rateLimit, async (req, res) => {
      const user = await verify(req.body.username, req.body.password);
      if (user?.role !== 'admin') return res.status(401).json({ error: 'ต้องใช้บัญชีผู้ดูแลระบบเพื่อเชื่อมต่อ Extension' });
      const token = randomBytes(32).toString('hex');
      const name = String(req.body.name || 'Collector').slice(0, 80);
      const id = randomUUID();
      await store.update(data => data.devices.push({ id, name, hash: digest(token), owner: user.id, createdAt: new Date().toISOString(), revoked: false }));
      res.set('Cache-Control', 'no-store').json({ token, id });
    });
    app.use('/api', guard);
    app.get('/api/auth/me', (req, res) => res.set('Cache-Control', 'no-store').json({ user: publicUser(req.user), csrfToken: req.user.csrf }));
    app.post('/api/auth/logout', (req, res) => {
      const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('water_session_7000='))?.slice(19);
      if (token) sessions.delete(digest(token));
      changes.emit('changed');
      res.clearCookie('water_session_7000', { path: '/' }).json({ success: true });
    });
    app.get('/api/auth/users', async (req, res) => res.json({ users: (await store.read()).users.map(u => ({ ...publicUser(u), active: u.active })) }));
    app.post('/api/auth/users', async (req, res) => {
      try { res.status(201).json({ user: await addUser(req.body.username, req.body.password, req.body.role) }); }
      catch (error) { res.status(400).json({ error: error.message }); }
    });
    app.get('/api/auth/devices', async (req, res) => res.json({ devices: (await store.read()).devices.map(({ hash, ...device }) => device) }));
    app.delete('/api/auth/devices/:id', async (req, res) => {
      await store.update(data => { const device = data.devices.find(d => d.id === req.params.id); if (device) device.revoked = true; });
      changes.emit('changed');
      res.json({ success: true });
    });
  }
  return { install, identity, addUser, verify, store, bootstrap, onChange: callback => changes.on('changed', callback), needsSetup: async () => !(await store.read()).users.length };
}
