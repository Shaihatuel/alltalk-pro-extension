# Next Session Checklist

Date: 2026-02-17

## Summary of Work Completed
- Fixed placeholder validation so names like "--|All Projects --" are rejected and no longer load as contacts.
- Fixed pop-out auto-refresh behavior and added injection-retry logic to handle content-script disconnects.
- Performed a workspace-wide security/storage scan and confirmed extension tokens/credentials use `ext_`-prefixed keys and `chrome.storage.local`; network requests use `credentials: "omit"` to avoid cookie interference.

## Remaining Items / Needs Testing
- Confirm pop-out auto-refresh works reliably in real-world usage (pop-out + VanillaSoft tab changes).
- Investigate why the extension sometimes slows down VanillaSoft during lead changes (performance profiling / reduce injection frequency).
- Investigate AllTalk Pro website logout issue — likely related to refresh-token handling at API level (requires backend/API review and token separation verification beyond client storage keys).

## Next Session Tasks
1. Debug and resolve refresh-token logout behavior (coordinate with API/backend if needed).
2. Optimize injection-retry logic and polling to minimize impact on VanillaSoft (reduce polling frequency, add backoff, avoid re-injecting unnecessarily).
3. Run end-to-end tests and UX validation for pop-out mode and lead-change flows.
4. Once confirmed stable, prepare and publish updated extension to the Chrome Web Store.

## Notes
- All current token storage is namespaced with `ext_` and uses `chrome.storage.local`.
- Consider adding telemetry or short-lived profiling logs to reproduce slowdown and measure improvements.
