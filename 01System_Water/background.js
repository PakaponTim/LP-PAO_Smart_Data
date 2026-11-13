const THAIWATER_URL = 'https://lampang.thaiwater.net/';
const TRAFFY_URL = 'https://citydata.traffy.in.th/';

async function sendServerHeartbeat() {
  const config = await chrome.storage.local.get(['waterServer', 'waterDeviceToken']);
  if (!config.waterDeviceToken) return;
  const server = (!config.waterServer || /:3000(?=\/|$)/.test(config.waterServer)) ? 'http://localhost:7000' : config.waterServer;
  await fetch(server + '/api/ping', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.waterDeviceToken}` },
    credentials: 'omit'
  });
}

chrome.alarms.create('waterServerHeartbeat', { periodInMinutes: 0.5 });

chrome.commands.onCommand.addListener((command) => {
  if (command === "extract-dom") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) return;
      if (tabs && tabs.length > 0 && (tabs[0].url.includes("lampang.thaiwater.net") || tabs[0].url.includes("citydata.traffy.in.th"))) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "extract_dom_shortcut" }, () => {
          if (chrome.runtime.lastError) {}
        });
      }
    });
  }
});

// ตรวจสอบว่ามีแท็บ ThaiWater และ Traffy เปิดอยู่หรือไม่ ถ้าไม่มีก็เปิดให้
async function ensureSourceTabsOpen() {
  try {
    const twTabs = await chrome.tabs.query({ url: '*://lampang.thaiwater.net/*' });
    if (twTabs.length === 0) {
      console.log('⚠️ ไม่พบแท็บ ThaiWater กำลังเปิดให้อัตโนมัติ...');
      await chrome.tabs.create({ url: THAIWATER_URL, active: true });
    }
  } catch (err) {
    console.log('ensureSourceTabsOpen caught:', err);
  }
  return 'checked_all';
}

// เมื่อ Extension เริ่มทำงาน ให้ตรวจสอบแท็บและตั้งเวลา (Alarm)
chrome.runtime.onStartup.addListener(() => {
  ensureSourceTabsOpen().catch(() => {});
  chrome.alarms.create("checkTabAlarm", { periodInMinutes: 5 });
});

chrome.runtime.onInstalled.addListener(() => {
  ensureSourceTabsOpen().catch(() => {});
  
  // โหลดหน้าเว็บใหม่เมื่อ Extension โดน Refresh ป้องกันปัญหา Orphaned Content Script
  chrome.tabs.query({ url: '*://lampang.thaiwater.net/*' }, (tabs) => {
    if (chrome.runtime.lastError) return;
    if (tabs) tabs.forEach(tab => chrome.tabs.reload(tab.id, {}, () => { if (chrome.runtime.lastError) {} }));
  });

  chrome.alarms.create("checkTabAlarm", { periodInMinutes: 5 });
});

// ตรวจสอบแท็บเมื่อถึงเวลา (ตื่นจาก Sleep) เพื่อประหยัดทรัพยากร
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'waterServerHeartbeat') {
    sendServerHeartbeat().catch(() => {});
    return;
  }
  if (alarm.name === "checkTabAlarm") {
    ensureSourceTabsOpen().catch(() => {});
  }
});

// รับคำสั่งจาก content.js ให้ reload แท็บ หรือ navigate ไปที่แท็บ
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;

  if (message.action === 'navigate_and_scrape') {
    const mode = message.mode || 'excel';
    const targetUrl = message.url || 'https://lampang.thaiwater.net/dam';
    const isTraffy = targetUrl.includes('traffy.in.th');
    const queryPattern = isTraffy ? '*://citydata.traffy.in.th/*' : '*://lampang.thaiwater.net/*';
    
    chrome.tabs.query({ url: queryPattern }, (tabs) => {
      if (chrome.runtime.lastError) {
        sendResponse({ status: 'error' });
        return;
      }
      if (tabs && tabs.length > 0) {
        const tabId = tabs[0].id;
        const windowId = tabs[0].windowId;
        chrome.storage.local.set({ 
          pendingScrape: { mode: mode, rainfallOnly: message.rainfallOnly || false, timestamp: Date.now() } 
        }, () => {
          sendResponse({ status: 'navigating' });
          chrome.tabs.update(tabId, { url: targetUrl, active: true }, () => {
            if (chrome.runtime.lastError) return;
            if (windowId) {
              chrome.windows.update(windowId, { focused: true }, () => {
                if (chrome.runtime.lastError) {}
              });
            }
          });
        });
      } else {
        chrome.tabs.create({ url: targetUrl, active: true }, (newTab) => {
          if (chrome.runtime.lastError) {
            sendResponse({ status: 'error' });
            return;
          }
          chrome.storage.local.set({ 
            pendingScrape: { mode: mode, rainfallOnly: message.rainfallOnly || false, timestamp: Date.now() } 
          }, () => {
            sendResponse({ status: 'created_and_navigating' });
            if (newTab && newTab.windowId) {
              chrome.windows.update(newTab.windowId, { focused: true }, () => {
                if (chrome.runtime.lastError) {}
              });
            }
          });
        });
      }
    });
    return true; // async response
  }

  if (message.action === 'reload_and_scrape') {
    const tabId = sender.tab ? sender.tab.id : null;
    const mode = message.mode || 'excel';
    const windowId = sender.tab ? sender.tab.windowId : null;
    
    if (!tabId) {
      sendResponse({ status: 'no_tab' });
      return false;
    }

    // เซ็ท flag ไว้ใน storage ก่อน reload
    chrome.storage.local.set({ 
      pendingScrape: { mode: mode, rainfallOnly: message.rainfallOnly || false, timestamp: Date.now() } 
    }, () => {
      sendResponse({ status: 'reloading' });
      chrome.tabs.reload(tabId, {}, () => {
        if (chrome.runtime.lastError) return;
        if (windowId) {
          chrome.windows.update(windowId, { focused: true }, () => {
            if (chrome.runtime.lastError) {}
          });
        }
      });
    });
    
    return true; // async response
  }
  
  if (message.action === 'check_pending_scrape') {
    chrome.storage.local.get('pendingScrape', (result) => {
      if (chrome.runtime.lastError) {
        sendResponse({ shouldScrape: false });
        return;
      }
      const pending = result ? result.pendingScrape : null;
      if (pending && (Date.now() - pending.timestamp < 900000)) {
        chrome.storage.local.remove('pendingScrape', () => {
          if (chrome.runtime.lastError) {}
        });
        sendResponse({ shouldScrape: true, mode: pending.mode, rainfallOnly: pending.rainfallOnly || false });
      } else {
        sendResponse({ shouldScrape: false });
      }
    });
    return true; // async response
  }
  
  if (message.action === 'ensure_tab_open') {
    ensureSourceTabsOpen().then(status => {
      sendResponse({ status: status });
    }).catch(err => {
      sendResponse({ status: 'error', message: err.toString() });
    });
    return true;
  }
  return false;
});
