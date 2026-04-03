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
const filterInput = document.getElementById("filter-input");

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

// Inline SVGs matching Google Workspace product icons
const TYPE_SVGS = {
  Doc: `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#fff" d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6zm8 1.5L19.5 9H14V3.5zM7 13h10v1.5H7V13zm0 3.5h7v1.5H7v-1.5zm0-7h4V11H7V9.5z"/></svg>`,
  Sheet: `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#fff" d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6zm8 1.5L19.5 9H14V3.5zM7 12h3v2.5H7V12zm0 3.5h3V18H7v-2.5zm4-3.5h3v2.5h-3V12zm0 3.5h3V18h-3v-2.5zm4-3.5h2v2.5h-2V12zm0 3.5h2V18h-2v-2.5z"/></svg>`,
  Slide: `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#fff" d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm3 1v12h12V6H6zm2 2h8v8H8V8z"/></svg>`,
  Form: `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#fff" d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6zm8 1.5L19.5 9H14V3.5zM8 12a1.25 1.25 0 1 1 0 2.5A1.25 1.25 0 0 1 8 12zm0 3.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zM11 12.5h5.5V14H11v-1.5zm0 3.5h5.5v1.5H11V16z"/></svg>`,
  Drawing: `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#fff" d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm4 9l3-4 2.5 3 3.5-5L19 15H7z"/></svg>`,
  Site: `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#fff" d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm2 0v2h14V5H5zm0 4v10h5V9H5zm7 0v10h7V9h-7z"/></svg>`,
  Jam: `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#fff" d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm9 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/></svg>`,
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

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
    // Sign out: revoke token so it doesn't auto-restore
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) {
        // Revoke the token server-side
        fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
        chrome.identity.removeCachedAuthToken({ token }, () => {
          chrome.identity.clearAllCachedAuthTokens(() => {
            updateAuthUI(false);
          });
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

    const entries = Object.entries(resp.log).sort((a, b) => b[1].totalSeconds - a[1].totalSeconds);
    let html = "";

    for (const [docId, entry] of entries) {
      const title = entry.title || "Untitled";
      const displayTitle = title.length > 60 ? title.slice(0, 57) + "..." : title;
      const type = entry.type || "Doc";
      html += `
        <div class="log-entry">
          <span class="log-type" data-type="${type}" title="${type}">${TYPE_SVGS[type] || TYPE_SVGS.Doc}</span>
          <a class="log-title" href="${entry.url}" data-url="${entry.url}" title="${title}">${displayTitle}</a>
          <span class="log-time"><span class="material-symbols-outlined">timer</span>${formatDuration(entry.totalSeconds)}</span>
          <span class="log-visits"><span class="material-symbols-outlined">visibility</span>${entry.visits}</span>
          <button class="log-delete" data-doc-id="${docId}" title="Remove"><span class="material-symbols-outlined">delete</span></button>
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

    // Delete button handlers
    logList.querySelectorAll(".log-delete").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const docId = btn.dataset.docId;
        chrome.runtime.sendMessage({ action: "deleteEntry", date: currentDateKey(), docId }, () => {
          loadLog();
        });
      });
    });

    const totalSeconds = entries.reduce((sum, e) => sum + e[1].totalSeconds, 0);
    logSummary.textContent = `${entries.length} file${entries.length !== 1 ? "s" : ""} — ${formatDuration(totalSeconds)} total`;
  });
}

// --- Filter ---
const filterClear = document.getElementById("filter-clear");

function applyFilter() {
  const query = filterInput.value.toLowerCase();
  filterClear.style.display = query.length > 0 ? "inline-flex" : "none";
  logList.querySelectorAll(".log-entry").forEach(entry => {
    const title = entry.querySelector(".log-title").textContent.toLowerCase();
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
  filterInput.focus();
})();
