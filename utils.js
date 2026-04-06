// Shared utilities — imported by background.js, popup.js, and options.js.

// --- Default URL rules ---

/** @typedef {{ id: string, label: string, pattern: string, enabled: boolean }} UrlRule */

/** @type {UrlRule[]} */
export const DEFAULT_RULES = [
  { id: "builtin_doc",     label: "Doc",     pattern: "^https://docs\\.google\\.com/document/d/([a-zA-Z0-9_-]+)",     enabled: true },
  { id: "builtin_sheet",   label: "Sheet",   pattern: "^https://docs\\.google\\.com/spreadsheets/d/([a-zA-Z0-9_-]+)", enabled: true },
  { id: "builtin_slide",   label: "Slide",   pattern: "^https://docs\\.google\\.com/presentation/d/([a-zA-Z0-9_-]+)", enabled: true },
  { id: "builtin_form",    label: "Form",    pattern: "^https://docs\\.google\\.com/forms/d/([a-zA-Z0-9_-]+)",        enabled: true },
  { id: "builtin_drawing", label: "Drawing", pattern: "^https://docs\\.google\\.com/drawings/d/([a-zA-Z0-9_-]+)",    enabled: true },
  { id: "builtin_site",    label: "Site",    pattern: "^https://sites\\.google\\.com/[^/]+/([a-zA-Z0-9_-]+)",         enabled: true },
];

// --- URL matching ---

/**
 * Match a URL against a list of rules. Returns file info from the first matching enabled rule.
 * The first capture group in the pattern is used as the document ID.
 * @param {string} url
 * @param {UrlRule[]} rules
 * @returns {{ id: string, type: string } | null}
 */
export function extractFileInfo(url, rules) {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    try {
      const match = url.match(new RegExp(rule.pattern));
      if (match) {
        return { id: match[1] || url, type: rule.label };
      }
    } catch {
      // skip invalid regex
    }
  }
  return null;
}

// --- Date/time ---

export function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatDuration(totalSeconds) {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

// --- Security ---

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
