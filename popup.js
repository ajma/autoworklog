const targetDocUrlInput = document.getElementById("target-doc-url");
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

const GOOGLE_SHEETS_PATTERN = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/;

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

// --- Load saved settings ---
async function loadSettings() {
  const data = await chrome.storage.local.get(["targetDocId", "targetDocUrl"]);
  if (data.targetDocUrl) {
    targetDocUrlInput.value = data.targetDocUrl;
  }

  // Check auth
  chrome.identity.getAuthToken({ interactive: false }, (token) => {
    if (token) {
      authStatus.textContent = "Signed in";
      authStatus.className = "status-msg success";
    } else {
      authStatus.textContent = "Not signed in";
      authStatus.className = "status-msg error";
    }
  });
}

// --- Save settings ---
saveSettingsBtn.addEventListener("click", async () => {
  const url = targetDocUrlInput.value.trim();
  const sheetId = extractSheetId(url);

  if (!sheetId) {
    settingsStatus.textContent = "Invalid Google Sheet URL. Paste the full URL.";
    settingsStatus.className = "status-msg error";
    return;
  }

  await chrome.storage.local.set({ targetDocId: sheetId, targetDocUrl: url });
  settingsStatus.textContent = "Saved!";
  settingsStatus.className = "status-msg success";
  setTimeout(() => { settingsStatus.textContent = ""; }, 2000);
});

// --- Sign in ---
signInBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "signIn" }, (resp) => {
    if (resp && resp.success) {
      authStatus.textContent = "Signed in";
      authStatus.className = "status-msg success";
    } else {
      authStatus.textContent = "Sign-in failed";
      authStatus.className = "status-msg error";
    }
  });
});

// --- Load and display today's log ---
async function loadLog() {
  const today = new Date().toISOString().slice(0, 10);
  logDate.textContent = `(${today})`;

  chrome.runtime.sendMessage({ action: "getLog" }, (resp) => {
    if (!resp || !resp.log || Object.keys(resp.log).length === 0) {
      logList.innerHTML = '<p class="empty">No Workspace files visited today.</p>';
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
});

// --- Clear ---
clearBtn.addEventListener("click", () => {
  if (!confirm("Clear today's log? This cannot be undone.")) return;

  chrome.runtime.sendMessage({ action: "clearLog" }, () => {
    loadLog();
  });
});

// --- Init ---
loadSettings();
loadLog();
