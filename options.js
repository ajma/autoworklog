import { DEFAULT_RULES } from './utils.js';

const targetDocUrlInput = /** @type {HTMLInputElement} */ (document.getElementById("target-doc-url"));
const retentionDaysInput = /** @type {HTMLInputElement} */ (document.getElementById("retention-days"));
const signInBtn = /** @type {HTMLButtonElement} */ (document.getElementById("sign-in-btn"));
const authStatus = /** @type {HTMLElement} */ (document.getElementById("auth-status"));
const rulesList = /** @type {HTMLElement} */ (document.getElementById("rules-list"));
const addRuleBtn = /** @type {HTMLButtonElement} */ (document.getElementById("add-rule-btn"));
const resetRulesBtn = /** @type {HTMLButtonElement} */ (document.getElementById("reset-rules-btn"));
const saveBtn = /** @type {HTMLButtonElement} */ (document.getElementById("save-btn"));
const saveStatus = /** @type {HTMLElement} */ (document.getElementById("save-status"));
const exportSettingsBtn = /** @type {HTMLButtonElement} */ (document.getElementById("export-settings-btn"));
const importSettingsBtn = /** @type {HTMLButtonElement} */ (document.getElementById("import-settings-btn"));
const importFile = /** @type {HTMLInputElement} */ (document.getElementById("import-file"));
const importExportStatus = /** @type {HTMLElement} */ (document.getElementById("import-export-status"));

const GOOGLE_SHEETS_PATTERN = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/;

let isSignedIn = false;

/** @type {import('./utils.js').UrlRule[]} */
let rules = [];

// --- Auth ---

function updateAuthUI(signedIn) {
  isSignedIn = signedIn;
  if (signedIn) {
    authStatus.textContent = "Signed in";
    authStatus.className = "status-msg success";
    signInBtn.innerHTML = '<span class="material-symbols-outlined">logout</span> Sign out';
  } else {
    authStatus.textContent = "Not signed in";
    authStatus.className = "status-msg error";
    signInBtn.innerHTML = '<span class="material-symbols-outlined">login</span> Sign in with Google';
  }
}

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
    chrome.runtime.sendMessage({ action: "signIn" }, (resp) => {
      void chrome.runtime.lastError;
      if (resp && resp.success) {
        updateAuthUI(true);
      } else {
        authStatus.textContent = "Sign-in failed";
        authStatus.className = "status-msg error";
      }
    });
  }
});

// --- Rules rendering ---

function renderRules() {
  rulesList.innerHTML = "";
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const row = document.createElement("div");
    row.className = "rule-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = rule.enabled;
    checkbox.title = rule.enabled ? "Enabled" : "Disabled";
    checkbox.addEventListener("change", () => {
      rules[i].enabled = checkbox.checked;
      checkbox.title = checkbox.checked ? "Enabled" : "Disabled";
    });

    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.className = "rule-label";
    labelInput.value = rule.label;
    labelInput.placeholder = "Type";
    labelInput.addEventListener("input", () => {
      rules[i].label = labelInput.value;
    });

    const patternInput = document.createElement("input");
    patternInput.type = "text";
    patternInput.className = "rule-pattern";
    patternInput.value = rule.pattern;
    patternInput.placeholder = "Regex pattern with one capture group";
    patternInput.addEventListener("input", () => {
      rules[i].pattern = patternInput.value;
      // Clear error styling on edit
      patternInput.style.borderColor = "";
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-icon rule-delete";
    deleteBtn.title = "Delete rule";
    deleteBtn.innerHTML = '<span class="material-symbols-outlined">delete</span>';
    deleteBtn.addEventListener("click", () => {
      rules.splice(i, 1);
      renderRules();
    });

    row.append(checkbox, labelInput, patternInput, deleteBtn);
    rulesList.appendChild(row);
  }
}

addRuleBtn.addEventListener("click", () => {
  rules.push({ id: "rule_" + Date.now(), label: "", pattern: "", enabled: true });
  renderRules();
  // Focus the new label input
  const lastRow = rulesList.lastElementChild;
  if (lastRow) {
    const labelInput = /** @type {HTMLInputElement | null} */ (lastRow.querySelector(".rule-label"));
    if (labelInput) labelInput.focus();
  }
});

resetRulesBtn.addEventListener("click", () => {
  if (!confirm("Replace all rules with the defaults?")) return;
  rules = DEFAULT_RULES.map(r => ({ ...r }));
  renderRules();
});

// --- Save ---

function extractSheetId(url) {
  const match = url.match(GOOGLE_SHEETS_PATTERN);
  return match ? match[1] : null;
}

saveBtn.addEventListener("click", async () => {
  // Validate Sheet URL
  const url = targetDocUrlInput.value.trim();
  const sheetId = extractSheetId(url);
  if (url && !sheetId) {
    saveStatus.textContent = "Invalid Google Sheet URL.";
    saveStatus.className = "status-msg error";
    return;
  }

  // Validate retention
  const retention = parseInt(retentionDaysInput.value, 10);
  if (isNaN(retention) || retention < 1) {
    saveStatus.textContent = "Retention must be at least 1 day.";
    saveStatus.className = "status-msg error";
    return;
  }

  // Validate rules: each must have a label and valid regex
  let hasError = false;
  const patternInputs = rulesList.querySelectorAll(".rule-pattern");
  const labelInputs = rulesList.querySelectorAll(".rule-label");
  for (let i = 0; i < rules.length; i++) {
    const pi = /** @type {HTMLInputElement} */ (patternInputs[i]);
    const li = /** @type {HTMLInputElement} */ (labelInputs[i]);
    pi.style.borderColor = "";
    li.style.borderColor = "";

    if (!rules[i].label.trim()) {
      li.style.borderColor = "var(--md-error)";
      hasError = true;
    }
    if (!rules[i].pattern.trim()) {
      pi.style.borderColor = "var(--md-error)";
      hasError = true;
      continue;
    }
    try {
      new RegExp(rules[i].pattern);
    } catch {
      pi.style.borderColor = "var(--md-error)";
      hasError = true;
    }
  }

  if (hasError) {
    saveStatus.textContent = "Fix the highlighted rule errors.";
    saveStatus.className = "status-msg error";
    return;
  }

  /** @type {Record<string, any>} */
  const settings = { retentionDays: retention, urlRules: rules };
  if (sheetId) {
    settings["targetDocId"] = sheetId;
    settings["targetDocUrl"] = url;
  }

  await chrome.storage.local.set(settings);
  window.close();
});

// --- Import / Export ---

exportSettingsBtn.addEventListener("click", async () => {
  const data = await chrome.storage.local.get(["targetDocUrl", "retentionDays", "urlRules"]);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "auto-work-log-settings.json";
  a.click();
  URL.revokeObjectURL(url);
});

importSettingsBtn.addEventListener("click", () => {
  importFile.click();
});

importFile.addEventListener("change", () => {
  const file = importFile.files && importFile.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(/** @type {string} */ (reader.result));

      // Populate form fields from imported data
      if (data.targetDocUrl) targetDocUrlInput.value = data.targetDocUrl;
      if (data.retentionDays) retentionDaysInput.value = String(data.retentionDays);
      if (Array.isArray(data.urlRules)) {
        rules = data.urlRules;
        renderRules();
      }

      importExportStatus.textContent = "Settings loaded — review and press Save.";
      importExportStatus.className = "status-msg success";
    } catch {
      importExportStatus.textContent = "Invalid JSON file.";
      importExportStatus.className = "status-msg error";
    }
    // Reset so the same file can be re-imported
    importFile.value = "";
  };
  reader.readAsText(file);
});

// --- Init ---

(async () => {
  const data = await chrome.storage.local.get(["targetDocUrl", "retentionDays", "urlRules"]);
  if (data["targetDocUrl"]) targetDocUrlInput.value = data["targetDocUrl"];
  retentionDaysInput.value = data["retentionDays"] || 7;

  // Load rules — use defaults if none exist yet
  rules = data["urlRules"] || DEFAULT_RULES.map(r => ({ ...r }));
  renderRules();

  chrome.identity.getAuthToken({ interactive: false }, (token) => {
    void chrome.runtime.lastError;
    updateAuthUI(!!token);
  });
})();
