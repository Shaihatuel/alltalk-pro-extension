# Bug Investigation: Lead Loading Issues

## BUG #1: Leads Not Auto-Loading in Pop-Out Mode - ✅ RESOLVED (v3.3)

### Root Cause (FIXED)
When the extension switches to pop-out mode, leads are not automatically loading when the window pops out.

### Solution (IMPLEMENTED v3.3)

**Three coordinated fixes:**

1. **Retry logic in `getTargetTabId()` (popup.js, lines 294-309)**:
   - When pop-out mode fails to find stored tab ID, now retries `findVanillaSoftTab()` before giving up
   - Logs "running in pop-out mode, retrying findVanillaSoftTab()" to show it's trying again

2. **Visibility logging in `pollForContactChanges()` (popup.js, line 1632)**:
   - When `getTargetTabId()` returns null, logs "Poll: no tabId found, will retry next interval"

3. **Storage guaranteed before window creation (popup.js, lines 198-220)**:
   - Both if/else branches call `chrome.storage.local.set()` before `chrome.windows.create()`

---

## BUG #2: VanillaSoft Slowdown During Lead Changes - 🔴 OPEN

### Summary

The extension causes VanillaSoft to stutter or slow down noticeably when a user advances
to a new lead. Six distinct root causes were identified. They combine additively —
each one alone is tolerable, but all six firing together during a lead transition
creates significant main-thread pressure on VanillaSoft's tab.

---

### ROOT CAUSE 1 — Severity: HIGH
**`doc.body.innerText` forces a synchronous layout recalculation on every scrape**

**Location**: `vanillasoft.js:278` and the duplicate inside `popup.js` (inside `scrapeContactFromPage`, ~line 996)

```javascript
const allText = doc.body ? doc.body.innerText : '';  // ← forced layout
```

`innerText` is not the same as `textContent`. The browser must pause rendering,
flush all pending layout work, and serialize the entire visible text of the document
before returning. On a VanillaSoft CRM page with large tables, many DOM nodes,
and active iframes, this is a synchronous block on the main thread.

`findAllPhoneNumbers()` calls this unconditionally on entry — it runs even when
the contact ID exclusion list produces nothing. `hasContactData()` also calls
`findAllPhoneNumbers()`, so it fires during the polling-triggered name check path too.

**Fix direction**: Replace `doc.body.innerText` with `doc.body.textContent` at `vanillasoft.js:278`
and at the duplicate inside `scrapeContactFromPage` in `popup.js`. `textContent` returns
the raw text without triggering layout, which is sufficient for phone-number regex matching.

---

### ROOT CAUSE 2 — Severity: HIGH
**Polling sends `GET_CONTACT_NAME` every 1 second, running 20+ DOM queries in VanillaSoft's main thread**

**Location**: `popup.js:1733` — `setInterval(pollForContactChanges, 1000)`

Every second, `pollForContactChanges()` sends a message to VanillaSoft's tab.
The `GET_CONTACT_NAME` handler in `vanillasoft.js:778` calls `findContactName(document)`.

`findContactName()` executes on VanillaSoft's JS thread and makes:
- 10 `querySelector` calls via `findByIds` (5 for first name, 5 for last name)
- 8 `querySelectorAll` calls (one per entry in `nameSelectors` array)
- 1 `querySelector` for `leftPanel`
- 1 `querySelectorAll` for `h1, h2, h3, h4, strong, b` on `leftPanel`

That is **20+ DOM queries per second** contending with VanillaSoft's own rendering
and event handling on the same thread. During a lead transition — exactly when
VanillaSoft is doing its own DOM mutations to load new contact data — these queries
arrive at the worst possible time.

Additionally, every single `GET_CONTACT_NAME` message response logs two `console.log`
lines in VanillaSoft's tab (`vanillasoft.js:676` and `vanillasoft.js:783`), which
adds serialization overhead when DevTools is open (the common scenario for debugging).

**Fix direction**: Increase polling interval from 1000ms to 3000ms or 5000ms.
For the console.log spam, guard with a debug flag or remove the per-poll logs.

---

### ROOT CAUSE 3 — Severity: HIGH
**During a lead transition, `pollForContactChanges` AND `autoScrapeContact` inject `vanillasoft.js` concurrently**

**Sequence during a lead change**:

1. `pollForContactChanges()` fires (every 1s) → receives "Receiving end does not exist" →
   immediately calls `chrome.scripting.executeScript({ files: ["vanillasoft.js"] })` (`popup.js:1667`)

2. 500ms later, `pollForContactChanges` fires again → detects name change →
   calls `autoScrapeContact()` (`popup.js:1696`)

3. `autoScrapeContact()` independently fires three more `executeScript` calls:
   - `popup.js:686`: `executeScript({ allFrames: false, func: scrapeContactFromPage })`
   - `popup.js:710`: `executeScript({ allFrames: true,  func: scrapeContactFromPage })` ← ALL frames
   - `popup.js:734`: `executeScript({ allFrames: true,  files: ["vanillasoft.js"] })` ← ALL frames

Result: **4+ executeScript calls hit the VanillaSoft tab within ~500ms** of a lead
transition. The two `allFrames: true` calls run the full scraper function simultaneously
in every iframe VanillaSoft has open (the CRM uses multiple iframes for its layout panels).

**Fix direction**: Add a boolean guard flag (e.g., `isScraping`) in `autoScrapeContact`
and check it in `pollForContactChanges` before attempting injection. If a scrape is
already in progress, skip the injection retry in `pollForContactChanges`.

---

### ROOT CAUSE 4 — Severity: MEDIUM
**`autoScrapeContact` retries itself up to 3× on failure, multiplying the executeScript cascade**

**Location**: `popup.js:792-797`

```javascript
if (!ok) {
  chrome.storage.local.remove([STORAGE_KEYS.vanillasoftTabId]);  // ← drops stored tab ID
  if (retryCount < 2) {
    setTimeout(() => autoScrapeContact(retryCount + 1), 500);
    return;
  }
}
```

When a scrape fails (common during lead transitions), `autoScrapeContact` is called
up to 3 times total (retryCount 0, 1, 2). Each call repeats the 3-step executeScript
cascade from Root Cause 3. In the worst case that is **9 executeScript calls** from
retries alone before the function gives up.

Additionally, each retry calls `chrome.storage.local.remove([STORAGE_KEYS.vanillasoftTabId])`,
which forces `getTargetTabId()` to do a full `findVanillaSoftTab()` tab scan on the
next call — unnecessary overhead when the tab is still alive.

**Fix direction**: The storage.remove on retry is incorrect — the tab is still there,
only the scrape failed. Remove that line. Consider reducing `retryCount < 2` to
`retryCount < 1` (one retry only) since Root Cause 3's fix will already reduce the
concurrency problem.

---

### ROOT CAUSE 5 — Severity: MEDIUM
**Shared `injectionRetryCounts` counter is corrupted by three concurrent callers**

**Location**: `popup.js:25` — `const injectionRetryCounts = {};` used by:
- `sendToContent()` (~line 345)
- `pollForContactChanges()` (~line 1657)
- `autoScrapeContact()` (~line 766)

All three read and write `injectionRetryCounts[tabId]`. `MAX_INJECTION_RETRIES = 2`.

During a lead transition all three can run concurrently. If `pollForContactChanges`
increments the counter to 1 and `autoScrapeContact` independently increments it to 2,
`showInjectionExhaustedNotice()` fires (popup.js:1660 / popup.js:374) and shows
"Connection lost — please reload the VanillaSoft tab" even though the tab is perfectly
fine. The user sees a false error.

Counter resets also race: `autoScrapeContact` resets to 0 on success (line 758),
`pollForContactChanges` resets to 0 on success (line 1710). Whichever runs last wins,
potentially resetting the counter while the other path is mid-retry.

**Fix direction**: Give each call site its own counter namespace
(e.g., `injectionRetryCounts.poll[tabId]` vs `injectionRetryCounts.scrape[tabId]`)
or make the counter a local variable per invocation since the retry logic is already
bounded by `MAX_INJECTION_RETRIES` in each call site.

---

### ROOT CAUSE 6 — Severity: LOW
**`console.log` in `vanillasoft.js` fires on every single poll cycle**

**Location**: `vanillasoft.js:676` and `vanillasoft.js:783`

```javascript
// Line 676 — fires for every message, including GET_CONTACT_NAME every second:
console.log("Message received in:", window.location.href, "type:", msg.type);

// Line 783 — fires on every successful poll response:
console.log("GET_CONTACT_NAME responding with:", name);
```

With 1-second polling, these produce 2 console.log entries per second in the
VanillaSoft tab. When DevTools is open (the typical debugging state), each call
involves string serialization and IPC to DevTools. Over a 5-minute session that
is 600 log entries from polling alone. Low individually, but it adds background
noise and makes the console harder to use for diagnosing real issues.

**Fix direction**: Remove the `"Message received in:"` log at line 676 entirely
(it fires for every message type, not just debugging scenarios). Change the
`"GET_CONTACT_NAME responding with:"` log to only fire when the name has changed.

---

### Combined Impact During a Lead Transition

A single lead change triggers (worst case, all causes combined):
- 1× `innerText` forced layout in the poll handler (Root Cause 1)
- 4–12× `executeScript` calls hitting the tab (Root Causes 3 + 4)
- 20+ DOM queries per second from continued polling during scraping (Root Cause 2)
- Possible false "Connection lost" notice due to counter corruption (Root Cause 5)
- Console noise making debugging harder (Root Cause 6)

---

### Recommended Fix Priority

| # | Root Cause | File | Line(s) | Effort |
|---|---|---|---|---|
| 1 | Replace `innerText` with `textContent` | `vanillasoft.js` + `popup.js` | 278, ~996 | Tiny |
| 2 | Add `isScraping` guard to prevent concurrent injections | `popup.js` | 661, 1638 | Small |
| 3 | Increase poll interval to 3000ms | `popup.js` | 1733 | 1 line |
| 4 | Remove `storage.remove` in retry path | `popup.js` | 793 | 1 line |
| 5 | Separate `injectionRetryCounts` per call site | `popup.js` | 25, 345, 766, 1657 | Small |
| 6 | Remove per-poll `console.log` calls | `vanillasoft.js` | 676, 783 | Tiny |
