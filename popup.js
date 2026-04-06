import { todayKey, formatDuration, escapeHtml } from './utils.js';

const targetDocUrlInput = /** @type {HTMLInputElement} */ (document.getElementById("target-doc-url"));
const retentionDaysInput = /** @type {HTMLInputElement} */ (document.getElementById("retention-days"));
const saveSettingsBtn = /** @type {HTMLButtonElement} */ (document.getElementById("save-settings"));
const settingsStatus = /** @type {HTMLElement} */ (document.getElementById("settings-status"));
const signInBtn = /** @type {HTMLButtonElement} */ (document.getElementById("sign-in-btn"));
const authStatus = /** @type {HTMLElement} */ (document.getElementById("auth-status"));
const logDate = /** @type {HTMLElement} */ (document.getElementById("log-date"));
const logList = /** @type {HTMLElement} */ (document.getElementById("log-list"));
const logSummary = /** @type {HTMLElement} */ (document.getElementById("log-summary"));
const exportBtn = /** @type {HTMLButtonElement} */ (document.getElementById("export-btn"));
const clearBtn = /** @type {HTMLButtonElement} */ (document.getElementById("clear-btn"));
const exportStatus = /** @type {HTMLElement} */ (document.getElementById("export-status"));
const prevDayBtn = /** @type {HTMLButtonElement} */ (document.getElementById("prev-day-btn"));
const nextDayBtn = /** @type {HTMLButtonElement} */ (document.getElementById("next-day-btn"));
const filterInput = /** @type {HTMLInputElement} */ (document.getElementById("filter-input"));
const filterClear = /** @type {HTMLButtonElement} */ (document.getElementById("filter-clear"));
const settingsToggle = /** @type {HTMLButtonElement} */ (document.getElementById("settings-toggle"));
const settingsSection = /** @type {HTMLElement} */ (document.getElementById("settings-section"));
const mainView = /** @type {HTMLElement} */ (document.getElementById("main-view"));
const pauseToggle = /** @type {HTMLButtonElement} */ (document.getElementById("pause-toggle"));

const GOOGLE_SHEETS_PATTERN = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/;

let availableDays = /** @type {string[]} */ ([]);
let currentDayIndex = 0;
let isSignedIn = false;

function extractSheetId(url) {
  const match = url.match(GOOGLE_SHEETS_PATTERN);
  return match ? match[1] : null;
}

// Sends a message to the background service worker. Returns null if the SW is unavailable.
function sendMsg(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (resp) => {
      if (chrome.runtime.lastError) {
        console.warn("Auto Work Log: SW unavailable —", chrome.runtime.lastError.message);
        resolve(null);
        return;
      }
      resolve(resp);
    });
  });
}

// Inline SVGs matching Google Workspace product icons
const TYPE_SVGS = {
  Doc: `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#fff" d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6zm8 1.5L19.5 9H14V3.5zM7 13h10v1.5H7V13zm0 3.5h7v1.5H7v-1.5zm0-7h4V11H7V9.5z"/></svg>`,
  Sheet: `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#fff" d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6zm8 1.5L19.5 9H14V3.5zM7 12h3v2.5H7V12zm0 3.5h3V18H7v-2.5zm4-3.5h3v2.5h-3V12zm0 3.5h3V18h-3v-2.5zm4-3.5h2v2.5h-2V12zm0 3.5h2V18h-2v-2.5z"/></svg>`,
  Slide: `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#fff" d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm3 1v12h12V6H6zm2 2h8v8H8V8z"/></svg>`,
  Form: `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#fff" d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6zm8 1.5L19.5 9H14V3.5zM8 12a1.25 1.25 0 1 1 0 2.5A1.25 1.25 0 0 1 8 12zm0 3.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zM11 12.5h5.5V14H11v-1.5zm0 3.5h5.5v1.5H11V16z"/></svg>`,
  Drawing: `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#fff" d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm4 9l3-4 2.5 3 3.5-5L19 15H7z"/></svg>`,
  Site: `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#fff" d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm2 0v2h14V5H5zm0 4v10h5V9H5zm7 0v10h7V9h-7z"/></svg>`,
};

function currentDateKey() {
  return availableDays[currentDayIndex] || todayKey();
}

// --- Auth state ---
function updateAuthUI(signedIn) {
  isSignedIn = signedIn;
  exportBtn.style.visibility = "visible";
  if (signedIn) {
    authStatus.textContent = "Signed in";
    authStatus.className = "status-msg success";
    signInBtn.innerHTML = '<span class="material-symbols-outlined">logout</span> Sign out';
    exportBtn.innerHTML = '<span class="material-symbols-outlined">download</span> Export to Sheet';
  } else {
    authStatus.textContent = "Not signed in";
    authStatus.className = "status-msg error";
    signInBtn.innerHTML = '<span class="material-symbols-outlined">login</span> Sign in with Google';
    exportBtn.innerHTML = '<span class="material-symbols-outlined">content_copy</span> Copy';
  }
}

// --- Load saved settings ---
async function loadSettings() {
  const data = await chrome.storage.local.get(["targetDocId", "targetDocUrl", "retentionDays"]);
  if (data["targetDocUrl"]) {
    targetDocUrlInput.value = data["targetDocUrl"];
  }
  retentionDaysInput.value = data["retentionDays"] || 7;

  chrome.identity.getAuthToken({ interactive: false }, (token) => {
    void chrome.runtime.lastError;
    updateAuthUI(!!token);
  });
}

// --- Save settings ---
saveSettingsBtn.addEventListener("click", async () => {
  const url = targetDocUrlInput.value.trim();
  const sheetId = extractSheetId(url);

  if (url && !sheetId) {
    settingsStatus.textContent = "Invalid Google Sheet URL. Paste the full URL.";
    settingsStatus.className = "status-msg error";
    return;
  }

  const retention = parseInt(retentionDaysInput.value, 10);
  if (isNaN(retention) || retention < 1) {
    settingsStatus.textContent = "Retention must be at least 1 day.";
    settingsStatus.className = "status-msg error";
    return;
  }

  /** @type {Record<string, any>} */
  const settings = { retentionDays: retention };
  if (sheetId) {
    settings["targetDocId"] = sheetId;
    settings["targetDocUrl"] = url;
  }

  await chrome.storage.local.set(settings);
  settingsStatus.textContent = "Saved!";
  settingsStatus.className = "status-msg success";
  setTimeout(() => { settingsStatus.textContent = ""; }, 2000);
});

// --- Sign in / Sign out ---
signInBtn.addEventListener("click", () => {
  if (isSignedIn) {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) {
        fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
        chrome.identity.removeCachedAuthToken({ token }, () => {
          chrome.identity.clearAllCachedAuthTokens(() => {
            updateAuthUI(false);
          });
        });
      }
    });
  } else {
    sendMsg({ action: "signIn" }).then((resp) => {
      if (resp && resp.success) {
        updateAuthUI(true);
      } else {
        authStatus.textContent = resp ? "Sign-in failed" : "Extension is restarting — try again.";
        authStatus.className = "status-msg error";
      }
    });
  }
});

// --- Day navigation ---
async function loadAvailableDays() {
  const resp = await sendMsg({ action: "getAvailableDays" });
  availableDays = resp ? resp.days : [];
  const today = todayKey();
  if (!availableDays.includes(today)) {
    availableDays.unshift(today);
  }
}

function updateNavButtons() {
  prevDayBtn.disabled = currentDayIndex >= availableDays.length - 1;
  nextDayBtn.disabled = currentDayIndex <= 0;
}

prevDayBtn.addEventListener("click", () => {
  if (currentDayIndex < availableDays.length - 1) {
    currentDayIndex++;
    loadLog();
  }
});

nextDayBtn.addEventListener("click", () => {
  if (currentDayIndex > 0) {
    currentDayIndex--;
    loadLog();
  }
});

// --- Load and display log for current day ---
async function loadLog() {
  const dateKey = currentDateKey();
  const isToday = dateKey === todayKey();
  const [, month, day] = dateKey.split("-");
  const shortDate = `${parseInt(month)}/${parseInt(day)}`;
  logDate.textContent = isToday ? `Today (${shortDate})` : shortDate;
  updateNavButtons();

  clearBtn.style.display = isToday ? "" : "none";

  const action = isToday ? "getLog" : "getLogForDate";
  const msgPayload = isToday ? { action } : { action, date: dateKey };

  const resp = await sendMsg(msgPayload);

  if (!resp) {
    logList.innerHTML = '<p class="empty">Extension is restarting — please try again.</p>';
    logSummary.textContent = "";
    return;
  }

  if (!resp.log || Object.keys(resp.log).length === 0) {
    logList.innerHTML = '<p class="empty">No Workspace files visited.</p>';
    logSummary.textContent = "";
    return;
  }

  const entries = Object.entries(resp.log).filter(([, e]) => e.url).sort((a, b) => b[1].totalSeconds - a[1].totalSeconds);
  let html = "";

  for (const [docId, entry] of entries) {
    const title = entry.title || "Untitled";
    const displayTitle = title.length > 60 ? title.slice(0, 57) + "..." : title;
    const type = entry.type || "Doc";
    html += `
      <div class="log-entry">
        <span class="log-type" data-type="${escapeHtml(type)}" title="${escapeHtml(type)}">${TYPE_SVGS[type] || TYPE_SVGS.Doc}</span>
        <a class="log-title" href="${escapeHtml(entry.url)}" data-url="${escapeHtml(entry.url)}" title="${escapeHtml(title)}">${escapeHtml(displayTitle)}</a>
        <span class="log-time"><span class="material-symbols-outlined">timer</span>${formatDuration(entry.totalSeconds)}</span>
        <span class="log-visits"><span class="material-symbols-outlined">visibility</span>${entry.visits}</span>
        <button class="log-delete" data-doc-id="${escapeHtml(docId)}" title="Remove"><span class="material-symbols-outlined">delete</span></button>
      </div>
    `;
  }

  logList.innerHTML = html;

  logList.querySelectorAll(".log-title").forEach((el) => {
    const link = /** @type {HTMLAnchorElement} */ (el);
    link.addEventListener("click", async (e) => {
      e.preventDefault();
      const url = link.dataset["url"] || "";
      const tabs = await chrome.tabs.query({});
      const existing = tabs.find(t => t.url && t.url.startsWith(url.split("?")[0]));
      if (existing && existing.id !== undefined) {
        chrome.tabs.update(existing.id, { active: true });
        if (existing.windowId !== undefined) {
          chrome.windows.update(existing.windowId, { focused: true });
        }
      } else {
        chrome.tabs.create({ url });
      }
      window.close();
    });
  });

  logList.querySelectorAll(".log-delete").forEach((el) => {
    const btn = /** @type {HTMLButtonElement} */ (el);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const docId = btn.dataset["docId"] || "";
      sendMsg({ action: "deleteEntry", date: currentDateKey(), docId }).then(() => loadLog());
    });
  });

  const totalSeconds = entries.reduce((sum, e) => sum + e[1].totalSeconds, 0);
  logSummary.textContent = `${entries.length} file${entries.length !== 1 ? "s" : ""} — ${formatDuration(totalSeconds)} total`;
}

// --- Filter ---
function applyFilter() {
  const query = filterInput.value.toLowerCase();
  filterClear.style.display = query.length > 0 ? "inline-flex" : "none";
  logList.querySelectorAll(".log-entry").forEach((el) => {
    const entry = /** @type {HTMLElement} */ (el);
    const titleEl = entry.querySelector(".log-title");
    const title = titleEl ? (titleEl.textContent || "").toLowerCase() : "";
    entry.style.display = title.includes(query) ? "" : "none";
  });
}

filterInput.addEventListener("input", applyFilter);

filterClear.addEventListener("click", () => {
  filterInput.value = "";
  applyFilter();
  filterInput.focus();
});

// --- Export ---
exportBtn.addEventListener("click", async () => {
  if (isSignedIn) {
    exportBtn.disabled = true;
    exportStatus.textContent = "Exporting...";
    exportStatus.className = "status-msg";

    const resp = await sendMsg({ action: "exportNow", date: currentDateKey() });
    exportBtn.disabled = false;
    if (!resp) {
      exportStatus.textContent = "Extension is restarting — try again.";
      exportStatus.className = "status-msg error";
    } else if (resp.success) {
      exportStatus.textContent = "Exported successfully!";
      exportStatus.className = "status-msg success";
    } else {
      exportStatus.textContent = resp.error;
      exportStatus.className = "status-msg error";
    }
    setTimeout(() => { exportStatus.textContent = ""; }, 4000);
  } else {
    const dateKey = currentDateKey();
    const action = dateKey === todayKey() ? "getLog" : "getLogForDate";
    const msg = dateKey === todayKey() ? { action } : { action, date: dateKey };

    const resp = await sendMsg(msg);
    if (!resp || !resp.log || Object.keys(resp.log).length === 0) {
      exportStatus.textContent = resp ? "No entries to copy." : "Extension is restarting — try again.";
      exportStatus.className = "status-msg error";
      setTimeout(() => { exportStatus.textContent = ""; }, 3000);
      return;
    }

    const entries = Object.values(resp.log).sort((a, b) => b.totalSeconds - a.totalSeconds);
    const rows = entries.map(entry => {
      const title = entry.title || "Untitled";
      const type = entry.type || "Doc";
      return [dateKey, type, title, entry.url, formatDuration(entry.totalSeconds), entry.visits, entry.totalSeconds].join("\t");
    });

    navigator.clipboard.writeText(rows.join("\n")).then(() => {
      exportStatus.textContent = "Copied to clipboard!";
      exportStatus.className = "status-msg success";
    }).catch(() => {
      exportStatus.textContent = "Failed to copy.";
      exportStatus.className = "status-msg error";
    });
    setTimeout(() => { exportStatus.textContent = ""; }, 3000);
  }
});

// --- Clear ---
clearBtn.addEventListener("click", async () => {
  if (!confirm("Clear today's log? This cannot be undone.")) return;
  await sendMsg({ action: "clearLog" });
  loadLog();
});

// --- Settings toggle ---
settingsToggle.addEventListener("click", () => {
  const showingSettings = settingsSection.style.display !== "none";
  settingsSection.style.display = showingSettings ? "none" : "flex";
  mainView.style.display = showingSettings ? "" : "none";
});

// --- Pause toggle ---
async function updatePauseUI() {
  const { trackingPaused } = await chrome.storage.local.get("trackingPaused");
  const paused = !!trackingPaused;
  pauseToggle.title = paused ? "Resume tracking" : "Pause tracking";
  const icon = pauseToggle.querySelector(".material-symbols-outlined");
  if (icon) icon.textContent = paused ? "play_arrow" : "pause";
}

pauseToggle.addEventListener("click", async () => {
  const { trackingPaused } = await chrome.storage.local.get("trackingPaused");
  const newState = !trackingPaused;
  await chrome.storage.local.set({ trackingPaused: newState });
  if (newState) {
    sendMsg({ action: "flushActive" });
  }
  updatePauseUI();
});

// --- Init ---
(async () => {
  loadSettings();
  updatePauseUI();
  await loadAvailableDays();
  loadLog();
  filterInput.focus();
})();
