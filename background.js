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

// --- State ---
let activeDocId = null;
let activeDocUrl = null;
let activeDocTitle = null;
let activeDocType = null;
let activeStartTime = null;

// --- Helpers ---

function todayKey() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

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
  if (!activeDocId || !activeStartTime) return;

  const elapsed = Math.round((Date.now() - activeStartTime) / 1000); // seconds
  if (elapsed < 5) {
    activeDocId = null;
    activeDocUrl = null;
    activeDocTitle = null;
    activeDocType = null;
    activeStartTime = null;
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
}

// Start tracking a new doc.
function startTracking(docId, url, title, type) {
  activeDocId = docId;
  activeDocUrl = url;
  activeDocTitle = title;
  activeDocType = type;
  activeStartTime = Date.now();
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

async function processTab(tab) {
  const url = tab.url || "";
  const fileInfo = extractFileInfo(url);

  if (fileInfo && fileInfo.id === activeDocId) {
    if (tab.title) activeDocTitle = tab.title;
    return;
  }

  await flushActiveDoc();

  if (fileInfo) {
    startTracking(fileInfo.id, url, tab.title || url, fileInfo.type);
  }
}

// Fired when user switches tabs
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await handleTabChange(activeInfo.tabId);
});

// Fired when a tab's URL or title updates (e.g. navigation within docs)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && !changeInfo.title) return;

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

// --- Daily alarm for auto-export ---

chrome.alarms.create(DAILY_EXPORT_ALARM, {
  // Fire at next midnight, then every 24 hours
  when: getNextMidnight(),
  periodInMinutes: 24 * 60,
});

function getNextMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(23, 59, 0, 0);
  // If it's already past 11:59 PM, set for tomorrow
  if (midnight <= now) {
    midnight.setDate(midnight.getDate() + 1);
  }
  return midnight.getTime();
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
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

function formatDuration(totalSeconds) {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
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
});

// --- Message handling (from popup) ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getLog") {
    (async () => {
      await flushActiveDoc();
      // Re-start tracking the current tab if still on a doc
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        const info = extractFileInfo(tab.url || "");
        if (info) startTracking(info.id, tab.url, tab.title, info.type);
      }
      const log = await getLog();
      sendResponse({ log });
    })();
    return true; // async response
  }

  if (message.action === "exportNow") {
    (async () => {
      await flushActiveDoc();
      const result = await exportToGoogleDoc();
      // Re-start tracking
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        const info = extractFileInfo(tab.url || "");
        if (info) startTracking(info.id, tab.url, tab.title, info.type);
      }
      sendResponse(result);
    })();
    return true;
  }

  if (message.action === "signIn") {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, token });
      }
    });
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
      await chrome.storage.local.remove(todayKey());
      sendResponse({ success: true });
    })();
    return true;
  }
});
