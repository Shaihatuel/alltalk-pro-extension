# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Chrome Extension (Manifest V3) that acts as a one-click lead transfer tool between **VanillaSoft CRM** and the **AllTalk Pro** platform. It scrapes contact/lead data from VanillaSoft pages and submits it to AllTalk Pro workflows via REST API.

**Tech stack**: Vanilla JavaScript, Chrome Extension APIs, HTML5/CSS3 — no build system, no framework, no package manager.

## Development Setup

No build step required. To load the extension:
1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select this folder

Testing is manual — load the extension in Chrome, navigate to a VanillaSoft URL, and test interactions. There are no automated tests or linting configs.

## File Architecture

| File | Role |
|---|---|
| `manifest.json` | Extension config — permissions, host permissions (`*.vanillasoft.net`), content scripts, service worker |
| `popup.js` | Main application (~1744 lines) — authentication, scraping orchestration, API calls, UI logic |
| `popup.html` | Extension popup UI — dark-themed, 320-500px, all user-facing panels |
| `vanillasoft.js` | Universal lead scraper (~818 lines) — DOM extraction for contact data from VanillaSoft pages |
| `content.js` | DOM element picker (~81 lines) — for field mapping; generates CSS selectors for any element |
| `background.js` | Service worker relay (~5 lines) — forwards `PICK_RESULT` messages from content → popup |

### `popup.js` Section Map

The file is divided into commented sections (delimited by `// ============`):
- **Token Management** (~lines 7–160): `getTokens()`, `saveTokens()`, `clearTokens()`, `refreshAccessToken()`
- **UI Status** (~lines 162–235): `setStatus()`, `handleExpiredToken()`
- **Tab & Context** (~lines 236–391): `findVanillaSoftTab()`, `getTargetTabId()`, `sendToContent()`
- **Workflow Management** (~lines 393–437): `loadWorkflows()` — fetches workflows from API
- **Date Formatting** (~lines 438–476): `formatDOB*()` functions
- **Phone Handling** (~lines 493–644): `cleanPhoneNumber()`, `createPhoneButton()`, `renderPhoneButtons()`
- **Contact Scraping** (~lines 661–1352): `autoScrapeContact()`, `scrapeContactFromPage()`, `processScrapedContact()`
- **Authentication** (~lines 1411–1534): `performLogin()`
- **Polling** (~lines 1638–1744): `pollForContactChanges()` — detects lead changes in the VanillaSoft tab

### `vanillasoft.js` Scraper Strategy

The scraper is designed to work across multiple VanillaSoft UI layouts by trying multiple selector paths with fallbacks:
- `findContactName()` — searches by label, ID, and pattern; rejects placeholder values (e.g. `"--|All Projects--"`)
- `findAllPhoneNumbers()` — extracts and deduplicates all phone numbers (10–11 digits)
- `findEmail()`, `findDOB()`, `findAddressInfo()` — each tries multiple strategies before giving up

## Key Constants

```javascript
// API base URL
const ALLTALK_API = "https://api.alltalkpro.com";

// Storage keys (all prefixed with ext_ to avoid conflicts with AllTalk website)
const STORAGE_KEYS = {
  accessToken:        "ext_alltalk_access_token",
  refreshToken:       "ext_alltalk_refresh_token",
  savedEmail:         "ext_alltalk_saved_email",
  savedPassword:      "ext_alltalk_saved_password",
  selectedWorkflow:   "ext_alltalk_selected_workflow",
  vanillasoftTabId:   "ext_vanillasoft_tab_id"
};
```

## API Authentication Pattern

All API calls go through `apiRequest()`, which:
1. Attaches a Bearer token in `Authorization` header
2. Uses `credentials: "omit"` on **every** request (prevents cookie interference with the AllTalk website — do not remove this)
3. On 401, calls `refreshAccessToken()` (race-condition safe via `isRefreshing` flag) and retries
4. On refresh failure, calls `handleExpiredToken()` to clear tokens and prompt re-login

Token refresh hits `POST /api/v1/auth/refresh` and handles multiple API response shapes (nested token structures).

## Code Style Conventions

- **camelCase** for variables and functions; `UPPER_SNAKE_CASE` for constants
- DOM element variables often suffixed with `El` (e.g., `statusEl`, `workflowSelect`)
- Section headers: `// ============================================`
- Always null-check DOM elements before attaching listeners: `if (element) { element.addEventListener(...) }`
- Chrome storage wrapped in Promises for clean async flow
- Comments explain *why*, not *what*; flag critical behavior with `// CRITICAL:`

## Pop-Out Mode

The extension supports a floating pop-out window (separate Chrome window). When in pop-out mode:
- The VanillaSoft tab ID is stored in `ext_vanillasoft_tab_id`
- `pollForContactChanges()` runs on an interval to detect lead changes
- Content script injection may fail on lead transitions — the retry logic in `sendToContent()` handles this
- Known issue: polling can slow down VanillaSoft during rapid lead changes (optimization pending)

## Known Issues / Pending Work

1. **Pop-out auto-refresh** — Needs end-to-end validation in real usage (pop-out + VanillaSoft tab switching)
2. **VanillaSoft slowdown** — Extension polling/injection sometimes slows VanillaSoft during lead changes; needs profiling and reduced injection frequency
3. **AllTalk Pro logout bug** — Users occasionally get logged out of the AllTalk Pro website; suspected refresh-token handling issue at the API level
4. **Chrome Web Store** — Extension not yet published; preparation pending above fixes
