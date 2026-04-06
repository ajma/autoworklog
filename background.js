importScripts('utils.js');

// --- Constants ---
// Matches Docs, Sheets, Slides, Forms, Drawings, Sites, and Jamboard
const WORKSPACE_PATTERN = /^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation|forms|drawings)\/d\/([a-zA-Z0-9_-]+)/;
const SITES_PATTERN = /^https:\/\/sites\.google\.com\/[^/]+\/([a-zA-Z0-9_-]+)/;
const JAMBOARD_PATTERN = /^https:\/\/jamboard\.google\.com\/d\/([a-zA-Z0-9_-]+)/;

const WORKSPACE_TYPE_MAP = {
  document: "Doc",
  spreadsheets: "Sheet",
  presentation: "Slide",
  forms: "Form",
  drawings: "Drawing",
};
const DAILY_EXPORT_ALARM = "daily-export";
const FLUSH_ALARM = "periodic-flush";

// --- State ---
let activeDocId = null;
let activeDocUrl = null;
let activeDocTitle = null;
let activeDocType = null;
let activeStartTime = null;

// Restore active tracking state after service worker restart.
// chrome.storage.session survives SW termination but clears on browser restart.
(async () => {
  const { activeSession } = await chrome.storage.session.get("activeSession");
  if (activeSession) {
    activeDocId = activeSession.docId;
    activeDocUrl = activeSession.url;
    activeDocTitle = activeSession.title;
    activeDocType = activeSession.type;
    activeStartTime = activeSession.startTime;
  }
})();

// --- Pause badge ---

async function updatePauseBadge() {
  const { trackingPaused } = await chrome.storage.local.get("trackingPaused");
  if (trackingPaused) {
    chrome.action.setBadgeText({ text: " " });
    chrome.action.setBadgeBackgroundColor({ color: "#ba1a1a" });
    chrome.action.setBadgeTextColor({ color: "#ffffff" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.trackingPaused) {
    updatePauseBadge();
  }
});

// --- Helpers ---

function extractFileInfo(url) {
  let match = url.match(WORKSPACE_PATTERN);
  if (match) return { id: match[2], type: WORKSPACE_TYPE_MAP[match[1]] || match[1] };

  match = url.match(SITES_PATTERN);
  if (match) return { id: match[1], type: "Site" };

  match = url.match(JAMBOARD_PATTERN);
  if (match) return { id: match[1], type: "Jam" };

  return null;
}

async function getLog() {
  const key = todayKey();
  const result = await chrome.storage.local.get(key);
  return result[key] || {};
}

async function saveLog(log) {
  await chrome.storage.local.set({ [todayKey()]: log });
}

// Record elapsed time for the currently active doc, then clear state.
async function flushActiveDoc() {
  if (!activeDocId || !activeStartTime || !activeDocUrl || !extractFileInfo(activeDocUrl)) return;

  const elapsed = Math.round((Date.now() - activeStartTime) / 1000); // seconds
  if (elapsed < 1) {
    activeDocId = null;
    activeDocUrl = null;
    activeDocTitle = null;
    activeDocType = null;
    activeStartTime = null;
    chrome.storage.session.remove("activeSession");
    return;
  }

  const log = await getLog();
  if (!log[activeDocId]) {
    log[activeDocId] = { url: activeDocUrl, title: activeDocTitle, type: activeDocType, totalSeconds: 0, visits: 0 };
  }
  log[activeDocId].totalSeconds += elapsed;
  log[activeDocId].visits += 1;
  if (activeDocTitle) log[activeDocId].title = activeDocTitle;
  if (activeDocType) log[activeDocId].type = activeDocType;

  await saveLog(log);

  activeDocId = null;
  activeDocUrl = null;
  activeDocTitle = null;
  activeDocType = null;
  activeStartTime = null;
  chrome.storage.session.remove("activeSession");
}

// Start tracking a new doc.
function startTracking(docId, url, title, type) {
  activeDocId = docId;
  activeDocUrl = url;
  activeDocTitle = title;
  activeDocType = type;
  activeStartTime = Date.now();
  chrome.storage.session.set({ activeSession: { docId, url, title, type, startTime: activeStartTime } });
}

// --- Tab event listeners ---

// Determine if the current active tab is a Google Doc; start or stop tracking.
async function handleTabChange(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await processTab(tab);
  } catch {
    // Tab may have been closed
    await flushActiveDoc();
  }
}

async function isPaused() {
  const { trackingPaused } = await chrome.storage.local.get("trackingPaused");
  return !!trackingPaused;
}

async function processTab(tab) {
  const url = tab.url || "";
  const fileInfo = extractFileInfo(url);

  if (fileInfo && fileInfo.id === activeDocId) {
    if (tab.title) activeDocTitle = tab.title;
    return;
  }

  await flushActiveDoc();

  // Only start tracking if we have a valid URL and title, and not paused
  if (fileInfo && url && !(await isPaused())) {
    const title = tab.title && tab.title !== url ? tab.title : null;
    startTracking(fileInfo.id, url, title || url, fileInfo.type);
  }
}

// Fired when user switches tabs
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await handleTabChange(activeInfo.tabId);
});

// Fired when a tab's URL or title updates (e.g. navigation within docs)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && !changeInfo.title) return;
  if (!tab.url) return; // tab may not have URL populated yet

  // Only care if this is the active tab
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab && activeTab.id === tabId) {
    await processTab(tab);
  }
});

// Fired when the browser window loses focus
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Browser lost focus - pause tracking
    await flushActiveDoc();
  } else {
    // Browser regained focus - check current tab
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      if (tab) await processTab(tab);
    } catch {
      // ignore
    }
  }
});

// --- Alarms ---

function getNext1159PM() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(23, 59, 0, 0);
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

// Only create alarms if they don't exist — avoids resetting timers on every SW restart.
chrome.alarms.get(DAILY_EXPORT_ALARM, (alarm) => {
  if (!alarm) {
    chrome.alarms.create(DAILY_EXPORT_ALARM, {
      when: getNext1159PM(),
      periodInMinutes: 24 * 60,
    });
  }
});

chrome.alarms.get(FLUSH_ALARM, (alarm) => {
  if (!alarm) {
    // Flush and restart tracking every 5 minutes so SW termination loses at most 5 min of time.
    chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 5 });
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === FLUSH_ALARM) {
    await flushActiveDoc();
    // Restart tracking so accumulated time is not lost if the SW is killed before next flush.
    if (!(await isPaused())) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        const info = extractFileInfo(tab.url || "");
        if (info && tab.url) startTracking(info.id, tab.url, tab.title || tab.url, info.type);
      }
    }
    return;
  }

  if (alarm.name === DAILY_EXPORT_ALARM) {
    await flushActiveDoc();
    // Export any unexported days (handles sleep/missed alarms)
    await exportUnexportedDays();
  }
});

// Export all days that haven't been exported yet (covers sleep/missed alarms).
async function exportUnexportedDays() {
  const all = await chrome.storage.local.get(null);
  const dayKeys = Object.keys(all).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k));
  dayKeys.sort(); // oldest first

  for (const dayKey of dayKeys) {
    // Skip today — the day isn't over yet
    if (dayKey === todayKey()) continue;
    // Skip already-exported days
    if (all[`exported_${dayKey}`]) continue;

    const result = await exportToGoogleDoc(dayKey);
    if (!result.success) {
      console.warn(`Auto Work Log: Failed to export ${dayKey}:`, result.error);
      break; // stop on first failure, will retry next alarm
    }
  }

  // Clean up old data beyond retention period
  await cleanupOldLogs();
}

// Remove logs older than the configured retention days.
async function cleanupOldLogs() {
  const { retentionDays } = await chrome.storage.local.get("retentionDays");
  const days = retentionDays || 7;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffKey = cutoff.toISOString().slice(0, 10);

  const all = await chrome.storage.local.get(null);
  const keysToRemove = [];
  for (const key of Object.keys(all)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(key) && key < cutoffKey) {
      keysToRemove.push(key, `exported_${key}`);
    }
  }
  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
    console.log(`Auto Work Log: Cleaned up ${keysToRemove.length / 2} old day(s).`);
  }
}

// --- Google Sheets export ---

async function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(token);
      }
    });
  });
}

// Ensure the header row exists in the sheet.
async function ensureHeaders(spreadsheetId, token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:G1`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) return; // will fail later with a better error

  const data = await resp.json();
  if (data.values && data.values.length > 0) return; // headers already exist

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:G1?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        range: "Sheet1!A1:G1",
        majorDimension: "ROWS",
        values: [["Date", "Type", "Document Title", "URL", "Time Spent", "Visits", "Seconds"]],
      }),
    }
  );
}

// Get the sheet's numeric sheetId (needed for insertDimension).
async function getSheetId(spreadsheetId, token) {
  const resp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) return 0;
  const data = await resp.json();
  return data.sheets[0].properties.sheetId;
}

// dateKey: optional — defaults to today for manual export.
async function exportToGoogleDoc(dateKey) {
  const settings = await chrome.storage.local.get(["targetDocId"]);
  const spreadsheetId = settings.targetDocId;
  if (!spreadsheetId) {
    console.warn("Auto Work Log: No target Google Sheet configured. Skipping export.");
    return { success: false, error: "No target Google Sheet configured." };
  }

  const exportDay = dateKey || todayKey();
  const dayData = await chrome.storage.local.get(exportDay);
  const log = dayData[exportDay];

  if (!log || Object.keys(log).length === 0) {
    console.log("Auto Work Log: No entries to export for " + exportDay);
    return { success: false, error: "No entries to export." };
  }

  let token;
  try {
    token = await getAuthToken();
  } catch (err) {
    console.error("Auto Work Log: Auth failed.", err);
    return { success: false, error: "Authentication failed. Please sign in via the popup." };
  }

  try {
    // Ensure header row exists
    await ensureHeaders(spreadsheetId, token);

    const entries = Object.values(log).sort((a, b) => b.totalSeconds - a.totalSeconds);

    // Build rows: [Date, Type, Title, URL, Time Spent, Visits, Seconds (raw)]
    const rows = entries.map(entry => [
      exportDay,
      entry.type || "Doc",
      entry.title || "Untitled",
      entry.url,
      formatDuration(entry.totalSeconds),
      entry.visits,
      entry.totalSeconds,
    ]);

    // Insert blank rows at row 2 (right below header) to push older data down
    const sheetId = await getSheetId(spreadsheetId, token);
    const insertResp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [{
            insertDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: 1, // row index 1 = row 2 (after header)
                endIndex: 1 + rows.length,
              },
              inheritFromBefore: false,
            },
          }],
        }),
      }
    );

    if (!insertResp.ok) {
      const errText = await insertResp.text();
      console.error("Auto Work Log: Failed to insert rows.", errText);
      return { success: false, error: `Failed to insert rows: ${insertResp.status}` };
    }

    // Write data into the newly inserted rows
    const range = `Sheet1!A2:G${1 + rows.length}`;
    const writeResp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          range,
          majorDimension: "ROWS",
          values: rows,
        }),
      }
    );

    if (!writeResp.ok) {
      const errText = await writeResp.text();
      console.error("Auto Work Log: Failed to write data.", errText);
      return { success: false, error: `Failed to write data: ${writeResp.status}` };
    }

    console.log("Auto Work Log: Successfully exported to Google Sheet.");
    await chrome.storage.local.set({ [`exported_${exportDay}`]: true });
    return { success: true };
  } catch (err) {
    console.error("Auto Work Log: Export error.", err);
    return { success: false, error: err.message };
  }
}

// --- On startup, export any missed days ---
chrome.runtime.onStartup.addListener(async () => {
  await exportUnexportedDays();
  await updatePauseBadge();
});

// --- Message handling (from popup) ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getLog") {
    (async () => {
      await flushActiveDoc();
      // Re-start tracking the current tab if still on a doc and not paused
      if (!(await isPaused())) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          const info = extractFileInfo(tab.url || "");
          if (info && tab.url) startTracking(info.id, tab.url, tab.title || tab.url, info.type);
        }
      }
      const log = await getLog();
      sendResponse({ log });
    })();
    return true; // async response
  }

  if (message.action === "exportNow") {
    (async () => {
      await flushActiveDoc();
      const result = await exportToGoogleDoc(message.date);
      // Re-start tracking if not paused
      if (!(await isPaused())) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          const info = extractFileInfo(tab.url || "");
          if (info && tab.url) startTracking(info.id, tab.url, tab.title || tab.url, info.type);
        }
      }
      sendResponse(result);
    })();
    return true;
  }

  if (message.action === "signIn") {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        console.error("Auto Work Log: Sign-in failed.", chrome.runtime.lastError);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        console.log("Auto Work Log: Sign-in succeeded.");
        sendResponse({ success: true, token });
      }
    });
    return true;
  }

  if (message.action === "getLogForDate") {
    (async () => {
      if (message.date === todayKey()) {
        await flushActiveDoc();
        if (!(await isPaused())) {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab) {
            const info = extractFileInfo(tab.url || "");
            if (info && tab.url) startTracking(info.id, tab.url, tab.title || tab.url, info.type);
          }
        }
      }
      const result = await chrome.storage.local.get(message.date);
      sendResponse({ log: result[message.date] || {} });
    })();
    return true;
  }

  if (message.action === "getAvailableDays") {
    (async () => {
      const all = await chrome.storage.local.get(null);
      const days = Object.keys(all).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().reverse();
      sendResponse({ days });
    })();
    return true;
  }

  if (message.action === "deleteEntry") {
    (async () => {
      const { date, docId } = message;
      // If deleting from today and it's the active doc, discard in-memory state
      if (date === todayKey() && docId === activeDocId) {
        activeDocId = null;
        activeDocUrl = null;
        activeDocTitle = null;
        activeDocType = null;
        activeStartTime = null;
        chrome.storage.session.remove("activeSession");
      }
      const result = await chrome.storage.local.get(date);
      const log = result[date];
      if (log && log[docId]) {
        delete log[docId];
        await chrome.storage.local.set({ [date]: log });
      }
      sendResponse({ success: true });
    })();
    return true;
  }

  if (message.action === "flushActive") {
    (async () => {
      await flushActiveDoc();
      sendResponse({ success: true });
    })();
    return true;
  }

  if (message.action === "clearLog") {
    (async () => {
      // Discard in-memory tracking so flushActiveDoc won't re-write cleared data
      activeDocId = null;
      activeDocUrl = null;
      activeDocTitle = null;
      activeDocType = null;
      activeStartTime = null;
      chrome.storage.session.remove("activeSession");
      await chrome.storage.local.remove(todayKey());
      sendResponse({ success: true });
    })();
    return true;
  }
});
