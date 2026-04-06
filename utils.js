// Shared utilities — imported by background.js and popup.js as an ES module.

// --- URL parsing ---

// Matches Docs, Sheets, Slides, Forms, and Drawings
const WORKSPACE_PATTERN = /^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation|forms|drawings)\/d\/([a-zA-Z0-9_-]+)/;
const SITES_PATTERN = /^https:\/\/sites\.google\.com\/[^/]+\/([a-zA-Z0-9_-]+)/;

const WORKSPACE_TYPE_MAP = {
  document: "Doc",
  spreadsheets: "Sheet",
  presentation: "Slide",
  forms: "Form",
  drawings: "Drawing",
};

export function extractFileInfo(url) {
  let match = url.match(WORKSPACE_PATTERN);
  if (match) return { id: match[2], type: WORKSPACE_TYPE_MAP[match[1]] || match[1] };

  match = url.match(SITES_PATTERN);
  if (match) return { id: match[1], type: "Site" };

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
