# Auto Work Log

A Chrome extension that tracks which Google Docs you visit and how long you spend on each. At the end of each day, it exports the log to a Google Sheet of your choice, with the most recent day inserted at the top.

## Features

- **Automatic tracking** — Logs every Google Doc you visit with time spent and visit count
- **Focus-aware** — Pauses tracking when you switch tabs or the browser loses focus
- **Daily export to Google Sheets** — Inserts a structured summary into your target sheet at end of day, newest first
- **Catch-up on missed exports** — If your computer was asleep or off, exports any missed days on next launch
- **Manual export** — Export anytime via the popup
- **Per-document breakdown** — Each row has date, title, URL, time spent, visits, and raw seconds

## Setup

### 1. Create Google Cloud OAuth credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**
2. Create a new **OAuth 2.0 Client ID** with application type **Chrome Extension**
3. Enable the **Google Sheets API** under **APIs & Services** → **Library**
4. Load the extension first (step 2 below) to get the extension ID, then add it to your OAuth client
5. Copy your client ID and paste it into `manifest.json` replacing `YOUR_CLIENT_ID.apps.googleusercontent.com`

### 2. Load the extension

1. Navigate to `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this project folder
4. Note the extension ID shown on the card — add it to your OAuth client from step 1

### 3. Configure

1. Click the extension icon in the toolbar
2. Click **Sign in with Google**
3. Paste the full URL of your target Google Sheet and click **Save**

## Usage

Once configured, the extension runs silently in the background. Click the extension icon anytime to:

- View today's tracked Google Docs with time spent
- Manually export to your Google Sheet
- Clear the day's log

The daily auto-export runs at 11:59 PM. If your computer is asleep, it will catch up when Chrome next starts.

## Sheet format

The extension auto-creates a header row and inserts new entries at the top (row 2), so the most recent day is always first:

| Date | Document Title | URL | Time Spent | Visits | Seconds |
|------|---------------|-----|-----------|--------|---------|
| 2026-04-03 | Project Proposal | https://docs.google.com/document/d/abc123/edit | 45m 12s | 3 | 2712 |
| 2026-04-03 | Meeting Notes | https://docs.google.com/document/d/def456/edit | 12m 5s | 1 | 725 |
| 2026-04-02 | ... | ... | ... | ... | ... |

The raw `Seconds` column is included so you can use Sheets formulas (SUM, charts, etc.) on the data.

## Project structure

```
├── manifest.json      # Extension manifest (v3)
├── background.js      # Service worker — tracking, alarms, Sheets export
├── popup.html         # Popup UI
├── popup.js           # Popup logic
├── styles.css         # Popup styles
└── icons/             # Extension icons
```
