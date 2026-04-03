const targetDocUrlInput = document.getElementById("target-doc-url");
const retentionDaysInput = document.getElementById("retention-days");
const saveSettingsBtn = document.getElementById("save-settings");
const settingsStatus = document.getElementById("settings-status");
const signInBtn = document.getElementById("sign-in-btn");
const authStatus = document.getElementById("auth-status");
const logDate = document.getElementById("log-date");
const logList = document.getElementById("log-list");
const logSummary = document.getElementById("log-summary");
const exportBtn = document.getElementById("export-btn");
const clearBtn = document.getElementById("clear-btn");
const exportStatus = document.getElementById("export-status");
const prevDayBtn = document.getElementById("prev-day-btn");
const nextDayBtn = document.getElementById("next-day-btn");

const GOOGLE_SHEETS_PATTERN = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/;

let availableDays = [];
let currentDayIndex = 0; // 0 = most recent (today)
let isSignedIn = false;

function extractSheetId(url) {
  const match = url.match(GOOGLE_SHEETS_PATTERN);
  return match ? match[1] : null;
}

function formatDuration(totalSeconds) {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function currentDateKey() {
  return availableDays[currentDayIndex] || todayKey();
}

// --- Auth state ---
function updateAuthUI(signedIn) {
  isSignedIn = signedIn;
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
  if (data.targetDocUrl) {
    targetDocUrlInput.value = data.targetDocUrl;
  }
  retentionDaysInput.value = data.retentionDays || 7;

  chrome.identity.getAuthToken({ interactive: false }, (token) => {
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

  const settings = { retentionDays: retention };
  if (sheetId) {
    settings.targetDocId = sheetId;
    settings.targetDocUrl = url;
  }

  await chrome.storage.local.set(settings);
  settingsStatus.textContent = "Saved!";
  settingsStatus.className = "status-msg success";
  setTimeout(() => { settingsStatus.textContent = ""; }, 2000);
});

// --- Sign in / Sign out ---
signInBtn.addEventListener("click", () => {
  if (isSignedIn) {
    // Sign out
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) {
        chrome.identity.removeCachedAuthToken({ token }, () => {
          updateAuthUI(false);
        });
      }
    });
  } else {
    chrome.runtime.sendMessage({ action: "signIn" }, (resp) => {
      if (resp && resp.success) {
        updateAuthUI(true);
      } else {
        authStatus.textContent = "Sign-in failed";
        authStatus.className = "status-msg error";
      }
    });
  }
});

// --- Day navigation ---
async function loadAvailableDays() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "getAvailableDays" }, (resp) => {
      availableDays = resp ? resp.days : [];
      // Ensure today is in the list
      const today = todayKey();
      if (!availableDays.includes(today)) {
        availableDays.unshift(today);
      }
      resolve();
    });
  });
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
  logDate.textContent = isToday ? `Today (${dateKey})` : dateKey;
  updateNavButtons();

  // Show/hide clear button only for today
  clearBtn.style.display = isToday ? "" : "none";

  const action = isToday ? "getLog" : "getLogForDate";
  const msgPayload = isToday ? { action } : { action, date: dateKey };

  chrome.runtime.sendMessage(msgPayload, (resp) => {
    if (!resp || !resp.log || Object.keys(resp.log).length === 0) {
      logList.innerHTML = '<p class="empty">No Workspace files visited.</p>';
      logSummary.textContent = "";
      return;
    }

    const entries = Object.values(resp.log).sort((a, b) => b.totalSeconds - a.totalSeconds);
    let html = "";

    for (const entry of entries) {
      const title = entry.title || "Untitled";
      const displayTitle = title.length > 60 ? title.slice(0, 57) + "..." : title;
      const type = entry.type || "Doc";
      html += `
        <div class="log-entry">
          <div class="log-entry-header">
            <span class="log-type">${type}</span>
            <a class="log-title" href="${entry.url}" data-url="${entry.url}" title="${title}">${displayTitle}</a>
          </div>
          <div class="log-meta">
            <span class="log-time"><span class="material-symbols-outlined">timer</span>${formatDuration(entry.totalSeconds)}</span>
            <span class="log-visits">${entry.visits} visit${entry.visits !== 1 ? "s" : ""}</span>
          </div>
        </div>
      `;
    }

    logList.innerHTML = html;

    // Click handler: focus existing tab or open new one
    logList.querySelectorAll(".log-title").forEach(link => {
      link.addEventListener("click", async (e) => {
        e.preventDefault();
        const url = link.dataset.url;
        const tabs = await chrome.tabs.query({});
        const existing = tabs.find(t => t.url && t.url.startsWith(url.split("?")[0]));
        if (existing) {
          chrome.tabs.update(existing.id, { active: true });
          chrome.windows.update(existing.windowId, { focused: true });
        } else {
          chrome.tabs.create({ url });
        }
        window.close();
      });
    });

    const totalSeconds = entries.reduce((sum, e) => sum + e.totalSeconds, 0);
    logSummary.textContent = `${entries.length} file${entries.length !== 1 ? "s" : ""} — ${formatDuration(totalSeconds)} total`;
  });
}

// --- Export ---
exportBtn.addEventListener("click", () => {
  if (isSignedIn) {
    // Export to Google Sheet
    exportBtn.disabled = true;
    exportStatus.textContent = "Exporting...";
    exportStatus.className = "status-msg";

    chrome.runtime.sendMessage({ action: "exportNow" }, (resp) => {
      exportBtn.disabled = false;
      if (resp && resp.success) {
        exportStatus.textContent = "Exported successfully!";
        exportStatus.className = "status-msg success";
      } else {
        exportStatus.textContent = resp ? resp.error : "Export failed.";
        exportStatus.className = "status-msg error";
      }
      setTimeout(() => { exportStatus.textContent = ""; }, 4000);
    });
  } else {
    // Copy as markdown
    const dateKey = currentDateKey();
    const action = dateKey === todayKey() ? "getLog" : "getLogForDate";
    const msg = dateKey === todayKey() ? { action } : { action, date: dateKey };

    chrome.runtime.sendMessage(msg, (resp) => {
      if (!resp || !resp.log || Object.keys(resp.log).length === 0) {
        exportStatus.textContent = "No entries to copy.";
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
      const tsv = rows.join("\n");

      navigator.clipboard.writeText(tsv).then(() => {
        exportStatus.textContent = "Copied to clipboard!";
        exportStatus.className = "status-msg success";
      }).catch(() => {
        exportStatus.textContent = "Failed to copy.";
        exportStatus.className = "status-msg error";
      });
      setTimeout(() => { exportStatus.textContent = ""; }, 3000);
    });
  }
});

// --- Clear ---
clearBtn.addEventListener("click", () => {
  if (!confirm("Clear today's log? This cannot be undone.")) return;

  chrome.runtime.sendMessage({ action: "clearLog" }, () => {
    loadLog();
  });
});

// --- Init ---
(async () => {
  loadSettings();
  await loadAvailableDays();
  loadLog();
})();
