import { todayKey, formatDuration, escapeHtml } from './utils.js';

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
const pauseToggle = /** @type {HTMLButtonElement} */ (document.getElementById("pause-toggle"));

let availableDays = /** @type {string[]} */ ([]);
let currentDayIndex = 0;
let isSignedIn = false;

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

/**
 * Returns a favicon URL for the given page URL using Chrome's _favicon API.
 * @param {string} pageUrl
 * @returns {string}
 */
function faviconUrl(pageUrl) {
  const url = new URL(`chrome-extension://${chrome.runtime.id}/_favicon/`);
  url.searchParams.set("pageUrl", pageUrl);
  url.searchParams.set("size", "32");
  return url.toString();
}

function currentDateKey() {
  return availableDays[currentDayIndex] || todayKey();
}

// --- Settings ---
settingsToggle.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// --- Auth state (for export button label) ---
function updateExportBtn(signedIn) {
  isSignedIn = signedIn;
  exportBtn.style.visibility = "visible";
  if (signedIn) {
    exportBtn.innerHTML = '<span class="material-symbols-outlined">download</span> Export to Sheet';
  } else {
    exportBtn.innerHTML = '<span class="material-symbols-outlined">content_copy</span> Copy';
  }
}

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
        <img class="log-favicon" src="${faviconUrl(entry.url)}" alt="${escapeHtml(type)}" title="${escapeHtml(type)}" width="20" height="20">
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
  // Check auth state for export button label
  chrome.identity.getAuthToken({ interactive: false }, (token) => {
    void chrome.runtime.lastError;
    updateExportBtn(!!token);
  });

  updatePauseUI();
  await loadAvailableDays();
  loadLog();
  filterInput.focus();
})();
