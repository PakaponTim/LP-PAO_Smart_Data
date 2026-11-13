const TRAFFY_URL = 'https://citydata.traffy.in.th/recent-post';

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
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'waterServerHeartbeat') sendServerHeartbeat().catch(() => {});
});

// ตรวจสอบและเปิดแท็บ Traffy Fondue อัตโนมัติ (ปิดการใช้งานเพื่อหยุดลูป)
async function ensureTraffyTabOpen() {
  console.log('⚠️ ensureTraffyTabOpen is disabled.');
  return 'disabled';
}

// ตั้งตื่นปลุกและเริ่มทำงาน (ปิดการใช้งานเพื่อหยุดลูป)
// chrome.runtime.onStartup.addListener(() => {
//   ensureTraffyTabOpen().catch(console.error);
//   chrome.alarms.create("checkTraffyTabAlarm", { periodInMinutes: 5 });
// });

// chrome.runtime.onInstalled.addListener(() => {
//   ensureTraffyTabOpen().catch(console.error);
//   chrome.alarms.create("checkTraffyTabAlarm", { periodInMinutes: 5 });
// });

// chrome.alarms.onAlarm.addListener((alarm) => {
//   if (alarm.name === "checkTraffyTabAlarm") {
//     ensureTraffyTabOpen().catch(console.error);
//   }
// });

// รับส่งข้อความกับ Content Script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;
  if (message.action === 'open_pairing_options') {
    chrome.runtime.openOptionsPage();
    sendResponse({ status: 'opened' });
    return false;
  }

  if (message.action === 'navigate_and_scrape') {
    const targetUrl = message.url || TRAFFY_URL;
    chrome.tabs.query({ url: '*://citydata.traffy.in.th/*' }, (tabs) => {
      if (chrome.runtime.lastError) {
        sendResponse({ status: 'error' });
        return;
      }
      if (tabs && tabs.length > 0) {
        chrome.storage.local.set({ pendingScrape: { mode: message.mode || 'db', timestamp: Date.now() } }, () => {
          sendResponse({ status: 'navigating' });
          chrome.tabs.update(tabs[0].id, { url: targetUrl, active: true }, () => {
            if (chrome.runtime.lastError) {}
          });
        });
      } else {
        chrome.tabs.create({ url: targetUrl, active: true }, () => {
          if (chrome.runtime.lastError) {
            sendResponse({ status: 'error' });
            return;
          }
          chrome.storage.local.set({ pendingScrape: { mode: message.mode || 'db', timestamp: Date.now() } }, () => {
            sendResponse({ status: 'created_and_navigating' });
          });
        });
      }
    });
    return true;
  }

  if (message.action === 'reload_and_scrape') {
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId) {
      chrome.storage.local.set({ pendingScrape: { mode: message.mode || 'db', timestamp: Date.now() } }, () => {
        sendResponse({ status: 'reloading' });
        chrome.tabs.reload(tabId, {}, () => {
          if (chrome.runtime.lastError) {}
        });
      });
      return true;
    }
    sendResponse({ status: 'no_tab' });
    return false;
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
        sendResponse({ shouldScrape: true, mode: pending.mode });
      } else {
        sendResponse({ shouldScrape: false });
      }
    });
    return true;
  }
  return false;
});
