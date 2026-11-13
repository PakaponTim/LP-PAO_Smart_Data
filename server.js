import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import puppeteer from 'puppeteer';
import { createCollectors } from './backend/collectors/index.js';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import { createAuth } from './backend/services/auth.js';
import { createExcelRepository } from './backend/repositories/excel.js';
import { createExcelOutbox } from './backend/services/excel-outbox.js';
import { createIngestionRepository } from './backend/repositories/ingestion.js';
import { createIngestionService } from './backend/services/ingestion.js';
import { installIngestionRoutes } from './backend/routes/ingestion.js';
import { DATA_DEFINITIONS, dailyDamQuery, recentDates } from './backend/services/data-definitions.js';
import { createAsyncCache, cacheJson } from './backend/services/cache.js';
import { FileStore } from './backend/services/file-store.js';
import { createMetrics } from './backend/services/metrics.js';
import { installOperations } from './backend/routes/operations.js';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import dns from 'dns';
import { promisify } from 'util';
import { checkAndNotify, sendTestEmail, THRESHOLDS } from './notification_module.js';
import { generateExecutiveReport } from './report_generator_service.js';

const dnsLookup = promisify(dns.lookup);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.WATER_DATA_DIR || __dirname;

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || 'root',
  database: process.env.DB_NAME || 'water_system2',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const app = express();
const server = http.createServer(app);
const metrics = createMetrics();
app.use(metrics.middleware);
const PORT = process.env.PORT || 7000;
const allowedOrigins = new Set([
  `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`,
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'https://lampang.thaiwater.net', 'https://citydata.traffy.in.th',
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean)
]);
const originAllowed = origin => !origin || allowedOrigins.has(origin) || /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
const io = new Server(server, { cors: { origin: (origin, callback) => callback(null, originAllowed(origin)), credentials: true }, allowRequest: (req, callback) => callback(null, originAllowed(req.headers.origin)) });
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'same-origin');
  if (req.path.startsWith('/api/') || req.path.endsWith('.html') || req.path === '/') res.set('Cache-Control', 'no-store');
  if (!originAllowed(req.headers.origin)) return res.status(403).json({ error: 'Origin not allowed' });
  next();
});
app.use(cors({ origin: (origin, callback) => callback(null, originAllowed(origin)), credentials: true }));
app.use(express.json({ limit: '10mb' }));
const auth = await createAuth({ directory: path.join(DATA_DIR, 'runtime', 'security') });
auth.install(app);
app.use('/api', (req,res,next) => {
  const {startDate,endDate} = req.query;
  if (startDate || endDate) {
    const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;
    if (!valid(startDate) || !valid(endDate) || startDate > endDate || (Date.parse(endDate)-Date.parse(startDate))/86400000 > 3660) return res.status(400).json({error:'ช่วงวันที่ไม่ถูกต้อง (ไม่เกิน 10 ปี)'});
  }
  next();
});
io.use(async (socket, next) => {
  try {
    const headers = { ...socket.request.headers };
    if (socket.handshake.auth?.token) headers.authorization = `Bearer ${socket.handshake.auth.token}`;
    const user = await auth.identity({ headers });
    if (!user) return next(new Error('Unauthorized'));
    socket.data.user = user;
    socket.data.authHeaders = headers;
    next();
  } catch { next(new Error('Unauthorized')); }
});
const publicAssets = new Set(['/login.html', '/setup.html', '/setup.js', '/logo_pao.png']);
const pages = new Set(['/', '/index.html', '/login.html', '/setup.html', '/control.html', '/notification.html', '/accounts.html', '/operations.html']);
const assets = new Set(['/setup.js', '/auth-client.js', '/accounts.js', '/operations.js', '/logo_pao.png', '/favicon.ico', '/drought_standard.png', '/pm25_standard.png', '/complaints_standard.png']);
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  if (!pages.has(req.path) && !assets.has(req.path) && !/^\/(js|css)\/[a-z0-9-]+\.(js|css)$/.test(req.path)) return res.sendStatus(404);
  if (!publicAssets.has(req.path) && !/^\/(js|css)\/login-\d+\.(js|css)$/.test(req.path)) {
    const user = await auth.identity(req);
    if (!user || user.device) return res.redirect('/login.html');
    if (req.path === '/accounts.html' && user.role !== 'admin') return res.sendStatus(403);
  }
  next();
});
app.use(express.static(path.join(__dirname, 'backend_ui')));


const EXCEL_FILE_PATH = path.join(DATA_DIR, 'Water_Database_Master.xlsx');
const DROUGHT_EXCEL_FILE_PATH = path.join(DATA_DIR, 'Drought_Dam_Data.xlsx');
const PM25_EXCEL_FILE_PATH = path.join(DATA_DIR, 'PM25_Air_Quality_Data.xlsx');
const RAINFALL_EXCEL_FILE_PATH = path.join(DATA_DIR, 'Rainfall_Data.xlsx');
const COMPLAINTS_EXCEL_FILE_PATH = path.join(DATA_DIR, 'Complaints_Data.xlsx');

// State
let scheduleCheckerInterval = null;
let scheduledTasks = []; // Array of HH:mm strings
let isScheduleActive = { water: true, drought: true, pm25: true, complaints: true };
let extensionConnected = false;
const activeExtensionSockets = new Set();
const activeTraffySockets = new Set();
let lastExtensionActivity = 0;
let lastPingTimestamp = 0;
const EXTENSION_OFFLINE_GRACE_MS = 90000;
let fetchCount = 0;
let lastTriggeredMinute = null;
const logs = [];

// Notification config
let notificationConfig = {
  enabled: true,
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  },
  alertActive: { water: true, rainfall: true, drought: true, pm25: true, complaints: true },
  cooldownMinutes: 120
};
const FETCH_LOG_PATH = path.join(DATA_DIR, 'fetch_history.log');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const configStore = new FileStore(CONFIG_PATH, {});

// Project-specific state tracking for automated scrapers
global.lastWLDataReceived = null;
global.lastDroughtDataReceived = null;
global.lastPM25DataReceived = null;
global.lastComplaintsDataReceived = null;

// Load config
try {
  if (fs.existsSync(CONFIG_PATH)) {
    const configData = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (configData.scheduledTasks) scheduledTasks = configData.scheduledTasks;
    if (configData.isScheduleActive !== undefined) {
      if (typeof configData.isScheduleActive === 'boolean') {
        isScheduleActive = { water: configData.isScheduleActive, drought: configData.isScheduleActive, pm25: configData.isScheduleActive, complaints: configData.isScheduleActive };
      } else {
        isScheduleActive = configData.isScheduleActive;
      }
    }
    if (configData.notifications) {
      notificationConfig = {
        ...notificationConfig,
        ...configData.notifications,
        smtp: {
          ...notificationConfig.smtp,
          ...(configData.notifications.smtp || {})
        }
      };
      if (!notificationConfig.smtp.pass && process.env.SMTP_PASS) {
        notificationConfig.smtp.pass = process.env.SMTP_PASS;
      }
      if (!notificationConfig.smtp.user && process.env.SMTP_USER) {
        notificationConfig.smtp.user = process.env.SMTP_USER;
      }
    }
  }
} catch (e) {
  console.error('Error loading config:', e);
}

// Save config (Async)
function saveConfig() {
  const configToSave = JSON.parse(JSON.stringify({ scheduledTasks, isScheduleActive, notifications: notificationConfig }));
  if (configToSave.notifications?.smtp) {
    configToSave.notifications.smtp.pass = ''; // Keep plaintext password out of config.json
  }
  configStore.update(data => Object.assign(data, configToSave))
    .catch(e => console.error('Error saving config:', e));
}

// ============================================================
// 🛡️ RISK MANAGEMENT SYSTEM
// ============================================================

// --- Internet Pre-flight Check Utility ---
async function checkInternetConnection() {
  try {
    await dnsLookup('lampang.thaiwater.net');
    return true;
  } catch (err) {
    try {
      await dnsLookup('google.com');
      return true;
    } catch (err2) {
      return false;
    }
  }
}

// --- Non-blocking Browser Close Utility ---
async function safeCloseBrowser(browserInstance) {
  if (!browserInstance) return;
  try {
    await Promise.race([
      browserInstance.close(),
      new Promise(resolve => setTimeout(resolve, 5000))
    ]);
  } catch (e) {
    console.error('Error in safeCloseBrowser:', e);
  }
}

// --- Retry Utility ---
async function withRetry(fn, options = {}) {
  const { maxRetries = 3, backoffMs = [10000, 30000, 60000], label = 'Task', infinite = false } = options;
  let lastError;
  let attempt = 1;
  while (infinite || attempt <= maxRetries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (error.retryable === false) throw error;
      if (infinite || attempt < maxRetries) {
        const waitTime = backoffMs[attempt - 1] || backoffMs[backoffMs.length - 1];
        addLog('Retry', `🔄 ${label} ล้มเหลว (ครั้งที่ ${attempt}${infinite ? '' : '/' + maxRetries}): ${error.message}`);
        addLog('Retry', `⏳ รอ ${waitTime / 1000} วินาที ก่อน retry ครั้งถัดไป...`);
        await new Promise(r => setTimeout(r, waitTime));
        attempt++;
      } else {
        addLog('Retry', `❌ ${label} ล้มเหลวทั้งหมด (${maxRetries} ครั้ง): ${error.message}`);
        break;
      }
    }
  }
  throw lastError;
}

// --- Extension Socket Tracking ---
let extensionSocketId = null;

// เขียน Log ลงไฟล์ถาวร (Async)
function fetchLogToFile(message) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('th-TH', { hour12: false });
  const logLine = `[${dateStr} ${timeStr}] ${message}\n`;
  fs.promises.appendFile(FETCH_LOG_PATH, logLine, 'utf8').catch(err => console.error('Error writing log:', err));
}

function formatISODatetime(date) {
  if (!date) return 'ยังไม่เคยบันทึก';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function addLog(source, message) {
  const datetimeStr = formatISODatetime(new Date());
  const logStr = `[${datetimeStr}] [${source}] ${message}`;
  console.log(logStr);
  logs.unshift(logStr);
  if (logs.length > 50) logs.pop(); // Keep last 50 logs
  io.to('dashboard').emit('server_log', logStr);
}

// ============================================================
// 📊 DASHBOARD HISTORY & SYSTEM STORAGE STATUS STATE
// ============================================================
const HISTORY_PATH = path.join(DATA_DIR, 'task_history.json');
const historyStore = new FileStore(HISTORY_PATH, {});
let completedTasks = [];
let projectStats = {
  waterLevel: {
    lastFetchSuccess: null,
    lastFetchStatus: 'Pending',
    lastFetchMessage: 'ระบบพร้อมทำงาน',
    lastFetchMode: 'N/A',
    rowCountSaved: 0
  },
  drought: {
    lastFetchSuccess: null,
    lastFetchStatus: 'Pending',
    lastFetchMessage: 'ระบบพร้อมทำงาน',
    lastFetchMode: 'N/A',
    rowCountSaved: 0
  },
  pm25: {
    lastFetchSuccess: null,
    lastFetchStatus: 'Pending',
    lastFetchMessage: 'ระบบพร้อมทำงาน',
    lastFetchMode: 'N/A',
    rowCountSaved: 0
  },
  complaints: {
    lastFetchSuccess: null,
    lastFetchStatus: 'Pending',
    lastFetchMessage: 'ระบบพร้อมทำงาน',
    lastFetchMode: 'N/A',
    rowCountSaved: 0
  }
};

// Load task history on start
try {
  if (fs.existsSync(HISTORY_PATH)) {
    const histData = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    if (histData.completedTasks) completedTasks = histData.completedTasks;
    if (histData.projectStats) projectStats = histData.projectStats;
  }
} catch (e) {
  console.error('Error loading task history:', e);
}

// Save task history to JSON file (Async)
function persistHistory() {
  historyStore.update(data => Object.assign(data, structuredClone({ completedTasks, projectStats })))
    .catch(e => console.error('Error saving task history:', e));
}

// Function to log task completion (and update projectStats)
function logTaskRun(projectName, mode, status, count, message) {
  const timeStr = formatISODatetime(new Date());
  let key = '';
  
  if (projectName.includes("ระดับน้ำ") || projectName.toLowerCase().includes("water")) {
    key = 'waterLevel';
  } else if (projectName.includes("ภัยแล้ง") || projectName.toLowerCase().includes("drought")) {
    key = 'drought';
  } else if (projectName.includes("PM 2.5") || projectName.toLowerCase().includes("pm25") || projectName.toLowerCase().includes("pm 2.5")) {
    key = 'pm25';
  } else if (projectName.includes("ร้องเรียน") || projectName.toLowerCase().includes("complaint")) {
    key = 'complaints';
  }
  
  if (key) {
    if (!projectStats[key]) {
      projectStats[key] = {
        lastFetchSuccess: null,
        lastFetchStatus: 'Pending',
        lastFetchMessage: 'ระบบพร้อมทำงาน',
        lastFetchMode: 'N/A',
        rowCountSaved: 0
      };
    }
    projectStats[key].lastFetchStatus = status === 'success' ? 'Success' : 'Failed';
    projectStats[key].lastFetchMessage = message;
    projectStats[key].lastFetchMode = mode === 'db' ? 'Database' : 'Excel';
    if (status === 'success') {
      projectStats[key].lastFetchSuccess = timeStr;
      projectStats[key].rowCountSaved += count;
    }
  }
  
  const newTask = {
    id: 'T-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    projectName: projectName,
    taskType: `เก็บข้อมูลลง ${mode === 'db' ? 'Database' : 'Excel'}`,
    status: status, // 'success' | 'failed'
    timestamp: timeStr,
    count: count,
    details: message
  };
  
  completedTasks.unshift(newTask);
  if (completedTasks.length > 50) completedTasks.pop(); // Keep last 50 tasks
  
  persistHistory();
}

// Function to check actual MySQL tables rows and validate Excel files on disk
const storageCache = createAsyncCache(60000);
const dashboardCache = cacheJson(30000);
const mapCache = cacheJson(30000);
const riskCache = cacheJson(30000);
app.get('/api/dashboard-summary', dashboardCache.middleware);
app.get('/api/gis/map-data', mapCache.middleware);
app.get('/api/analytics/risk-index', riskCache.middleware);
app.get('/api/data-definitions', (req,res) => res.json(DATA_DEFINITIONS));
async function getSystemStorageStats() { return storageCache.get('storage', collectSystemStorageStats); }
async function collectSystemStorageStats() {
  const stats = {
    waterLevel: { dbRows: 0, excelExists: false, excelSize: '0 KB', excelMtime: 'N/A', dbMtime: 'N/A' },
    drought: { dbRows: 0, excelExists: false, excelSize: '0 KB', excelMtime: 'N/A', dbMtime: 'N/A' },
    pm25: { dbRows: 0, excelExists: false, excelSize: '0 KB', excelMtime: 'N/A', dbMtime: 'N/A' },
    complaints: { dbRows: 0, excelExists: false, excelSize: '0 KB', excelMtime: 'N/A', dbMtime: 'N/A' }
  };
  
  let connection;
  try {
    connection = await pool.getConnection();
    
    // Check Water Level DB Rows & Last Update
    try {
      const [rows] = await connection.execute("SELECT COUNT(*) as count FROM tbl_water_disaster_monitoring");
      stats.waterLevel.dbRows = rows[0]?.count || 0;
      
      const [lastRows] = await connection.execute("SELECT MAX(recorded_at) as last_update FROM tbl_water_disaster_monitoring");
      stats.waterLevel.dbMtime = lastRows[0]?.last_update ? formatISODatetime(new Date(lastRows[0].last_update)) : 'ยังไม่เคยบันทึก';
    } catch (e) {
      stats.waterLevel.dbRows = 'Error (ตารางขัดข้อง)';
      stats.waterLevel.dbMtime = 'N/A';
    }
    
    // Check Drought DB Rows & Last Update
    try {
      const [rows] = await connection.execute("SELECT COUNT(*) as count FROM tbl_drought_monitoring");
      stats.drought.dbRows = rows[0]?.count || 0;
      
      const [lastRows] = await connection.execute("SELECT MAX(recorded_at) as last_update FROM tbl_drought_monitoring");
      stats.drought.dbMtime = lastRows[0]?.last_update ? formatISODatetime(new Date(lastRows[0].last_update)) : 'ยังไม่เคยบันทึก';
    } catch (e) {
      stats.drought.dbRows = 'Error (ตารางขัดข้อง)';
      stats.drought.dbMtime = 'N/A';
    }
    
    // Check PM 2.5 DB Rows & Last Update
    try {
      const [rows] = await connection.execute("SELECT COUNT(*) as count FROM tbl_pm25_monitoring");
      stats.pm25.dbRows = rows[0]?.count || 0;
      
      const [lastRows] = await connection.execute("SELECT MAX(recorded_at) as last_update FROM tbl_pm25_monitoring");
      stats.pm25.dbMtime = lastRows[0]?.last_update ? formatISODatetime(new Date(lastRows[0].last_update)) : 'ยังไม่เคยบันทึก';
    } catch (e) {
      stats.pm25.dbRows = 'Error (ตารางขัดข้อง)';
      stats.pm25.dbMtime = 'N/A';
    }

    // Check Complaints DB Rows & Last Update
    try {
      const [rows] = await connection.execute("SELECT COUNT(*) as count FROM tbl_complaints_monitoring WHERE (is_in_scope = 1 OR is_in_scope IS NULL)");
      stats.complaints.dbRows = rows[0]?.count || 0;
      
      const [lastRows] = await connection.execute("SELECT MAX(recorded_at) as last_update FROM tbl_complaints_monitoring WHERE (is_in_scope = 1 OR is_in_scope IS NULL)");
      stats.complaints.dbMtime = lastRows[0]?.last_update ? formatISODatetime(new Date(lastRows[0].last_update)) : 'ยังไม่เคยบันทึก';
    } catch (e) {
      stats.complaints.dbRows = 'Error (ตารางขัดข้อง)';
      stats.complaints.dbMtime = 'N/A';
    }
    
  } catch (dbErr) {
    stats.waterLevel.dbRows = 'เชื่อมต่อฐานข้อมูลล้มเหลว';
    stats.drought.dbRows = 'เชื่อมต่อฐานข้อมูลล้มเหลว';
    stats.pm25.dbRows = 'เชื่อมต่อฐานข้อมูลล้มเหลว';
    stats.complaints.dbRows = 'เชื่อมต่อฐานข้อมูลล้มเหลว';
    stats.waterLevel.dbMtime = 'เชื่อมต่อฐานข้อมูลล้มเหลว';
    stats.drought.dbMtime = 'เชื่อมต่อฐานข้อมูลล้มเหลว';
    stats.pm25.dbMtime = 'เชื่อมต่อฐานข้อมูลล้มเหลว';
    stats.complaints.dbMtime = 'เชื่อมต่อฐานข้อมูลล้มเหลว';
  } finally {
    if (connection) connection.release();
  }
  
  // Verify Excel files
  const checkExcel = (filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        const sizeKB = (stat.size / 1024).toFixed(2) + ' KB';
        const mtimeStr = formatISODatetime(stat.mtime);
        return { exists: true, size: sizeKB, mtime: mtimeStr };
      }
    } catch (e) {
      console.error('Error getting excel file stats:', e);
    }
    return { exists: false, size: '0 KB', mtime: 'N/A' };
  };
  
  const wlExcel = checkExcel(EXCEL_FILE_PATH);
  stats.waterLevel.excelExists = wlExcel.exists;
  stats.waterLevel.excelSize = wlExcel.size;
  stats.waterLevel.excelMtime = wlExcel.mtime;
  
  const drExcel = checkExcel(DROUGHT_EXCEL_FILE_PATH);
  stats.drought.excelExists = drExcel.exists;
  stats.drought.excelSize = drExcel.size;
  stats.drought.excelMtime = drExcel.mtime;
  
  const pmExcel = checkExcel(PM25_EXCEL_FILE_PATH);
  stats.pm25.excelExists = pmExcel.exists;
  stats.pm25.excelSize = pmExcel.size;
  stats.pm25.excelMtime = pmExcel.mtime;
  
  const cpExcel = checkExcel(COMPLAINTS_EXCEL_FILE_PATH);
  stats.complaints.excelExists = cpExcel.exists;
  stats.complaints.excelSize = cpExcel.size;
  stats.complaints.excelMtime = cpExcel.mtime;
  
  return stats;
}


// Socket.io for Extension & Dashboard communication
async function expireSockets() {
  for (const socket of io.sockets.sockets.values()) {
    try { if (!await auth.identity({ headers: socket.data.authHeaders })) socket.disconnect(true); }
    catch { socket.disconnect(true); }
  }
}
auth.onChange(() => expireSockets().catch(console.error));
const socketExpiryTimer = setInterval(() => expireSockets().catch(console.error), 30000);
socketExpiryTimer.unref();
io.on('connection', (socket) => {
  socket.join(socket.data.user.device ? 'collectors' : 'dashboard');
  socket.use(async ([event], next) => {
    try {
      const current = await auth.identity({ headers: socket.data.authHeaders });
      if (!current) { socket.disconnect(true); return next(new Error('Unauthorized')); }
      if (!current.device || !['identify', 'heartbeat', 'client_log', 'fetch_complete'].includes(event)) return next(new Error('Forbidden'));
      next();
    } catch { next(new Error('Unauthorized')); }
  });
  // Determine if it's the extension or the dashboard by origin/headers if needed,
  // but for simplicity, we just mark extension as connected if it identifies itself.
  
  socket.on('identify', (identity) => {
    if (identity === 'extension' || identity?.role === 'extension') {
      activeExtensionSockets.add(socket.id);
      if (identity?.url?.startsWith('https://citydata.traffy.in.th/')) {
        activeTraffySockets.add(socket.id);
        socket.data.traffyRequestIds = identity.complaintsRequestIds === true;
        socket.join('traffy-collectors');
      }
      lastExtensionActivity = Date.now();
      if (!extensionConnected) {
        addLog('Node.js', '✅ Chrome Extension เชื่อมต่อกับระบบแล้ว');
      }
      extensionConnected = true;
      extensionSocketId = socket.id;
    }
  });

  socket.on('heartbeat', (data) => {
    activeExtensionSockets.add(socket.id);
    if (data?.url?.startsWith('https://citydata.traffy.in.th/')) {
      activeTraffySockets.add(socket.id);
      socket.join('traffy-collectors');
    }
    lastExtensionActivity = Date.now();
    extensionConnected = true;
  });

  socket.on('client_log', (data) => {
    if (!data || typeof data.message !== 'string' || data.message.length > 2000) return;
    lastExtensionActivity = Date.now();
    addLog(data.source || 'Extension', data.message);
  });

  // รับสถานะเมื่อ Extension เก็บข้อมูลเสร็จ
  socket.on('fetch_complete', (data) => {
    if (!data || typeof data !== 'object') return;
    fetchCount++;
    lastExtensionActivity = Date.now();
    extensionConnected = true;
    const modeLabel = data.mode === 'db' ? 'Database' : 'Excel';
    const statusLabel = data.status === 'success' ? '✅ สำเร็จ' : '❌ ล้มเหลว';
    
    const logMsg = `ครั้งที่ #${fetchCount} | ${statusLabel} | Mode: ${modeLabel} | จำนวน: ${data.count} รายการ`;
    addLog('System', logMsg);
    fetchLogToFile(logMsg);
    
    // Completion is established by committed ingestion, never a client claim.
    if (data.error) {
      fetchLogToFile(`   └── Error: ${data.error}`);
      if (data.project === 'complaints' && data.requestId) {
        notifyComplaintsResult({ requestId: data.requestId, success: false, error: data.error });
      }
    }
  });

  socket.on('disconnect', () => {
    activeExtensionSockets.delete(socket.id);
    activeTraffySockets.delete(socket.id);
  });
});

// Start auto-fetch process
// Safe Excel Write Queue Mutex (Prevent concurrent file write collisions and EBUSY locks)
const excelRepository = createExcelRepository(DATA_DIR);
const excelWriteQueues = excelRepository.pending;
const excelOutbox = createExcelOutbox(path.join(DATA_DIR, 'runtime'), excelRepository, { intervalMs: process.env.WATER_DISABLE_AUTOMATION === '1' ? 0 : 30000 });

// Write to Excel using exceljs
async function appendToExcel(rows, id = crypto.randomUUID()) {
  return excelRepository.writeJobs('water', [{ id, rows, createdAt: new Date().toISOString() }]);
}

// Write Drought Data to Excel using exceljs
async function appendDroughtToExcel(rows, id = crypto.randomUUID()) {
  return excelRepository.writeJobs('drought', [{ id, rows, createdAt: new Date().toISOString() }]);
}

// Write PM 2.5 Data to Excel using exceljs
async function appendPM25ToExcel(rows, id = crypto.randomUUID()) {
  return excelRepository.writeJobs('pm25', [{ id, rows, createdAt: new Date().toISOString() }]);
}

// Insert into MySQL Database (with Retry + Excel Fallback)




// Append Complaints data to Excel (Backup)
async function appendComplaintsToExcel(rows, id = crypto.randomUUID()) {
  return excelRepository.writeJobs('complaints', [{ id, rows, createdAt: new Date().toISOString() }]);
}

// Append Rainfall data to Excel (Backup)
async function appendRainfallToExcel(rows, id = crypto.randomUUID()) {
  return excelRepository.writeJobs('rainfall', [{ id, rows, createdAt: new Date().toISOString() }]);
}

// ============================================================
// 🛡️ DUAL-WRITE DATA LOSS PREVENTION SYSTEM
// ============================================================
// ทุกครั้งที่ดึงข้อมูล จะบันทึกลงทั้ง Database (Primary) + Excel (Backup)
// เพื่อป้องกันข้อมูลหายไปในกรณี DB crash หรือ Excel ถูกล็อค

async function dualWriteWaterLevel(rows) {
  const result = await ingestion.save('water', rows);
  if (!result.success) throw Object.assign(new Error(result.error || 'Database save failed'), { result });
  return result;
}

async function dualWriteRainfall(rows) {
  const result = await ingestion.save('rainfall', rows);
  if (!result.success) throw Object.assign(new Error(result.error || 'Database save failed'), { result });
  return result;
}

async function dualWriteDrought(rows) {
  const result = await ingestion.save('drought', rows);
  if (!result.success) throw Object.assign(new Error(result.error || 'Database save failed'), { result });
  return result;
}

async function dualWritePM25(rows) {
  const result = await ingestion.save('pm25', rows);
  if (!result.success) throw Object.assign(new Error(result.error || 'Database save failed'), { result });
  return result;
}

async function dualWriteComplaints(rows) {
  const result = await ingestion.save('complaints', rows);
  if (!result.success) throw Object.assign(new Error(result.error || 'Database save failed'), { result });
  return result;
}

// Insert Drought/Dam data into MySQL Database (with Retry + Excel Fallback)


// Insert PM 2.5 data into MySQL Database (with Retry + Excel Fallback)


// Fetch detail timeline from Traffy public API with custom headers and 250ms delay
const { triggerDataFetch, triggerRainfallFetch, triggerDroughtDataFetch, triggerPM25DataFetch, triggerComplaintsDataFetch, notifyComplaintsResult, fetchTicketTimeline } = createCollectors({
  io, isExtensionConnected: () => extensionConnected, isTraffyExtensionConnected: () => activeTraffySockets.size > 0, addLog, fetchLogToFile, logTaskRun,
  sendComplaintsRequest(payload) {
    const socket = [...activeTraffySockets].map(id => io.sockets.sockets.get(id)).find(socket => socket?.connected);
    if (!socket) throw new Error('Traffy Extension ขาดการเชื่อมต่อก่อนรับคำสั่ง');
    socket.emit('FETCH_COMPLAINTS_DB', payload);
    return { legacyDeviceId: socket.data.traffyRequestIds ? undefined : socket.data.user.id };
  },
  withRetry, safeCloseBrowser, checkInternetConnection,
  dualWriteWaterLevel, dualWriteRainfall, dualWriteDrought, dualWritePM25, dualWriteComplaints
});

const ingestionRepository = createIngestionRepository(pool, { fetchTimeline: fetchTicketTimeline });
const recovery = new FileStore(path.join(DATA_DIR, 'runtime', 'ingest-recovery.json'), { jobs: [] });
const ingestion = createIngestionService({
  recovery,
  repository: ingestionRepository,
  outbox: excelOutbox,
  excelWriters: { water: appendToExcel, rainfall: appendRainfallToExcel, drought: appendDroughtToExcel, pm25: appendPM25ToExcel, complaints: appendComplaintsToExcel },
  onResult(kind, result, error) {
    const names = { water: 'ดึงข้อมูลระดับน้ำ', rainfall: 'ดึงข้อมูลน้ำฝน', drought: 'ดึงข้อมูลภัยแล้ง', pm25: 'ดึงข้อมูล PM 2.5', complaints: 'ดึงข้อมูลเรื่องร้องเรียน' };
    if (result.success) {
      storageCache.clear(); dashboardCache.clear(); mapCache.clear(); riskCache.clear(); operations.invalidate();
      global.lastDataReceived = Date.now();
      const fields = { water: 'lastWLDataReceived', rainfall: 'lastRainfallDataReceived', drought: 'lastDroughtDataReceived', pm25: 'lastPM25DataReceived', complaints: 'lastComplaintsDataReceived' };
      global[fields[kind]] = Date.now();
    }
    logTaskRun(names[kind], 'db', result.success ? 'success' : 'failed', result.duplicate ? 0 : result.count, `DB: ${result.database}; Excel: ${result.excel}; batch: ${result.batchId}`);
    if (kind === 'complaints' && result.success) notifyComplaintsResult({ requestId: result.batchId?.slice('complaints:'.length), success: true });
    if (error) addLog('Persistence', `${kind}: ${error.message}`);
  }
});
installIngestionRoutes(app, ingestion, {
  onSaved(kind, result, user) {
    if (kind === 'complaints' && user?.device && !result.duplicate) {
      notifyComplaintsResult({ requestId: result.batchId?.slice('complaints:'.length), success: true, deviceId: user.id });
    }
  }
});
const operations = installOperations(app, { pool, directory: path.join(DATA_DIR, 'runtime'), outbox: excelOutbox, ingestion, recovery, excel: excelRepository, metrics });

app.post('/api/force-fetch-pm25-excel', (req, res) => {
  triggerPM25DataFetch('excel');
  res.json({ success: true, message: 'Triggered PM 2.5 Excel Fetch' });
});

app.post('/api/force-fetch-pm25-db', (req, res) => {
  triggerPM25DataFetch('db');
  res.json({ success: true, message: 'Triggered PM 2.5 DB Fetch' });
});




app.get('/api/complaints', async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const includeAll = req.query.includeAll === 'true' || req.query.all === '1';
    const whereClause = includeAll ? '' : 'WHERE (is_in_scope = 1 OR is_in_scope IS NULL)';
    const [rows] = await connection.execute(`SELECT * FROM tbl_complaints_monitoring ${whereClause} ORDER BY id DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (connection) connection.release();
  }
});

app.post('/api/force-fetch-complaints-db', (req, res) => {
  triggerComplaintsDataFetch().catch(error => addLog('System', `❌ เรื่องร้องเรียน: ${error.message}`));
  res.json({ success: true, message: 'Triggered Complaints DB Fetch' });
});

// Dashboard APIs
// 🟢 System Health Monitor API
app.get('/api/system-health', async (req, res) => {
  const startTime = Date.now();
  let dbStatus = 'disconnected';
  let dbLatency = 0;
  let totalRows = 0;

  try {
    const conn = await pool.getConnection();
    const pingStart = Date.now();
    await conn.query('SELECT 1');
    dbLatency = Date.now() - pingStart;

    const [rows] = await conn.query(`
      SELECT SUM(table_rows) as total 
      FROM information_schema.tables 
      WHERE table_schema = ?
    `, [process.env.DB_NAME || 'water_system2']);
    totalRows = rows[0]?.total || 0;
    conn.release();
    dbStatus = 'connected';
  } catch (err) {
    dbStatus = 'error: ' + err.message;
  }

  const excelCheck = [
    { key: 'water', name: 'Water_Database_Master.xlsx', path: EXCEL_FILE_PATH },
    { key: 'rainfall', name: 'Rainfall_Data.xlsx', path: RAINFALL_EXCEL_FILE_PATH },
    { key: 'drought', name: 'Drought_Dam_Data.xlsx', path: DROUGHT_EXCEL_FILE_PATH },
    { key: 'pm25', name: 'PM25_Air_Quality_Data.xlsx', path: PM25_EXCEL_FILE_PATH },
    { key: 'complaints', name: 'Complaints_Data.xlsx', path: COMPLAINTS_EXCEL_FILE_PATH },
  ].map(f => {
    const exists = fs.existsSync(f.path);
    let sizeKb = 0;
    let mtime = null;
    if (exists) {
      try {
        const stat = fs.statSync(f.path);
        sizeKb = Math.round(stat.size / 1024);
        mtime = stat.mtime;
      } catch (e) {}
    }
    const isQueueBusy = excelWriteQueues.has(f.path);
    return {
      key: f.key,
      name: f.name,
      exists,
      sizeKb,
      lastModified: mtime,
      isQueueBusy
    };
  });

  res.json({
    status: dbStatus === 'connected' ? 'healthy' : 'degraded',
    timestamp: Date.now(),
    responseTimeMs: Date.now() - startTime,
    database: {
      status: dbStatus,
      latencyMs: dbLatency,
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 3306,
      databaseName: process.env.DB_NAME || 'water_system2',
      estimatedTotalRows: totalRows
    },
    dualWrite: {
      status: 'active',
      intervalMinutes: 30,
      isScheduleActive,
      lastDataReceived: global.lastDataReceived || null,
      lastWLDataReceived: global.lastWLDataReceived || null,
      lastRainfallDataReceived: global.lastRainfallDataReceived || null,
      lastDroughtDataReceived: global.lastDroughtDataReceived || null,
      lastPM25DataReceived: global.lastPM25DataReceived || null,
      lastComplaintsDataReceived: global.lastComplaintsDataReceived || null
    },
    excelFiles: excelCheck,
    extension: {
      connected: extensionConnected || activeExtensionSockets.size > 0,
      activeSocketsCount: activeExtensionSockets.size,
      puppeteerFallbackReady: true
    }
  });
});

// 📊 Multi-station Real-time Trend Analytics API (Indexed queries)
app.get('/api/analytics/water-rainfall-trends', async (req, res) => {
  let connection;
  try {
    const { stations, startDate, endDate, limit } = req.query;
    let stationList = [];
    if (stations) {
      stationList = stations.split(',').map(s => s.trim()).filter(Boolean);
    }

    connection = await pool.getConnection();

    let query = `
      SELECT 
        station_name, river, amphoe, province,
        current_water_level_m, left_bank_level_m, bank_difference_m,
        trend, status, current_rain_mm, forecast_rain_24h_mm, risk_level,
        recorded_at
      FROM tbl_water_disaster_monitoring
      WHERE 1=1
    `;
    const params = [];

    if (stationList.length > 0) {
      const placeholders = stationList.map(() => '?').join(',');
      query += ` AND station_name IN (${placeholders})`;
      params.push(...stationList);
    }

    if (startDate && endDate) {
      query += ` AND recorded_at BETWEEN ? AND ?`;
      params.push(`${startDate} 00:00:00`, `${endDate} 23:59:59`);
    }

    const maxLimit = Math.min(parseInt(limit) || 1000, 2000);
    query += ` ORDER BY recorded_at ASC LIMIT ${maxLimit}`;

    const [rows] = await connection.execute(query, params);

    const grouped = {};
    rows.forEach(r => {
      if (!grouped[r.station_name]) {
        grouped[r.station_name] = {
          station_name: r.station_name,
          river: r.river,
          amphoe: r.amphoe,
          left_bank_level_m: r.left_bank_level_m,
          points: []
        };
      }
      grouped[r.station_name].points.push({
        recorded_at: r.recorded_at,
        current_water_level_m: r.current_water_level_m,
        bank_difference_m: r.bank_difference_m,
        current_rain_mm: r.current_rain_mm,
        trend: r.trend,
        risk_level: r.risk_level
      });
    });

    res.json({
      success: true,
      count: rows.length,
      stations: Object.values(grouped)
    });
  } catch (error) {
    console.error('Analytics Error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// =============================================================
// 🛡️ COMPOSITE RISK INDEX ENGINE (ดัชนีคะแนนความเสี่ยงภัยพิบัติรวม 0-100)
// =============================================================
const LAMPANG_DISTRICTS = [
  'เมืองลำปาง', 'เกาะคา', 'แม่เมาะ', 'ห้างฉัตร', 'แจ้ห่ม',
  'งาว', 'วังเหนือ', 'เถิน', 'สบปราบ', 'แม่พริก',
  'แม่ทะ', 'เมืองปาน', 'เสริมงาม'
];

const DAM_DISTRICT_MAP = {
  'อ่างกิ่วลม': 'เมืองลำปาง',
  'อ่างกิ่วคอหมา': 'แจ้ห่ม',
  'อ่างแม่มอก': 'เถิน',
  'อ่างเก็บน้ำแม่พริก': 'แม่พริก',
  'อ่างเก็บน้ำแม่พริก (ผาวิ่งชู้)': 'แม่พริก',
  'อ่างเก็บน้ำแม่ทะ': 'แม่ทะ',
  'อ่างเก็บน้ำแม่วะ': 'เถิน',
  'อ่างเก็บน้ำห้วยหลวง': 'เถิน',
  'อ่างเก็บน้ำแม่อาบ': 'เถิน',
  'อ่างเก็บน้ำแม่ฟ้า': 'แม่เมาะ',
  'อ่างเก็บน้ำห้วยสมัย': 'สบปราบ',
  'อ่างเก็บน้ำแม่ทรายคำ': 'เมืองลำปาง',
  'อ่างเก็บน้ำแม่ต๋ำตอนล่าง': 'เสริมงาม',
  'อ่างเก็บน้ำแม่ต๋ำน้อย': 'เสริมงาม',
  'อ่างเก็บน้ำแม่ปอน': 'ห้างฉัตร',
  'อ่างเก็บน้ำห้วยแม่สัน': 'ห้างฉัตร',
  'อ่างเก็บน้ำแม่เลียงพัฒนา': 'เสริมงาม',
  'อ่างเก็บน้ำ แม่อาง': 'เมืองลำปาง',
  'อ่างเก็บน้ำแม่ทก': 'งาว',
  'อ่างเก็บน้ำห้วยแม่ค่อม': 'เมืองปาน',
  'อ่างเก็บน้ำห้วยแม่แพนน้อย': 'เมืองปาน',
  'อ่างฯแม่ยอนสันดอนแก้ว': 'แม่เมาะ',
  'อ่างเก็บน้ำห้วยแม่ยาว': 'แจ้ห่ม'
};

function normalizeAmphoeName(name) {
  if (!name) return 'เมืองลำปาง';
  const clean = name.replace(/ลำปาง/g, '').replace(/อำเภอ/g, '').trim();
  for (const d of LAMPANG_DISTRICTS) {
    if (clean.includes(d)) return d;
  }
  return clean || 'เมืองลำปาง';
}

function calcStationFloodRisk(s) {
  let score = 10;
  const lvl = parseFloat(s.current_water_level_m);
  const bank = parseFloat(s.left_bank_level_m) || 0;
  const bankDiff = parseFloat(s.bank_difference_m);
  const rain = parseFloat(s.current_rain_mm) || 0;
  const forecastRain = parseFloat(s.rainfall_accum_3d_mm ?? s.forecast_rain_24h_mm) || 0;
  const status = ((s.status || '') + ' ' + (s.risk_level || '')).toLowerCase();

  // 1. Margin to bank (45% max)
  if (bank > 0 && !isNaN(bankDiff)) {
    if (bankDiff <= 0 || (lvl >= bank)) score += 45;
    else if (bankDiff <= 0.5) score += 38;
    else if (bankDiff <= 1.0) score += 28;
    else if (bankDiff <= 2.0) score += 15;
  }

  // 2. Rainfall & Forecast (25% max)
  const effRain = Math.max(rain, forecastRain * 0.6);
  if (effRain >= 90) score += 25;
  else if (effRain >= 50) score += 18;
  else if (effRain >= 25) score += 12;
  else if (effRain >= 10) score += 6;

  // 3. Status & Trend (20% max)
  if (status.includes('น้ำล้นตลิ่ง')) score += 20;
  else if (status.includes('น้ำมาก') || status.includes('วิกฤต')) score += 15;
  else if (status.includes('เตือนภัย') || status.includes('เฝ้าระวัง')) score += 10;

  if (s.trend && s.trend.includes('เพิ่มขึ้น')) score += 5;

  return Math.min(Math.max(Math.round(score), 5), 100);
}

function calcDamDroughtRisk(d) {
  let score = 15;
  const cap = parseFloat(d.capacity_m_cum) || 0;
  const vol = parseFloat(d.water_volume_m_cum) || 0;
  const pct = cap > 0 ? (vol / cap) * 100 : 50;

  if (pct < 20) score = 95;
  else if (pct < 30) score = 80;
  else if (pct < 45) score = 60;
  else if (pct < 60) score = 35;
  else if (pct < 80) score = 20;
  else score = 10;
  return score;
}

// 🛡️ API: Composite Flood & Drought Risk Index
app.get('/api/analytics/risk-index', async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const { startDate, endDate } = req.query;

    let dateFilterRec = '';
    let params = [];
    if (startDate && endDate) {
      dateFilterRec = 'WHERE recorded_at BETWEEN ? AND ?';
      params = [`${startDate} 00:00:00`, `${endDate} 23:59:59`];
    }

    // 1. Fetch latest water stations
    const [waterRows] = await connection.execute(`
      SELECT station_name, current_water_level_m, current_rain_mm,
             forecast_rain_24h_mm, left_bank_level_m, bank_difference_m,
             trend, risk_level, status, amphoe, recorded_at
      FROM tbl_water_disaster_monitoring
      WHERE id IN (SELECT MAX(id) FROM tbl_water_disaster_monitoring ${dateFilterRec ? dateFilterRec + ' AND current_water_level_m IS NOT NULL' : 'WHERE current_water_level_m IS NOT NULL'} GROUP BY station_name)
      AND station_name NOT LIKE '%Test%'
    `, params);

    // 2. Fetch latest dams
    const [damRows] = await connection.execute(`
      SELECT dam_name, dam_type, capacity_m_cum, water_volume_m_cum, usable_water_m_cum, inflow_m_cum, discharge_m_cum, record_date, recorded_at
      FROM tbl_drought_monitoring
      WHERE id IN (SELECT MAX(id) FROM tbl_drought_monitoring ${dateFilterRec ? dateFilterRec + ' AND water_volume_m_cum IS NOT NULL' : 'WHERE water_volume_m_cum IS NOT NULL'} GROUP BY dam_name)
    `, params);

    // 3. Process per district
    const districtData = {};
    LAMPANG_DISTRICTS.forEach(d => {
      districtData[d] = {
        district: d,
        waterStations: [],
        dams: [],
        floodScores: [],
        droughtScores: []
      };
    });

    const hotspots = [];

    waterRows.forEach(w => {
      const dist = normalizeAmphoeName(w.amphoe);
      if (!districtData[dist]) {
        districtData[dist] = { district: dist, waterStations: [], dams: [], floodScores: [], droughtScores: [] };
      }
      const fScore = calcStationFloodRisk(w);
      districtData[dist].waterStations.push(w);
      districtData[dist].floodScores.push(fScore);

      const st = (w.status || '').toLowerCase();
      if (st.includes('น้ำน้อยวิกฤต')) districtData[dist].droughtScores.push(90);
      else if (st.includes('น้ำน้อย')) districtData[dist].droughtScores.push(65);

      if (fScore >= 45 || st.includes('น้ำน้อยวิกฤต')) {
        hotspots.push({
          name: w.station_name,
          type: 'สถานีวัดระดับน้ำ',
          amphoe: dist,
          score: fScore,
          riskLevel: fScore >= 80 ? 'วิกฤตสีแดง' : fScore >= 60 ? 'เสี่ยงสูง' : fScore >= 40 ? 'เฝ้าระวัง' : 'ปกติ',
          color: fScore >= 80 ? '#dc2626' : fScore >= 60 ? '#ea580c' : fScore >= 40 ? '#ca8a04' : '#16a34a',
          detail: `ระดับน้ำ ${w.current_water_level_m} ม. (ตลิ่ง ${w.left_bank_level_m || '-'} ม., ฝน ${w.current_rain_mm || 0} มม.)`
        });
      }
    });

    damRows.forEach(d => {
      const dist = DAM_DISTRICT_MAP[d.dam_name] || 'เมืองลำปาง';
      if (!districtData[dist]) {
        districtData[dist] = { district: dist, waterStations: [], dams: [], floodScores: [], droughtScores: [] };
      }
      const dScore = calcDamDroughtRisk(d);
      districtData[dist].dams.push(d);
      districtData[dist].droughtScores.push(dScore);

      const cap = parseFloat(d.capacity_m_cum) || 0;
      const vol = parseFloat(d.water_volume_m_cum) || 0;
      const pct = cap > 0 ? ((vol / cap) * 100).toFixed(1) : 0;

      if (dScore >= 55) {
        hotspots.push({
          name: d.dam_name,
          type: 'อ่างเก็บน้ำ',
          amphoe: dist,
          score: dScore,
          riskLevel: dScore >= 80 ? 'วิกฤตสีแดง' : dScore >= 60 ? 'เสี่ยงสูง' : 'เฝ้าระวัง',
          color: dScore >= 80 ? '#dc2626' : dScore >= 60 ? '#ea580c' : '#ca8a04',
          detail: `น้ำกักเก็บเหลือ ${pct}% (${vol}/${cap} ล้าน ลบ.ม.)`
        });
      }
    });

    // Compute District Results
    const districtsResult = LAMPANG_DISTRICTS.map(dName => {
      const item = districtData[dName];
      const fScores = item.floodScores;
      const dScores = item.droughtScores;

      const floodScore = fScores.length > 0
        ? Math.round(Math.max(...fScores) * 0.7 + (fScores.reduce((a, b) => a + b, 0) / fScores.length) * 0.3)
        : 15;

      const droughtScore = dScores.length > 0
        ? Math.round(Math.max(...dScores) * 0.7 + (dScores.reduce((a, b) => a + b, 0) / dScores.length) * 0.3)
        : 20;

      const compositeScore = Math.round(Math.max(floodScore, droughtScore) * 0.75 + Math.min(floodScore, droughtScore) * 0.25);
      const primaryThreat = floodScore >= droughtScore ? 'อุทกภัย/น้ำหลาก' : 'ภัยแล้ง/น้ำน้อย';

      let riskLevel = 'ปกติ';
      let color = '#16a34a';
      if (compositeScore >= 80) { riskLevel = 'วิกฤตสีแดง'; color = '#dc2626'; }
      else if (compositeScore >= 60) { riskLevel = 'เสี่ยงสูง'; color = '#ea580c'; }
      else if (compositeScore >= 40) { riskLevel = 'เฝ้าระวัง'; color = '#ca8a04'; }

      return {
        district: dName,
        compositeScore,
        floodScore,
        droughtScore,
        primaryThreat,
        riskLevel,
        color,
        stationCount: item.waterStations.length,
        damCount: item.dams.length
      };
    });

    districtsResult.sort((a, b) => b.compositeScore - a.compositeScore);
    hotspots.sort((a, b) => b.score - a.score);

    // Provincial Overall Summary
    const avgComposite = Math.round(districtsResult.reduce((a, b) => a + b.compositeScore, 0) / districtsResult.length);
    const maxComposite = districtsResult[0] ? districtsResult[0].compositeScore : 15;
    const provincialScore = Math.round(maxComposite * 0.6 + avgComposite * 0.4);

    let provLevel = 'ปกติ';
    let provColor = '#16a34a';
    if (provincialScore >= 80) { provLevel = 'วิกฤตสีแดง'; provColor = '#dc2626'; }
    else if (provincialScore >= 60) { provLevel = 'เสี่ยงสูง'; provColor = '#ea580c'; }
    else if (provincialScore >= 40) { provLevel = 'เฝ้าระวัง'; provColor = '#ca8a04'; }

    const highRiskCount = districtsResult.filter(d => d.compositeScore >= 60).length;
    const warningCount = districtsResult.filter(d => d.compositeScore >= 40 && d.compositeScore < 60).length;
    const normalCount = districtsResult.filter(d => d.compositeScore < 40).length;

    // AI Proactive Recommendation
    let aiRecommendation = '';
    const topDistrictsStr = districtsResult.slice(0, 3).map(d => `${d.district} (${d.compositeScore} คะแนน, ${d.primaryThreat})`).join(', ');
    if (provincialScore >= 80) {
      aiRecommendation = `🚨 ตรวจพบพื้นที่เสี่ยงวิกฤตระดับสูง แนะนำ อบจ.ลำปาง และ ปภ.จังหวัด สั่งการเปิดศูนย์บัญชาการเหตุการณ์ และเตรียมเครื่องสูบน้ำ/รถบรรทุกน้ำเข้าช่วยเหลือในพื้นที่เสี่ยงหลัก: ${topDistrictsStr} โดยด่วน`;
    } else if (provincialScore >= 60) {
      aiRecommendation = `⚠️ สถานการณ์ภาพรวมอยู่ในเกณฑ์เสี่ยงสูง โดยเฉพาะในพื้นที่ ${topDistrictsStr} แนะนำตรวจสอบพนังกั้นน้ำและประสานชลประทานลำปางเพื่อบริหารจัดการน้ำในอ่างเก็บน้ำอย่างใกล้ชิด`;
    } else if (provincialScore >= 40) {
      aiRecommendation = `🟡 ภาพรวมจังหวัดอยู่ในระดับเฝ้าระวัง พบความเสี่ยงเฉพาะจุดในพื้นที่ ${topDistrictsStr} แนะนำกำชับท้องถิ่นติดตามแนวโน้มฝนสะสมและระดับน้ำในลำน้ำสายหลักอย่างต่อเนื่อง`;
    } else {
      aiRecommendation = `🟢 สถานการณ์ทรัพยากรน้ำและภัยพิบัติทั้ง 13 อำเภอของจังหวัดลำปางอยู่ในเกณฑ์ปกติ สมดุลน้ำอยู่ในเกณฑ์ปลอดภัย`;
    }

    res.json({
      success: true,
      summary: {
        compositeScore: provincialScore,
        riskLevel: provLevel,
        riskColor: provColor,
        primaryThreat: districtsResult[0]?.primaryThreat || 'ปกติ',
        highRiskDistrictsCount: highRiskCount,
        warningDistrictsCount: warningCount,
        normalDistrictsCount: normalCount,
        totalDistricts: districtsResult.length,
        activeStations: waterRows.length,
        activeDams: damRows.length,
        aiRecommendation,
        updatedAt: new Date().toISOString()
      },
      districts: districtsResult,
      hotspots: hotspots.slice(0, 10)
    });
  } catch (error) {
    console.error('Risk Index Error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// =========================================================================
// 🗺️ GIS Map Data Provider (Stations, Dams, Districts, Rainfall Heatmap)
// =========================================================================
const LAMPANG_DISTRICT_COORDS = {
  'เมืองลำปาง': { lat: 18.2888, lng: 99.4920 },
  'เกาะคา': { lat: 18.1963, lng: 99.4005 },
  'แม่เมาะ': { lat: 18.2753, lng: 99.6582 },
  'ห้างฉัตร': { lat: 18.3228, lng: 99.3414 },
  'แจ้ห่ม': { lat: 18.7139, lng: 99.5539 },
  'งาว': { lat: 18.7758, lng: 99.9769 },
  'วังเหนือ': { lat: 19.1458, lng: 99.6192 },
  'เถิน': { lat: 17.6167, lng: 99.2167 },
  'สบปราบ': { lat: 17.8931, lng: 99.3386 },
  'แม่พริก': { lat: 17.4475, lng: 99.1172 },
  'แม่ทะ': { lat: 18.1136, lng: 99.5647 },
  'เมืองปาน': { lat: 18.7517, lng: 99.4317 },
  'เสริมงาม': { lat: 18.0667, lng: 99.2333 }
};

const KNOWN_FEATURE_COORDS = {
  // Dams / Reservoirs
  'อ่างกิ่วลม': { lat: 18.5178, lng: 99.6167 },
  'อ่างกิ่วคอหมา': { lat: 18.7889, lng: 99.6311 },
  'อ่างแม่มอก': { lat: 17.4612, lng: 99.3820 },
  'อ่างเก็บน้ำแม่มอก': { lat: 17.4612, lng: 99.3820 },
  'อ่างเก็บน้ำแม่ต๋ำตอนล่าง': { lat: 18.0415, lng: 99.2580 },
  'อ่างเก็บน้ำแม่ต๋ำ': { lat: 18.0415, lng: 99.2580 },
  'อ่างเก็บน้ำแม่จาง': { lat: 18.2340, lng: 99.7215 },
  'อ่างเก็บน้ำห้วยหลวง': { lat: 17.6250, lng: 99.2180 },
  'อ่างเก็บน้ำห้วยแม่ค่อม': { lat: 18.2890, lng: 99.5100 },
  'อ่างเก็บน้ำห้วยแม่งอน': { lat: 18.7110, lng: 99.5630 },
  // Stations
  'สะพานเสตุวารี': { lat: 18.2934, lng: 99.5012 },
  'บ้านท่าล้อ': { lat: 18.3050, lng: 99.4850 },
  'บ้านแลง': { lat: 18.2720, lng: 99.5080 },
  'บ้านเกาะคา': { lat: 18.1920, lng: 99.3980 },
  'น้ำแม่งาว': { lat: 18.7730, lng: 99.9720 },
  'บ้านหลวงเหนือ': { lat: 18.7750, lng: 99.9810 },
  'บ้านไฮ': { lat: 18.7180, lng: 99.5510 },
  'บ้านหนองนาว': { lat: 18.7050, lng: 99.5620 },
  'สะพานน้ำแม่ต๋ำ': { lat: 18.0650, lng: 99.2310 },
  'บ้านแม่เชียงราย': { lat: 17.4420, lng: 99.1150 }
};

function getFeatureCoordinates(name, amphoe) {
  if (KNOWN_FEATURE_COORDS[name]) return { ...KNOWN_FEATURE_COORDS[name], precision: 'configured' };
  const distName = normalizeAmphoeName(amphoe);
  const base = LAMPANG_DISTRICT_COORDS[distName] || LAMPANG_DISTRICT_COORDS['เมืองลำปาง'];
  return { ...base, precision: 'district_center' };
}

app.get('/api/gis/map-data', async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();

    // 1. Latest Water Stations
    const [waterRows] = await connection.query(`
      SELECT 
        w.station_name, w.river, w.amphoe, w.province,
        w.current_water_level_m, w.left_bank_level_m, w.bank_difference_m,
        w.trend, w.status, w.current_rain_mm, w.forecast_rain_24h_mm,
        w.risk_level, w.recorded_at
      FROM tbl_water_disaster_monitoring w
      INNER JOIN (
        SELECT station_name, MAX(id) as max_id
        FROM tbl_water_disaster_monitoring
        GROUP BY station_name
      ) latest ON w.id = latest.max_id
    `);

    // 2. Latest Dams
    const [damRows] = await connection.query(`
      SELECT 
        d.dam_name, d.dam_type, d.capacity_m_cum,
        d.inflow_m_cum, d.water_volume_m_cum, d.water_percent,
        d.usable_water_m_cum, d.discharge_m_cum, d.recorded_at
      FROM tbl_drought_monitoring d
      INNER JOIN (
        SELECT dam_name, MAX(id) as max_id
        FROM tbl_drought_monitoring
        GROUP BY dam_name
      ) latest ON d.id = latest.max_id
    `);

    // 3. Process Stations
    const stations = waterRows.map(row => {
      const amphoeClean = normalizeAmphoeName(row.amphoe);
      const coords = getFeatureCoordinates(row.station_name, amphoeClean);
      const diff = row.bank_difference_m !== null ? Number(row.bank_difference_m) : 999;
      const wl = Number(row.current_water_level_m) || 0;
      const rain = Number(row.current_rain_mm) || 0;
      const forecast = Number(row.forecast_rain_24h_mm) || 0;

      let severity = 'normal'; // normal (green), watch (yellow), warning (orange), critical (red)
      let severityLabel = 'ปกติ';
      let color = '#10b981';

      if (diff <= 0 || row.status === 'น้ำล้นตลิ่ง' || row.risk_level === 'วิกฤต') {
        severity = 'critical';
        severityLabel = 'วิกฤต (ล้นตลิ่ง)';
        color = '#ef4444';
      } else if (diff <= 0.5 || row.status === 'น้ำมาก' || (row.trend === 'แนวโน้มเพิ่มขึ้น' && rain > 20)) {
        severity = 'warning';
        severityLabel = 'เสี่ยงสูง (น้ำมาก)';
        color = '#f97316';
      } else if (diff <= 1.0 || row.status === 'เฝ้าระวัง' || wl <= 0.5 || row.status === 'น้ำน้อย' || row.status === 'น้ำน้อยวิกฤต') {
        severity = 'watch';
        severityLabel = wl <= 0.5 || row.status === 'น้ำน้อยวิกฤต' ? 'เฝ้าระวัง (น้ำน้อย)' : 'เฝ้าระวัง';
        color = '#eab308';
      }

      return {
        type: 'station',
        name: row.station_name,
        river: row.river || '-',
        amphoe: amphoeClean,
        currentWaterLevel: wl,
        leftBankLevel: Number(row.left_bank_level_m) || 0,
        bankDiff: diff < 900 ? diff : null,
        status: row.status || 'ปกติ',
        trend: row.trend || 'ปกติ',
        currentRain: rain,
        rainfallAccum3d: forecast,
        totalRain24h: Number(rain.toFixed(1)),
        severity,
        severityLabel,
        color,
        isCritical: severity === 'critical' || severity === 'warning',
        coordinatePrecision: coords.precision,
        lat: coords.lat,
        lng: coords.lng,
        recordedAt: row.recorded_at
      };
    });

    // 4. Process Dams
    const dams = damRows.map(row => {
      const amphoeClean = DAM_DISTRICT_MAP[row.dam_name] || 'เมืองลำปาง';
      const coords = getFeatureCoordinates(row.dam_name, amphoeClean);
      const pct = Number(String(row.water_percent || '').replace('%', '').trim()) || 0;
      const capacity = Number(row.capacity_m_cum) || 0;
      const volume = Number(row.water_volume_m_cum) || 0;
      const usable = Number(row.usable_water_m_cum) || 0;

      let severity = 'normal';
      let severityLabel = 'ปกติ';
      let color = '#10b981';

      if (pct < 20) {
        severity = 'critical';
        severityLabel = 'แล้งวิกฤต (<20%)';
        color = '#ef4444';
      } else if (pct < 30) {
        severity = 'warning';
        severityLabel = 'แล้งเสี่ยงสูง (20-30%)';
        color = '#f97316';
      } else if (pct < 40) {
        severity = 'watch';
        severityLabel = 'เฝ้าระวังภัยแล้ง (30-40%)';
        color = '#eab308';
      } else if (pct > 95) {
        severity = 'critical';
        severityLabel = 'น้ำล้นวิกฤต (>95%)';
        color = '#ef4444';
      } else if (pct > 85) {
        severity = 'warning';
        severityLabel = 'เสี่ยงน้ำมาก (>85%)';
        color = '#f97316';
      }

      return {
        type: 'dam',
        name: row.dam_name,
        damType: row.dam_type || 'อ่างเก็บน้ำ',
        amphoe: amphoeClean,
        capacity,
        volume,
        percent: pct,
        usable,
        inflow: Number(row.inflow_m_cum) || 0,
        discharge: Number(row.discharge_m_cum) || 0,
        severity,
        severityLabel,
        color,
        isCritical: severity === 'critical' || severity === 'warning',
        coordinatePrecision: coords.precision,
        lat: coords.lat,
        lng: coords.lng,
        recordedAt: row.recorded_at
      };
    });

    // 5. Calculate Rainfall Intensity Circles & District Summaries
    const districts = LAMPANG_DISTRICTS.map(dist => {
      const center = LAMPANG_DISTRICT_COORDS[dist] || LAMPANG_DISTRICT_COORDS['เมืองลำปาง'];
      const distStations = stations.filter(s => s.amphoe === dist);
      const distDams = dams.filter(d => d.amphoe === dist);

      const maxRain = distStations.reduce((max, s) => Math.max(max, s.totalRain24h), 0);
      const avgRain = distStations.length > 0 
        ? Number((distStations.reduce((sum, s) => sum + s.totalRain24h, 0) / distStations.length).toFixed(1))
        : 0;

      let rainIntensity = 'none';
      let circleColor = '#3b82f6';
      let circleRadius = 3500; // in meters

      if (maxRain > 90) {
        rainIntensity = 'very_heavy';
        circleColor = '#7e22ce'; // purple
        circleRadius = 11000;
      } else if (maxRain > 35) {
        rainIntensity = 'heavy';
        circleColor = '#ef4444'; // red
        circleRadius = 8500;
      } else if (maxRain > 10) {
        rainIntensity = 'moderate';
        circleColor = '#f59e0b'; // amber
        circleRadius = 6500;
      } else if (maxRain > 0) {
        rainIntensity = 'light';
        circleColor = '#06b6d4'; // cyan
        circleRadius = 4500;
      }

      const criticalCount = distStations.filter(s => s.isCritical).length + distDams.filter(d => d.isCritical).length;

      return {
        districtName: dist,
        lat: center.lat,
        lng: center.lng,
        stationCount: distStations.length,
        damCount: distDams.length,
        criticalCount,
        maxRain24h: maxRain,
        avgRain24h: avgRain,
        rainIntensity,
        circleColor,
        circleRadius,
        hasRain: maxRain > 0
      };
    });

    // Rainfall heatmap points (stations + district centroids with rain)
    const rainCircles = [];
    districts.forEach(d => {
      if (d.maxRain24h > 0) {
        rainCircles.push({
          name: `กลุ่มฝน อ.${d.districtName}`,
          amphoe: d.districtName,
          lat: d.lat,
          lng: d.lng,
          rain_mm: d.maxRain24h,
          intensity: d.rainIntensity,
          color: d.circleColor,
          radius: d.circleRadius
        });
      }
    });
    stations.forEach(s => {
      if (s.totalRain24h > 15) {
        rainCircles.push({
          name: s.name,
          amphoe: s.amphoe,
          lat: s.lat,
          lng: s.lng,
          rain_mm: s.totalRain24h,
          intensity: s.totalRain24h > 35 ? 'heavy' : 'moderate',
          color: s.totalRain24h > 35 ? '#ef4444' : '#f59e0b',
          radius: 4000
        });
      }
    });

    const totalCritical = stations.filter(s => s.isCritical).length + dams.filter(d => d.isCritical).length;

    res.json({
      success: true,
      summary: {
        totalStations: stations.length,
        totalDams: dams.length,
        criticalCount: totalCritical,
        criticalStations: stations.filter(s => s.isCritical).length,
        criticalDams: dams.filter(d => d.isCritical).length,
        rainAreasCount: rainCircles.length,
        center: [18.2888, 99.4920],
        updatedAt: new Date().toISOString()
      },
      stations,
      dams,
      districts,
      rainCircles
    });
  } catch (error) {
    console.error('GIS Map Data Error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// 📄 Executive Report Generation API (Word .docx and PDF .pdf with auto-charts)
app.get('/api/reports/generate-summary', async (req, res) => {
  try {
    const { period = 'monthly', targetDate, startDate, endDate, format = 'docx', sections } = req.query;
    addLog('Reports', `📄 กำลังสร้างรายงานอัตโนมัติ (${period}, รูปแบบ: ${format})...`);
    
    let parsedSections = {};
    if (typeof sections === 'string' && sections.trim()) {
      try {
        parsedSections = JSON.parse(sections);
      } catch (e) {
        const parts = sections.split(',').map(s => s.trim());
        parsedSections = {
          water: parts.includes('water'),
          drought: parts.includes('drought'),
          riskIndex: parts.includes('riskIndex'),
          pm25: parts.includes('pm25'),
          complaints: parts.includes('complaints')
        };
      }
    } else if (typeof sections === 'object' && sections !== null) {
      parsedSections = sections;
    }

    const report = await generateExecutiveReport({
      period,
      targetDate: targetDate || null,
      startDate: startDate || null,
      endDate: endDate || null,
      sections: parsedSections,
      format: format.toLowerCase() === 'pdf' ? 'pdf' : 'docx'
    });

    res.setHeader('Content-Type', report.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(report.filename)}"`);
    res.send(report.buffer);
    addLog('Reports', `✅ สร้างรายงานสำเร็จ: ${report.filename}`);
  } catch (err) {
    console.error('Report Generation Error:', err);
    addLog('Reports', `❌ เกิดข้อผิดพลาดในการสร้างรายงาน: ${err.message}`);
    res.status(500).json({ error: 'Failed to generate report: ' + err.message });
  }
});

// 📥 On-demand Raw Data Exporter (Excel .xlsx / CSV .csv)
app.get('/api/reports/export-raw-data', async (req, res) => {
  let connection;
  try {
    const { project = 'all', format = 'xlsx', period = 'monthly', startDate, endDate, date } = req.query;
    let sDate = '';
    let eDate = '';

    if (startDate && endDate) {
      sDate = startDate.includes(' ') ? startDate : startDate + ' 00:00:00';
      eDate = endDate.includes(' ') ? endDate : endDate + ' 23:59:59';
    } else {
      const refDate = date ? new Date(date) : new Date();
      if (period === 'daily') {
        const dStr = refDate.toISOString().split('T')[0];
        sDate = dStr + ' 00:00:00';
        eDate = dStr + ' 23:59:59';
      } else if (period === 'weekly') {
        const endD = new Date(refDate);
        const startD = new Date(refDate);
        startD.setDate(startD.getDate() - 6);
        sDate = startD.toISOString().split('T')[0] + ' 00:00:00';
        eDate = endD.toISOString().split('T')[0] + ' 23:59:59';
      } else {
        const year = refDate.getFullYear();
        const month = refDate.getMonth();
        const startD = new Date(year, month, 1);
        const endD = new Date(year, month + 1, 0);
        sDate = startD.toISOString().split('T')[0] + ' 00:00:00';
        eDate = endD.toISOString().split('T')[0] + ' 23:59:59';
      }
    }

    addLog('Reports', `📥 กำลังส่งออกข้อมูลดิบ (โครงการ: ${project}, รูปแบบ: ${format}, ช่วงเวลา: ${sDate.split(' ')[0]} ถึง ${eDate.split(' ')[0]})...`);
    connection = await pool.getConnection();

    const fetchWater = project === 'all' || project === 'water';
    const fetchDrought = project === 'all' || project === 'drought';
    const fetchPm25 = project === 'all' || project === 'pm25';
    const fetchComplaints = project === 'all' || project === 'complaints';

    let waterRows = [];
    let damRows = [];
    let pm25Rows = [];
    let complaintRows = [];

    if (fetchWater) {
      [waterRows] = await connection.query(`
        SELECT 
          station_name, river, amphoe, province,
          current_water_level_m, left_bank_level_m, bank_difference_m,
          trend, status, current_rain_mm, forecast_rain_24h_mm,
          risk_level, recorded_at
        FROM tbl_water_disaster_monitoring
        WHERE recorded_at BETWEEN ? AND ?
        ORDER BY recorded_at DESC
      `, [sDate, eDate]);
    }

    if (fetchDrought) {
      [damRows] = await connection.query(`
        SELECT 
          dam_name, dam_type, capacity_m_cum,
          inflow_m_cum, water_volume_m_cum, water_percent,
          usable_water_m_cum, discharge_m_cum, recorded_at
        FROM tbl_drought_monitoring
        WHERE recorded_at BETWEEN ? AND ?
        ORDER BY recorded_at DESC
      `, [sDate, eDate]);
    }

    if (fetchPm25) {
      [pm25Rows] = await connection.query(`
        SELECT 
          station_name, tambon, amphoe, pm25_value, pm25_avg_24h,
          air_quality_status, recorded_at
        FROM tbl_pm25_monitoring
        WHERE recorded_at BETWEEN ? AND ?
        ORDER BY recorded_at DESC
      `, [sDate, eDate]);
    }

    if (fetchComplaints) {
      [complaintRows] = await connection.query(`
        SELECT 
          ticket_id, created_at, problem_type, description,
          state_name, org_name, location
        FROM tbl_complaints_monitoring
        WHERE created_at BETWEEN ? AND ? AND (is_in_scope = 1 OR is_in_scope IS NULL)
        ORDER BY created_at DESC
      `, [sDate, eDate]);
    }

    const sStr = sDate.split(' ')[0];
    const eStr = eDate.split(' ')[0];

    // Export CSV
    if (format.toLowerCase() === 'csv') {
      let csvContent = '\uFEFF'; // UTF-8 BOM for Thai support in Excel
      
      if (project === 'water' || (project === 'all' && waterRows.length > 0)) {
        csvContent += `=== ข้อมูลระดับน้ำและปริมาณน้ำฝน (${sStr} ถึง ${eStr}) ===\n`;
        csvContent += 'ชื่อสถานี,ลุ่มน้ำ,อำเภอ,จังหวัด,ระดับน้ำปัจจุบัน(ม.),ระดับตลิ่ง(ม.),ระยะห่างตลิ่ง(ม.),แนวโน้ม,สถานะ,ฝนปัจจุบัน(มม.),ฝนสะสม3วัน(มม.),ระดับความเสี่ยง,วันเวลาที่บันทึก\n';
        waterRows.forEach(r => {
          csvContent += `"${r.station_name}","${r.river || ''}","${r.amphoe || ''}","${r.province || ''}",${r.current_water_level_m ?? ''},${r.left_bank_level_m ?? ''},${r.bank_difference_m ?? ''},"${r.trend || ''}","${r.status || ''}",${r.current_rain_mm ?? ''},${r.forecast_rain_24h_mm ?? ''},"${r.risk_level || ''}","${new Date(r.recorded_at).toLocaleString('th-TH')}"\n`;
        });
        csvContent += '\n';
      }

      if (project === 'drought' || (project === 'all' && damRows.length > 0)) {
        csvContent += `=== ข้อมูลอ่างเก็บน้ำและสถานการณ์ภัยแล้ง (${sStr} ถึง ${eStr}) ===\n`;
        csvContent += 'ชื่ออ่างเก็บน้ำ,ประเภท,ความจุ(ล้าน ลบ.ม.),ปริมาณน้ำไหลเข้า,ปริมาณน้ำกักเก็บ,% ปริมาณน้ำ,น้ำใช้การได้,ปริมาณน้ำระบาย,วันเวลาที่บันทึก\n';
        damRows.forEach(r => {
          csvContent += `"${r.dam_name}","${r.dam_type || ''}",${r.capacity_m_cum ?? ''},${r.inflow_m_cum ?? ''},${r.water_volume_m_cum ?? ''},"${r.water_percent || ''}",${r.usable_water_m_cum ?? ''},${r.discharge_m_cum ?? ''},"${new Date(r.recorded_at).toLocaleString('th-TH')}"\n`;
        });
        csvContent += '\n';
      }

      if (project === 'pm25' || (project === 'all' && pm25Rows.length > 0)) {
        csvContent += `=== ข้อมูลคุณภาพอากาศ PM 2.5 (${sStr} ถึง ${eStr}) ===\n`;
        csvContent += 'ชื่อสถานี,ตำบล,อำเภอ,PM 2.5(µg/m³),PM 2.5 เฉลี่ย 24 ชม.,ระดับคุณภาพอากาศ,วันเวลาที่บันทึก\n';
        pm25Rows.forEach(r => {
          csvContent += `"${r.station_name}","${r.tambon || ''}","${r.amphoe || ''}",${r.pm25_value ?? ''},${r.pm25_avg_24h ?? ''},"${r.air_quality_status || ''}","${new Date(r.recorded_at).toLocaleString('th-TH')}"\n`;
        });
        csvContent += '\n';
      }

      if (project === 'complaints' || (project === 'all' && complaintRows.length > 0)) {
        csvContent += `=== ข้อมูลเรื่องร้องเรียน (${sStr} ถึง ${eStr}) ===\n`;
        csvContent += 'Ticket ID,วันที่ร้องเรียน,ประเภทเรื่อง,รายละเอียด,สถานะ,หน่วยงานรับผิดชอบ,สถานที่\n';
        complaintRows.forEach(r => {
          const descClean = (r.description || '').replace(/"/g, '""').replace(/\n/g, ' ');
          csvContent += `"${r.ticket_id}","${new Date(r.created_at).toLocaleString('th-TH')}","${r.problem_type || ''}","${descClean}","${r.state_name || ''}","${r.org_name || ''}","${r.location || ''}"\n`;
        });
      }

      const filename = `RawData_${project}_${sStr}_to_${eStr}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.send(Buffer.from(csvContent, 'utf-8'));
      addLog('Reports', `✅ ส่งออกไฟล์ CSV สำเร็จ: ${filename}`);
      return;
    }

    // Export Excel (.xlsx) via ExcelJS
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'อบจ. ลำปาง (Lampang PAO)';
    workbook.created = new Date();

    const headerStyle = {
      font: { name: 'Prompt', size: 11, bold: true, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } },
      alignment: { vertical: 'middle', horizontal: 'center' },
      border: {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
      }
    };

    if (fetchWater) {
      const ws = workbook.addWorksheet('ข้อมูลระดับน้ำ');
      ws.columns = [
        { header: 'ชื่อสถานี', key: 'station_name', width: 20 },
        { header: 'ลุ่มน้ำ', key: 'river', width: 16 },
        { header: 'อำเภอ', key: 'amphoe', width: 16 },
        { header: 'ระดับน้ำปัจจุบัน (ม.)', key: 'current_water_level_m', width: 18 },
        { header: 'ระดับตลิ่งซ้าย (ม.)', key: 'left_bank_level_m', width: 18 },
        { header: 'ระยะห่างตลิ่ง (ม.)', key: 'bank_difference_m', width: 18 },
        { header: 'แนวโน้ม', key: 'trend', width: 12 },
        { header: 'สถานะ', key: 'status', width: 14 },
        { header: 'ฝนปัจจุบัน (มม.)', key: 'current_rain_mm', width: 16 },
        { header: 'คาดการณ์ฝน 24ชม. (มม.)', key: 'forecast_rain_24h_mm', width: 22 },
        { header: 'ระดับความเสี่ยง', key: 'risk_level', width: 16 },
        { header: 'วันเวลาที่บันทึก', key: 'recorded_at', width: 20 }
      ];
      ws.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));
      waterRows.forEach(r => {
        ws.addRow({
          ...r,
          recorded_at: new Date(r.recorded_at).toLocaleString('th-TH')
        });
      });
    }

    if (fetchDrought) {
      const ws = workbook.addWorksheet('ข้อมูลอ่างเก็บน้ำ');
      ws.columns = [
        { header: 'ชื่ออ่างเก็บน้ำ', key: 'dam_name', width: 22 },
        { header: 'ประเภท', key: 'dam_type', width: 16 },
        { header: 'ความจุ (ล้าน ลบ.ม.)', key: 'capacity_m_cum', width: 20 },
        { header: 'ปริมาณน้ำไหลเข้า', key: 'inflow_m_cum', width: 18 },
        { header: 'ปริมาณน้ำกักเก็บ', key: 'water_volume_m_cum', width: 18 },
        { header: '% ปริมาณน้ำ', key: 'water_percent', width: 14 },
        { header: 'น้ำใช้การได้', key: 'usable_water_m_cum', width: 16 },
        { header: 'ปริมาณน้ำระบาย', key: 'discharge_m_cum', width: 18 },
        { header: 'วันเวลาที่บันทึก', key: 'recorded_at', width: 20 }
      ];
      ws.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));
      damRows.forEach(r => {
        ws.addRow({
          ...r,
          recorded_at: new Date(r.recorded_at).toLocaleString('th-TH')
        });
      });
    }

    if (fetchPm25) {
      const ws = workbook.addWorksheet('ข้อมูล PM 2.5');
      ws.columns = [
        { header: 'ชื่อสถานี', key: 'station_name', width: 22 },
        { header: 'ตำบล', key: 'tambon', width: 16 },
        { header: 'อำเภอ', key: 'amphoe', width: 16 },
        { header: 'ค่า PM 2.5 (µg/m³)', key: 'pm25_value', width: 18 },
        { header: 'PM 2.5 เฉลี่ย 24 ชม.', key: 'pm25_avg_24h', width: 20 },
        { header: 'ระดับคุณภาพอากาศ', key: 'air_quality_status', width: 22 },
        { header: 'วันเวลาที่บันทึก', key: 'recorded_at', width: 20 }
      ];
      ws.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));
      pm25Rows.forEach(r => {
        ws.addRow({
          ...r,
          recorded_at: new Date(r.recorded_at).toLocaleString('th-TH')
        });
      });
    }

    if (fetchComplaints) {
      const ws = workbook.addWorksheet('ข้อมูลเรื่องร้องเรียน');
      ws.columns = [
        { header: 'Ticket ID', key: 'ticket_id', width: 18 },
        { header: 'วันที่ร้องเรียน', key: 'created_at', width: 20 },
        { header: 'ประเภทเรื่อง', key: 'problem_type', width: 20 },
        { header: 'รายละเอียด', key: 'description', width: 35 },
        { header: 'สถานะ', key: 'state_name', width: 16 },
        { header: 'หน่วยงานรับผิดชอบ', key: 'org_name', width: 24 },
        { header: 'สถานที่', key: 'location', width: 28 }
      ];
      ws.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));
      complaintRows.forEach(r => {
        ws.addRow({
          ...r,
          created_at: new Date(r.created_at).toLocaleString('th-TH')
        });
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `RawData_${project}_${sStr}_to_${eStr}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(buffer);
    addLog('Reports', `✅ ส่งออกไฟล์ Excel สำเร็จ: ${filename}`);
  } catch (err) {
    console.error('Export Raw Data Error:', err);
    addLog('Reports', `❌ เกิดข้อผิดพลาดในการส่งออกข้อมูลดิบ: ${err.message}`);
    res.status(500).json({ error: 'Failed to export raw data: ' + err.message });
  } finally {
    if (connection) connection.release();
  }
});

app.get('/api/rainfall-data', async (req, res) => {
  try {
    const query = `
      SELECT * FROM tbl_rainfall_monitoring 
      WHERE id IN (
        SELECT MAX(id) FROM tbl_rainfall_monitoring GROUP BY station_name
      )
      ORDER BY rain_mm DESC
    `;
    const [rows] = await pool.execute(query);
    res.json(rows);
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Failed to fetch rainfall data' });
  }
});

app.get('/api/dashboard-summary', async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const { startDate, endDate } = req.query;
    
    let dateFilterRec = '';
    let andDateFilterRec = '';
    // Complaints uses created_at (not recorded_at) because UPSERT overwrites recorded_at = NOW() on every fetch
    let dateFilterCreated = '';
    let andDateFilterCreated = '';
    let params = [];
    let limitClause = 'LIMIT 7';
    
    if (startDate && endDate) {
      dateFilterRec = 'WHERE recorded_at BETWEEN ? AND ?';
      andDateFilterRec = 'AND recorded_at BETWEEN ? AND ?';
      dateFilterCreated = 'WHERE created_at BETWEEN ? AND ?';
      andDateFilterCreated = 'AND created_at BETWEEN ? AND ?';
      params = [`${startDate} 00:00:00`, `${endDate} 23:59:59`];
      limitClause = ''; // If date range is specified, return all dates in that range
    }

    // 1. Water Level
    const [waterRows] = await connection.execute(`
      SELECT station_name, current_water_level_m, current_rain_mm,
             forecast_rain_24h_mm AS rainfall_accum_3d_mm,
             left_bank_level_m, bank_difference_m, trend, risk_level, status, amphoe
      FROM tbl_water_disaster_monitoring 
      WHERE id IN (SELECT MAX(id) FROM tbl_water_disaster_monitoring ${dateFilterRec ? dateFilterRec + ' AND current_water_level_m IS NOT NULL' : 'WHERE current_water_level_m IS NOT NULL'} GROUP BY station_name)
      AND station_name NOT LIKE '%Test%'
    `, params);
    
    const [waterHistory] = await connection.execute(`
      SELECT DATE_FORMAT(recorded_at, '%Y-%m-%d') as date, AVG(current_water_level_m) as avg_val
      FROM tbl_water_disaster_monitoring
      ${dateFilterRec ? dateFilterRec + " AND station_name NOT LIKE '%Test%'" : "WHERE station_name NOT LIKE '%Test%'"}
      GROUP BY DATE_FORMAT(recorded_at, '%Y-%m-%d')
      ORDER BY date DESC ${limitClause}
    `, params);

    const stationHistoryWhere = dateFilterRec
      ? `wdh.recorded_at BETWEEN ? AND ?
         AND wdh.current_water_level_m IS NOT NULL
         AND wdh.station_name NOT LIKE '%Test%'`
      : `wdh.current_water_level_m IS NOT NULL
         AND wdh.station_name NOT LIKE '%Test%'
         AND DATE_FORMAT(wdh.recorded_at, '%Y-%m-%d') IN (
           SELECT recent_date FROM (
             SELECT DATE_FORMAT(recorded_at, '%Y-%m-%d') AS recent_date
             FROM tbl_water_disaster_monitoring
             WHERE current_water_level_m IS NOT NULL
               AND station_name NOT LIKE '%Test%'
             GROUP BY DATE_FORMAT(recorded_at, '%Y-%m-%d')
             ORDER BY recent_date DESC
             LIMIT 7
           ) recent_dates
         )`;
    const stationHistoryParams = startDate && endDate ? [...params] : [];

    const [waterStationHistory] = await connection.execute(`
      SELECT w.station_name,
             DATE_FORMAT(w.recorded_at, '%Y-%m-%d') AS date,
             w.current_water_level_m,
             w.current_rain_mm,
             w.forecast_rain_24h_mm AS rainfall_accum_3d_mm,
             w.trend,
             w.status,
             w.risk_level
      FROM tbl_water_disaster_monitoring w
      INNER JOIN (
        SELECT MAX(wdh.id) AS id
        FROM tbl_water_disaster_monitoring wdh
        WHERE ${stationHistoryWhere}
        GROUP BY wdh.station_name, DATE_FORMAT(wdh.recorded_at, '%Y-%m-%d')
      ) latest ON latest.id = w.id
      ORDER BY w.station_name ASC, date ASC
    `, stationHistoryParams);

    // 2. Drought
    const [droughtRows] = await connection.execute(`
      SELECT dam_name, capacity_m_cum, water_volume_m_cum, usable_water_m_cum, inflow_m_cum, discharge_m_cum, record_date 
      FROM tbl_drought_monitoring 
      WHERE id IN (SELECT MAX(id) FROM tbl_drought_monitoring ${dateFilterRec ? dateFilterRec + ' AND water_volume_m_cum IS NOT NULL' : 'WHERE water_volume_m_cum IS NOT NULL'} GROUP BY dam_name)
    `, params);
    
    const [droughtHistory] = await connection.execute(dailyDamQuery(dateFilterRec, limitClause), params);

    // 3. PM 2.5
    const [pm25Rows] = await connection.execute(`
      SELECT amphoe, station_name, pm25_value, pm25_avg_24h, air_quality_status 
      FROM tbl_pm25_monitoring 
      WHERE id IN (SELECT MAX(id) FROM tbl_pm25_monitoring ${dateFilterRec ? dateFilterRec + ' AND pm25_value IS NOT NULL' : 'WHERE pm25_value IS NOT NULL'} GROUP BY station_name)
    `, params);
    
    const [pm25History] = await connection.execute(`
      SELECT DATE_FORMAT(recorded_at, '%Y-%m-%d') as date, AVG(pm25_value) as avg_val
      FROM tbl_pm25_monitoring
      ${dateFilterRec}
      GROUP BY DATE_FORMAT(recorded_at, '%Y-%m-%d')
      ORDER BY date DESC ${limitClause}
    `, params);

    // 4. Complaints (ใช้ created_at แทน recorded_at เพราะ UPSERT อัพเดต recorded_at = NOW() ทุกรอบที่ fetch)
    const scopeFilter = 'WHERE (is_in_scope = 1 OR is_in_scope IS NULL)';
    const andScopeFilter = 'AND (is_in_scope = 1 OR is_in_scope IS NULL)';
    const complaintsWhere = dateFilterCreated ? `${dateFilterCreated} ${andScopeFilter}` : scopeFilter;
    const complaintsAndWhere = andDateFilterCreated ? `${andDateFilterCreated} ${andScopeFilter}` : andScopeFilter;

    const [complaintsState] = await connection.execute(`
      SELECT state_name, COUNT(*) as count 
      FROM tbl_complaints_monitoring 
      ${complaintsWhere}
      GROUP BY state_name
      ORDER BY count DESC
    `, params);
    
    const [complaintsType] = await connection.execute(`
      SELECT problem_type, COUNT(*) as count 
      FROM tbl_complaints_monitoring 
      ${complaintsWhere}
      GROUP BY problem_type
      ORDER BY count DESC
      LIMIT 5
    `, params);
    
    const [complaintsAgency] = await connection.execute(`
      SELECT agency_status, COUNT(*) as count 
      FROM tbl_complaints_monitoring 
      WHERE agency_status IS NOT NULL ${complaintsAndWhere}
      GROUP BY agency_status
    `, params);
    
    const [complaintsHistory] = await connection.execute(`
      SELECT DATE_FORMAT(created_at, '%Y-%m-%d') as date, COUNT(*) as daily_count
      FROM tbl_complaints_monitoring
      WHERE created_at IS NOT NULL ${complaintsAndWhere}
      GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')
      ORDER BY date DESC ${limitClause}
    `, params);

    res.json({
      success: true,
      definitions: DATA_DEFINITIONS,
      data: {
        water: { current: waterRows, history: waterHistory.reverse(), stationHistory: waterStationHistory },
        drought: { current: droughtRows, history: droughtHistory.reverse() },
        pm25: { current: pm25Rows, history: pm25History.reverse() },
        complaints: {
          state: complaintsState,
          type: complaintsType,
          agency: complaintsAgency,
          history: complaintsHistory.reverse()
        }
      }
    });
  } catch (error) {
    console.error("Dashboard API Error:", error);
    res.status(500).json({ error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Helper to get real calendar week bounds of a month containing refDate
function getCalendarWeekBounds(refDate) {
  const year = refDate.getFullYear();
  const month = refDate.getMonth();
  
  const startOfMonth = new Date(year, month, 1);
  const endOfMonth = new Date(year, month + 1, 0);
  
  const weeks = [];
  let currentStart = new Date(startOfMonth);
  
  while (currentStart <= endOfMonth) {
    let currentEnd = new Date(currentStart);
    const day = currentEnd.getDay();
    const daysToSunday = day === 0 ? 0 : 7 - day;
    currentEnd.setDate(currentEnd.getDate() + daysToSunday);
    
    if (currentEnd > endOfMonth) {
      currentEnd = new Date(endOfMonth);
    }
    
    weeks.push({
      start: new Date(currentStart),
      end: new Date(currentEnd)
    });
    
    currentStart = new Date(currentEnd);
    currentStart.setDate(currentStart.getDate() + 1);
  }
  
  const refTime = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate()).getTime();
  
  for (let i = 0; i < weeks.length; i++) {
    const week = weeks[i];
    const weekStartTime = new Date(week.start.getFullYear(), week.start.getMonth(), week.start.getDate()).getTime();
    const weekEndTime = new Date(week.end.getFullYear(), week.end.getMonth(), week.end.getDate()).getTime();
    if (refTime >= weekStartTime && refTime <= weekEndTime) {
      return { ...week, weekIndex: i + 1 };
    }
  }
  
  return { start: startOfMonth, end: endOfMonth, weekIndex: 1 };
}

// ============================================================
// 📊 DATA REPORT API — ดึงข้อมูลรายวัน / รายสัปดาห์ / รายเดือน
// ============================================================
app.get('/api/report-data', async (req, res) => {
  let connection;
  try {
    const { project = 'all', period = 'daily', date, startDate: queryStart, endDate: queryEnd } = req.query;
    
    let startDate, endDate;
    let weekInfo = '';
    
    if (queryStart && queryEnd) {
      startDate = new Date(queryStart + 'T00:00:00');
      endDate = new Date(queryEnd + 'T23:59:59');
      
      if (period === 'weekly') {
        const bounds = getCalendarWeekBounds(startDate);
        const thaiMonths = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
        weekInfo = `สัปดาห์ที่ ${bounds.weekIndex} ของ${thaiMonths[startDate.getMonth()]} ${startDate.getFullYear() + 543}`;
      }
    } else {
      // Fallback: Calculate date range based on period and single date parameter
      const refDate = date ? new Date(date + 'T00:00:00') : new Date();
      if (period === 'daily') {
        startDate = new Date(refDate);
        endDate = new Date(refDate);
      } else if (period === 'weekly') {
        const bounds = getCalendarWeekBounds(refDate);
        startDate = bounds.start;
        endDate = bounds.end;
        const thaiMonths = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
        weekInfo = `สัปดาห์ที่ ${bounds.weekIndex} ของ${thaiMonths[refDate.getMonth()]} ${refDate.getFullYear() + 543}`;
      } else if (period === 'monthly') {
        startDate = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
        endDate = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0);
      } else {
        return res.status(400).json({ error: 'Invalid period. Use: daily, weekly, monthly' });
      }
    }
    
    const formatDate = (d) => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };
    
    const startStr = formatDate(startDate);
    const endStr = formatDate(endDate);
    const dateParams = [`${startStr} 00:00:00`, `${endStr} 23:59:59`];
    
    connection = await pool.getConnection();
    const result = { water: null, drought: null, pm25: null, complaints: null };
    
    // --- Water Level ---
    if (project === 'all' || project === 'water') {
      try {
        const [rows] = await connection.execute(
          `SELECT station_name, river, amphoe, province, current_water_level_m, left_bank_level_m, 
                  bank_difference_m, trend, status, current_rain_mm, forecast_rain_24h_mm, risk_level, 
                  DATE_FORMAT(recorded_at, '%Y-%m-%d %H:%i:%s') as recorded_at
           FROM tbl_water_disaster_monitoring 
           WHERE recorded_at BETWEEN ? AND ? AND station_name NOT LIKE '%Test%'
           ORDER BY recorded_at DESC`,
          dateParams
        );
        
        // Summary
        const totalStations = new Set(rows.map(r => r.station_name)).size;
        const waterLevels = rows.map(r => parseFloat(r.current_water_level_m)).filter(v => !isNaN(v));
        const rainValues = rows.map(r => parseFloat(r.current_rain_mm)).filter(v => !isNaN(v));
        const riskCounts = {};
        rows.forEach(r => {
          if (r.risk_level) riskCounts[r.risk_level] = (riskCounts[r.risk_level] || 0) + 1;
        });
        
        result.water = {
          rows: rows,
          summary: {
            totalRecords: rows.length,
            totalStations: totalStations,
            avgWaterLevel: waterLevels.length ? (waterLevels.reduce((a, b) => a + b, 0) / waterLevels.length).toFixed(2) : 'N/A',
            maxWaterLevel: waterLevels.length ? Math.max(...waterLevels).toFixed(2) : 'N/A',
            minWaterLevel: waterLevels.length ? Math.min(...waterLevels).toFixed(2) : 'N/A',
            avgRainfall: rainValues.length ? (rainValues.reduce((a, b) => a + b, 0) / rainValues.length).toFixed(2) : 'N/A',
            riskCounts: riskCounts
          }
        };
      } catch (e) {
        result.water = { rows: [], summary: { error: e.message } };
      }
    }

    // --- Rainfall ---
    if (project === 'all' || project === 'water') {
      try {
        const [rows] = await connection.execute(
          `SELECT station_name, location, river_basin, rain_mm, rain_status, measured_time, 
                  DATE_FORMAT(recorded_at, '%Y-%m-%d %H:%i:%s') as recorded_at
           FROM tbl_rainfall_monitoring 
           WHERE recorded_at BETWEEN ? AND ?
           ORDER BY recorded_at DESC`,
          dateParams
        );
        
        const totalStations = new Set(rows.map(r => r.station_name)).size;
        const rainValues = rows.map(r => parseFloat(r.rain_mm)).filter(v => !isNaN(v));
        
        result.rainfall = {
          rows: rows,
          summary: {
            totalRecords: rows.length,
            totalStations: totalStations,
            avgRainfall: rainValues.length ? (rainValues.reduce((a, b) => a + b, 0) / rainValues.length).toFixed(2) : 'N/A',
            maxRainfall: rainValues.length ? Math.max(...rainValues).toFixed(2) : 'N/A',
            minRainfall: rainValues.length ? Math.min(...rainValues).toFixed(2) : 'N/A'
          }
        };
      } catch (e) {
        result.rainfall = { rows: [], summary: { error: e.message } };
      }
    }
    
    // --- Drought ---
    if (project === 'all' || project === 'drought') {
      try {
        const [rows] = await connection.execute(
          `SELECT dam_name, dam_type, capacity_m_cum, inflow_m_cum, water_volume_m_cum, 
                  water_percent, usable_water_m_cum, discharge_m_cum, record_date,
                  DATE_FORMAT(recorded_at, '%Y-%m-%d %H:%i:%s') as recorded_at
           FROM tbl_drought_monitoring 
           WHERE recorded_at BETWEEN ? AND ?
           ORDER BY recorded_at DESC`,
          dateParams
        );
        
        const totalDams = new Set(rows.map(r => r.dam_name)).size;
        const volumes = rows.map(r => parseFloat(r.water_volume_m_cum)).filter(v => !isNaN(v));
        const capacities = rows.map(r => parseFloat(r.capacity_m_cum)).filter(v => !isNaN(v));
        
        result.drought = {
          rows: rows,
          summary: {
            totalRecords: rows.length,
            totalDams: totalDams,
            totalVolume: volumes.length ? volumes.reduce((a, b) => a + b, 0).toFixed(2) : 'N/A',
            totalCapacity: capacities.length ? capacities.reduce((a, b) => a + b, 0).toFixed(2) : 'N/A',
            avgVolumePercent: (volumes.length && capacities.length) ? ((volumes.reduce((a, b) => a + b, 0) / capacities.reduce((a, b) => a + b, 0)) * 100).toFixed(1) : 'N/A'
          }
        };
      } catch (e) {
        result.drought = { rows: [], summary: { error: e.message } };
      }
    }
    
    // --- PM 2.5 ---
    if (project === 'all' || project === 'pm25') {
      try {
        const [rows] = await connection.execute(
          `SELECT station_name, tambon, amphoe, province, time_label, pm25_value, 
                  pm25_avg_24h, air_quality_status, record_date,
                  DATE_FORMAT(recorded_at, '%Y-%m-%d %H:%i:%s') as recorded_at
           FROM tbl_pm25_monitoring 
           WHERE recorded_at BETWEEN ? AND ?
           ORDER BY recorded_at DESC`,
          dateParams
        );
        
        const totalStations = new Set(rows.map(r => r.station_name)).size;
        const pm25Vals = rows.map(r => parseFloat(r.pm25_value)).filter(v => !isNaN(v));
        const statusCounts = {};
        rows.forEach(r => {
          if (r.air_quality_status) statusCounts[r.air_quality_status] = (statusCounts[r.air_quality_status] || 0) + 1;
        });
        
        result.pm25 = {
          rows: rows,
          summary: {
            totalRecords: rows.length,
            totalStations: totalStations,
            avgPm25: pm25Vals.length ? (pm25Vals.reduce((a, b) => a + b, 0) / pm25Vals.length).toFixed(1) : 'N/A',
            maxPm25: pm25Vals.length ? Math.max(...pm25Vals).toFixed(1) : 'N/A',
            minPm25: pm25Vals.length ? Math.min(...pm25Vals).toFixed(1) : 'N/A',
            statusCounts: statusCounts
          }
        };
      } catch (e) {
        result.pm25 = { rows: [], summary: { error: e.message } };
      }
    }
    
    // --- Complaints ---
    if (project === 'all' || project === 'complaints') {
      try {
        // ใช้ created_at แทน recorded_at เพราะ UPSERT อัพเดต recorded_at = NOW() ทุกรอบที่ fetch ข้อมูล
        // created_at (TIMESTAMP DEFAULT CURRENT_TIMESTAMP) จะถูกตั้งค่าครั้งเดียวตอน INSERT แรกเท่านั้น
        const [rows] = await connection.execute(
          `SELECT ticket_id, state_name, problem_type, description, org_name, 
                  agency_status, ticket_datetime, satisfaction_stars, photo_url, location,
                  DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as recorded_at
           FROM tbl_complaints_monitoring 
           WHERE created_at BETWEEN ? AND ? AND (is_in_scope = 1 OR is_in_scope IS NULL)
           ORDER BY created_at DESC`,
          dateParams
        );
        
        const stateCounts = {};
        const typeCounts = {};
        rows.forEach(r => {
          if (r.state_name) stateCounts[r.state_name] = (stateCounts[r.state_name] || 0) + 1;
          if (r.problem_type) typeCounts[r.problem_type] = (typeCounts[r.problem_type] || 0) + 1;
        });
        
        // Determine top problem type
        let topProblem = 'ไม่มีข้อมูล';
        let topCount = 0;
        Object.entries(typeCounts).forEach(([k, v]) => {
          if (v > topCount) { topProblem = k; topCount = v; }
        });
        
        result.complaints = {
          rows: rows,
          summary: {
            totalRecords: rows.length,
            stateCounts: stateCounts,
            topProblemType: topProblem,
            topProblemCount: topCount,
            resolvedCount: rows.filter(r => r.state_name && r.state_name.includes('เสร็จ')).length,
            pendingCount: rows.filter(r => r.state_name && !r.state_name.includes('เสร็จ')).length
          }
        };
      } catch (e) {
        result.complaints = { rows: [], summary: { error: e.message } };
      }
    }
    
    // Count total records across all returned projects
    let totalRecords = 0;
    Object.values(result).forEach(v => {
      if (v && v.rows) totalRecords += v.rows.length;
    });
    
    res.json({
      success: true,
      meta: {
        project,
        period,
        dateRange: { start: startStr, end: endStr },
        weekInfo,
        totalRecords
      },
      data: result
    });
    
  } catch (error) {
    console.error("Report API Error:", error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

app.post('/api/force-fetch', (req, res) => {
  triggerDataFetch('excel');
  res.json({ success: true, message: 'Triggered Excel Fetch' });
});

app.post('/api/force-fetch-db', (req, res) => {
  triggerDataFetch('db');
  res.json({ success: true, message: 'Triggered DB Fetch' });
});

app.post('/api/force-fetch-rainfall-db', (req, res) => {
  triggerRainfallFetch('db');
  res.json({ success: true, message: 'Triggered Rainfall DB Fetch' });
});

app.post('/api/force-fetch-drought-excel', (req, res) => {
  triggerDroughtDataFetch('excel');
  res.json({ success: true, message: 'Triggered Drought Excel Fetch' });
});

app.post('/api/force-fetch-drought-db', (req, res) => {
  triggerDroughtDataFetch('db');
  res.json({ success: true, message: 'Triggered Drought DB Fetch' });
});

app.post('/api/schedule', (req, res) => {
  const { tasks } = req.body;
  if (Array.isArray(tasks)) {
    scheduledTasks = tasks.sort(); // Sort chronologically
    saveConfig();
    console.log(`Schedule updated:`, scheduledTasks);
    addLog('System', `⚙️ อัปเดตตารางเวลาใหม่: ${scheduledTasks.join(', ') || 'ไม่มี'}`);
    res.json({ success: true, tasks: scheduledTasks });
  } else {
    res.status(400).json({ error: 'Invalid tasks array' });
  }
});

app.post('/api/schedule/toggle', (req, res) => {
  const { project, active } = req.body;
  if (project && isScheduleActive.hasOwnProperty(project)) {
    isScheduleActive[project] = active;
    saveConfig();
    const pNames = { water: 'ระดับน้ำ', drought: 'ภัยแล้ง', pm25: 'PM 2.5', complaints: 'ร้องเรียน' };
    addLog('System', active ? `⏰ เปิดระบบดึงข้อมูลอัตโนมัติ: ${pNames[project]}` : `⏸️ ปิดระบบดึงข้อมูลอัตโนมัติ: ${pNames[project]}`);
  } else if (req.body.active !== undefined && !project) {
    const act = req.body.active;
    isScheduleActive = { water: act, drought: act, pm25: act, complaints: act };
    saveConfig();
    addLog('System', act ? `⏰ เปิดระบบดึงข้อมูลอัตโนมัติทั้งหมด` : `⏸️ ปิดระบบดึงข้อมูลอัตโนมัติทั้งหมด`);
  }
  
  res.json({ success: true, isScheduleActive });
});

app.get('/api/status', async (req, res) => {
  try {
    const [storageStats, authData] = await Promise.all([getSystemStorageStats(), auth.store.read()]);
    const extensionPaired = authData.devices.some(device => !device.revoked);
    res.json({
      extensionConnected,
      extensionPaired,
      scheduledTasks,
      isScheduleActive,
      lastFetch: global.lastDataReceived ? formatISODatetime(new Date(global.lastDataReceived)) : 'ยังไม่เคยบันทึก',
      logs: logs,
      projectStats,
      completedTasks,
      storageStats
    });
  } catch (error) {
    console.error("Error in status endpoint:", error);
    res.json({
      extensionConnected,
      extensionPaired: false,
      scheduledTasks,
      isScheduleActive,
      lastFetch: global.lastDataReceived ? formatISODatetime(new Date(global.lastDataReceived)) : 'ยังไม่เคยบันทึก',
      logs: logs,
      projectStats,
      completedTasks,
      storageStats: {
        waterLevel: { dbRows: 'Error', excelExists: false, excelSize: '0 KB', excelMtime: 'N/A' },
        drought: { dbRows: 'Error', excelExists: false, excelSize: '0 KB', excelMtime: 'N/A' },
        pm25: { dbRows: 'Error', excelExists: false, excelSize: '0 KB', excelMtime: 'N/A' },
        complaints: { dbRows: 'Error', excelExists: false, excelSize: '0 KB', excelMtime: 'N/A' }
      }
    });
  }
});

// Ping endpoint to keep connection state alive and accurate
app.post('/api/ping', (req, res) => {
  if (req.user.device) {
    lastPingTimestamp = Date.now();
    lastExtensionActivity = Date.now();
    extensionConnected = true;
  }
  res.json({ ok: true, timestamp: lastPingTimestamp, activeSockets: activeExtensionSockets.size });
});

// Chrome can throttle content-script timers or suspend an MV3 worker. Mark it
// offline only when Socket.IO and the authenticated HTTP heartbeat are both stale.
const extensionHealthTimer = setInterval(() => {
  const now = Date.now();
  const latestActivity = Math.max(lastExtensionActivity, lastPingTimestamp);
  const healthy = activeExtensionSockets.size > 0
    || (latestActivity > 0 && now - latestActivity <= EXTENSION_OFFLINE_GRACE_MS);
  if (healthy) {
    extensionConnected = true;
    return;
  }
  if (extensionConnected) {
    extensionConnected = false;
    extensionSocketId = null;
    addLog('Node.js', '❌ Chrome Extension ขาดการติดต่อเกิน 90 วินาที');
    fetchLogToFile('❌ Chrome Extension ขาดการติดต่อเกิน 90 วินาที');
  }
}, 10000);
extensionHealthTimer.unref();



// ============================================================
// 🔔 NOTIFICATION MODULE API ENDPOINTS
// ============================================================

// Get notification history
app.get('/api/notifications', async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const [notifications] = await connection.execute(
      'SELECT * FROM tbl_alert_notifications ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
    res.json({ success: true, notifications });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Get notification stats
app.get('/api/notifications/stats', async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    
    // Today stats
    const [todayRows] = await connection.execute(
      `SELECT 
        COUNT(*) as total,
        SUM(alert_level = 'critical') as critical,
        SUM(alert_level = 'warning') as warning,
        SUM(alert_level = 'info') as info,
        SUM(email_status = 'sent') as sent,
        SUM(email_status = 'failed') as failed
       FROM tbl_alert_notifications 
       WHERE DATE(created_at) = CURDATE()`
    );
    
    // This month stats
    const [monthRows] = await connection.execute(
      `SELECT COUNT(*) as total, SUM(email_status = 'sent') as sent
       FROM tbl_alert_notifications 
       WHERE YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())`
    );
    
    res.json({
      success: true,
      stats: {
        today: todayRows[0] || {},
        month: monthRows[0] || {}
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Get notification config
app.get('/api/notifications/config', (req, res) => {
  res.json({
    success: true,
    config: {
      enabled: notificationConfig.enabled,
      alertActive: notificationConfig.alertActive,
      cooldownMinutes: notificationConfig.cooldownMinutes,
      smtp: {
        host: notificationConfig.smtp?.host || '',
        port: notificationConfig.smtp?.port || 587,
        user: notificationConfig.smtp?.user || '',
        pass: notificationConfig.smtp?.pass ? '********' : ''
      }
    }
  });
});

// Get recipients
app.get('/api/notifications/recipients', async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [recipients] = await connection.execute('SELECT * FROM tbl_alert_recipients ORDER BY id ASC');
    res.json({ success: true, recipients });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Add or Update recipient
app.post('/api/notifications/recipients', async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const { id, name, position, email, alert_level_min, is_active, notify_water, notify_drought, notify_pm25, notify_complaints } = req.body;
    
    if (id) {
      // Dynamic Partial Update if only toggling specific fields (like is_active)
      const fields = [];
      const values = [];

      if (name !== undefined) { fields.push('name = ?'); values.push(name); }
      if (position !== undefined) { fields.push('position = ?'); values.push(position); }
      if (email !== undefined) { fields.push('email = ?'); values.push(email); }
      if (alert_level_min !== undefined) { fields.push('alert_level_min = ?'); values.push(alert_level_min); }
      if (is_active !== undefined) { fields.push('is_active = ?'); values.push(is_active); }
      if (notify_water !== undefined) { fields.push('notify_water = ?'); values.push(notify_water); }
      if (notify_drought !== undefined) { fields.push('notify_drought = ?'); values.push(notify_drought); }
      if (notify_pm25 !== undefined) { fields.push('notify_pm25 = ?'); values.push(notify_pm25); }
      if (notify_complaints !== undefined) { fields.push('notify_complaints = ?'); values.push(notify_complaints); }

      if (fields.length > 0) {
        values.push(id);
        await connection.execute(
          `UPDATE tbl_alert_recipients SET ${fields.join(', ')} WHERE id = ?`,
          values
        );
        addLog('Notification', `✏️ อัปเดตผู้รับแจ้งเตือน ID ${id}: ${name || ('สถานะ is_active=' + is_active)}`);
      }
    } else {
      // Insert new
      await connection.execute(
        `INSERT INTO tbl_alert_recipients (name, position, email, alert_level_min, is_active, notify_water, notify_drought, notify_pm25, notify_complaints) VALUES (?,?,?,?,?,?,?,?,?)`,
        [name, position, email, alert_level_min || 'warning', is_active !== undefined ? is_active : 1, notify_water ?? 1, notify_drought ?? 1, notify_pm25 ?? 1, notify_complaints ?? 1]
      );
      addLog('Notification', `➕ เพิ่มผู้รับแจ้งเตือนใหม่: ${name} <${email}>`);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) connection.release();
  }
});


// Delete recipient
app.delete('/api/notifications/recipients/:id', async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.execute('DELETE FROM tbl_alert_recipients WHERE id = ?', [req.params.id]);
    addLog('Notification', `🗑️ ลบผู้รับแจ้งเตือน ID: ${req.params.id}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Toggle alert type
app.post('/api/notifications/toggle', (req, res) => {
  const { type, active } = req.body;
  if (type && notificationConfig.alertActive.hasOwnProperty(type)) {
    notificationConfig.alertActive[type] = active;
    saveConfig();
    const typeNames = { water: 'ระดับน้ำ/ฝน', rainfall: 'ปริมาณฝน', drought: 'ภัยแล้ง', pm25: 'PM 2.5', complaints: 'ร้องเรียน' };
    addLog('Notification', active ? `🔔 เปิดแจ้งเตือน: ${typeNames[type]}` : `🔕 ปิดแจ้งเตือน: ${typeNames[type]}`);
  }
  res.json({ success: true, alertActive: notificationConfig.alertActive });
});

// Check and notify now (manual trigger)
app.post('/api/notifications/check-now', async (req, res) => {
  try {
    addLog('Notification', '🔍 เจ้าหน้าที่สั่งตรวจสอบเกณฑ์แจ้งเตือนด้วยตนเอง (ส่งทันที)...');
    const result = await checkAndNotify(pool, addLog, notificationConfig, true);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// Send test email
app.post('/api/notifications/test', async (req, res) => {
  try {
    addLog('Notification', '📧 กำลังส่ง Test Email...');
    const result = await sendTestEmail(notificationConfig.smtp, req.body.email, pool);
    if (result.success) {
      addLog('Notification', `✅ ส่ง Test Email สำเร็จ → ${result.sentTo}`);
    } else {
      addLog('Notification', `❌ ส่ง Test Email ล้มเหลว: ${result.error}`);
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Save SMTP credentials from UI
app.post('/api/notifications/smtp', (req, res) => {
  const { user, pass } = req.body;
  if (!user || !pass) {
    return res.status(400).json({ success: false, error: 'กรุณาระบุ user และ pass' });
  }
  const cleanUser = user.trim().toLowerCase();
  const cleanPass = pass.replace(/\s+/g, '');

  notificationConfig.smtp = {
    ...notificationConfig.smtp,
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    user: cleanUser,
    pass: cleanPass
  };
  saveConfig();
  addLog('Notification', `📧 บันทึก SMTP credentials ใหม่: ${cleanUser}`);
  res.json({ success: true, user: cleanUser });
});


// ============================================================
// 🛡️ DATA GAP CHECK API — ตรวจสอบวันที่ข้อมูลหายไป
// ============================================================
app.get('/api/data-gap-check', async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const { days = 30 } = req.query;
    const daysNum = Math.max(1, Math.min(parseInt(days) || 30, 365));

    const tables = [
      { name: 'water', table: 'tbl_water_disaster_monitoring' },
      { name: 'rainfall', table: 'tbl_rainfall_monitoring' },
      { name: 'drought', table: 'tbl_drought_monitoring' },
      { name: 'pm25', table: 'tbl_pm25_monitoring' },
      { name: 'complaints', table: 'tbl_complaints_monitoring' }
    ];

    const result = {};

    for (const { name, table } of tables) {
      try {
        const [rows] = await connection.execute(
          `SELECT DATE_FORMAT(recorded_at, '%Y-%m-%d') as date, COUNT(*) as count
           FROM ${table}
           WHERE recorded_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
           GROUP BY DATE_FORMAT(recorded_at, '%Y-%m-%d')
           ORDER BY date ASC`,
          [daysNum]
        );

        // Find missing dates
        const recordedDates = new Set(rows.map(r => r.date));
        const checkedDates = recentDates(daysNum);
        const missingDates = checkedDates.filter(date => !recordedDates.has(date));

        result[name] = {
          totalDaysChecked: daysNum,
          daysWithData: checkedDates.length - missingDates.length,
          daysWithoutData: missingDates.length,
          missingDates: missingDates,
          dailyCounts: rows
        };
      } catch (e) {
        result[name] = { error: e.message };
      }
    }

    res.json({ success: true, checkPeriodDays: daysNum, gaps: result });
  } catch (error) {
    console.error("Data Gap Check Error:", error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// Start Schedule Checker
let isRunningSequentialTasks = false;
const pendingScheduledMinutes = new Set();
const completedScheduledMinutes = new Set();

function startScheduleChecker() {
  if (scheduleCheckerInterval) clearInterval(scheduleCheckerInterval);
  // Recover a slot missed while the server was starting (up to ten minutes).
  const startedAt = new Date();
  const today = formatISODatetime(startedAt).slice(0, 10);
  for (const slot of scheduledTasks) {
    const [hour, minute] = slot.split(':').map(Number);
    const due = new Date(startedAt);
    due.setHours(hour, minute, 0, 0);
    if (startedAt >= due && startedAt - due <= 10 * 60 * 1000) pendingScheduledMinutes.add(`${today} ${slot}`);
  }
  scheduleCheckerInterval = setInterval(async () => {
    if (!isScheduleActive.water && !isScheduleActive.drought && !isScheduleActive.pm25 && !isScheduleActive.complaints) return;
    
    const now = new Date();
    const currentMinuteStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    
    const todayKey = formatISODatetime(now).slice(0, 10);
    const currentKey = `${todayKey} ${currentMinuteStr}`;
    if (scheduledTasks.includes(currentMinuteStr) && !completedScheduledMinutes.has(currentKey)) pendingScheduledMinutes.add(currentKey);
    if (isRunningSequentialTasks || pendingScheduledMinutes.size === 0) return;
    const slotKey = [...pendingScheduledMinutes].sort()[0];
    pendingScheduledMinutes.delete(slotKey);
    completedScheduledMinutes.add(slotKey);
    const scheduledMinute = slotKey.slice(11);
    if (slotKey.slice(0, 10) !== todayKey) return;
    {
      lastTriggeredMinute = slotKey;
      
      isRunningSequentialTasks = true;
      addLog('System', `🔔 ถึงเวลาเก็บข้อมูลตามตาราง: ${scheduledMinute} (เริ่มทำงานแบบต่อเนื่องทีละโปรเจค)`);
      
      try {
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        const waitForScrape = async (triggerTime, getLastDataReceivedFn, timeoutMs) => {
          const startTime = Date.now();
          while (Date.now() - startTime < timeoutMs) {
            if (getLastDataReceivedFn() > triggerTime) return true;
            await sleep(2000);
          }
          throw new Error('หมดเวลารอการบันทึกข้อมูล งานรอบนี้ไม่สำเร็จ');
        };
        const stageErrors = [];
        const runStage = async (name, trigger, lastSaved, timeoutMs) => {
          addLog('System', `⏱️ ${name}`);
          try {
            const triggerTime = Date.now();
            await trigger();
            if (timeoutMs) await waitForScrape(triggerTime, lastSaved, timeoutMs);
          } catch (error) {
            stageErrors.push(`${name}: ${error.message}`);
            addLog('System', `❌ ${name}: ${error.message}`);
          }
          await sleep(5000);
        };

        if (isScheduleActive.water) {
          await runStage('[1/4] Triggering Water Level & Rainfall scraper', () => triggerDataFetch('db'), () => global.lastWLDataReceived || 0, 330000);
        }
        
        if (isScheduleActive.drought) {
          await runStage('[2/4] Triggering Drought/Dam scraper', () => triggerDroughtDataFetch('db'), () => global.lastDroughtDataReceived || 0, 250000);
        }
        
        if (isScheduleActive.pm25) {
          await runStage('[3/4] Triggering PM 2.5 scraper', () => triggerPM25DataFetch('db'), () => global.lastPM25DataReceived || 0, 220000);
        }

        if (isScheduleActive.complaints) {
          await runStage('[4/4] Triggering Complaints scraper', () => triggerComplaintsDataFetch('db'), () => global.lastComplaintsDataReceived || 0, 0);
        }
        
        addLog('System', stageErrors.length ? `⚠️ รอบ ${scheduledMinute} เสร็จสิ้นโดยมีข้อผิดพลาด: ${stageErrors.join('; ')}` : '✅ ทำงานตามตารางเวลารอบนี้เสร็จสิ้นทุกโปรเจคแล้ว ไม่มีการซ้อนทับ');
        
        // 🔔 Hook: ตรวจเกณฑ์แจ้งเตือนหลัง scrape เสร็จทุกรอบ
        if (notificationConfig.enabled) {
          try {
            addLog('Notification', '🔔 กำลังตรวจสอบเกณฑ์แจ้งเตือนอัตโนมัติ...');
            await checkAndNotify(pool, addLog, notificationConfig);
          } catch (notifErr) {
            addLog('Notification', `⚠️ ระบบแจ้งเตือนอัตโนมัติล้มเหลว (ไม่กระทบ scraper): ${notifErr.message}`);
          }
        }
      } catch (err) {
        addLog('System', `❌ Error in sequential scheduled tasks: ${err.message}`);
      } finally {
        isRunningSequentialTasks = false;
      }
    }
  }, 10000); // Check every 10 seconds to be safe
}
if (process.env.WATER_DISABLE_AUTOMATION !== '1') startScheduleChecker();

// Resource Cleanup (every 30 mins)
setInterval(() => {
  addLog('System', '🧹 กำลังล้างทรัพยากรระบบและคืนหน่วยความจำ (Resource Cleanup)...');
  if (global.gc) {
    global.gc();
  }
}, 30 * 60 * 1000);

// ============================================================
// 🏥 MySQL Pool Health Check (every 5 mins)
// ============================================================
setInterval(async () => {
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
  } catch (error) {
    addLog('HealthCheck', `⚠️ MySQL Pool health check ล้มเหลว: ${error.message}`);
    fetchLogToFile(`⚠️ MySQL Pool health check failed: ${error.message}`);
  }
}, 5 * 60 * 1000);

// ============================================================
// 🛡️ Graceful Shutdown
// ============================================================
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  addLog('System', `\n🛑 ได้รับสัญญาณ ${signal} - กำลังปิดระบบอย่างปลอดภัย...`);
  fetchLogToFile(`🛑 Graceful Shutdown initiated: ${signal}`);
  
  // 1. Stop accepting new connections
  if (scheduleCheckerInterval) {
    clearInterval(scheduleCheckerInterval);
    addLog('System', '⏹️ หยุด Schedule Checker');
  }
  
  // 2. Close HTTP server
  server.close(() => {
    addLog('System', '⏹️ ปิด HTTP Server');
  });
  
  await ingestion.drain();
  await excelOutbox.close();
  await excelRepository.drain();
  io.close();

  // 3. Close MySQL pool
  try {
    await pool.end();
    addLog('System', '⏹️ ปิด MySQL Connection Pool');
  } catch (err) {
    addLog('System', `⚠️ ไม่สามารถปิด MySQL Pool: ${err.message}`);
  }
  
  addLog('System', '✅ ระบบปิดตัวอย่างปลอดภัยเรียบร้อยแล้ว');
  fetchLogToFile('✅ ระบบปิดตัวอย่างปลอดภัยเรียบร้อยแล้ว');
  
  process.exit(0);
}

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('Request failed:', error.message);
  res.status(error.status >= 400 && error.status < 500 ? error.status : 500).json({ success: false, error: 'ไม่สามารถทำรายการได้ กรุณาตรวจข้อมูลหรือประวัติระบบ' });
});

// Handle termination signals
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught errors (log and continue, don't crash unless fatal)
process.on('uncaughtException', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`🚨 Port ${PORT} ถูกใช้งานอยู่แล้ว! ไม่สามารถรันเซิร์ฟเวอร์ซ้อนกันได้`);
    fetchLogToFile(`🚨 Uncaught Exception EADDRINUSE: ${error.message}`);
    process.exit(1);
  }
  addLog('System', `🚨 Uncaught Exception (ระบบยังทำงานต่อ): ${error.message}`);
  fetchLogToFile(`🚨 Uncaught Exception: ${error.stack || error.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  addLog('System', `🚨 Unhandled Rejection (ระบบยังทำงานต่อ): ${message}`);
  fetchLogToFile(`🚨 Unhandled Rejection: ${message}`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`🚨 เกิดข้อผิดพลาด: Port ${PORT} ถูกใช้งานอยู่แล้ว! กรุณาตรวจสอบหรือปิดโปรแกรมอื่นที่ใช้ Port นี้`);
    fetchLogToFile(`🚨 Server Error EADDRINUSE: ${error.message}`);
    process.exit(1);
  } else {
    addLog('System', `🚨 Server Error: ${error.message}`);
    fetchLogToFile(`🚨 Server Error: ${error.stack || error.message}`);
  }
});

server.listen(PORT, process.env.HOST || '127.0.0.1', async () => {
  if (await auth.needsSetup()) console.log(`First administrator setup (local machine only): http://localhost:${PORT}/setup.html#${auth.bootstrap}`);
  addLog('System', `🚀 Node.js Server เริ่มทำงานที่ Port ${PORT}`);
  addLog('System', 'รอการเชื่อมต่อจาก Google Chrome Extension...');
  addLog('System', '🛡️ ระบบบริหารความเสี่ยงพร้อมทำงาน (Dual-Write, Retry, Internet Check, DB Fallback, Graceful Shutdown)');
});
