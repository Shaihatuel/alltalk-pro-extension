# Pop-Out Mode - How It Works

## Pop-Out Functionality Overview
Pop-Out mode allows the extension popup to open as a separate floating window instead of in the browser's extension popup drawer. This is useful for multitasking and keeping the extension UI visible while working in VanillaSoft.

## Implementation Details (popup.js)

### 1. Pop-Out Button
Located in popup.html header:
- Button ID: `popOutBtn`
- Classes: `.pop-out-btn` (small, 10px font size)
- Styling: Dark theme with hover effects
- Position: Top-right of popup header

### 2. Pop-Out Initialization Flow
When user clicks "Pop Out" button:

```javascript
popOutBtn.addEventListener("click", async () => {
  // Step 1: Get current VanillaSoft tab ID
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (tab && tab.id) {
    // Step 2: Store tab ID in chrome.storage.local
    chrome.storage.local.set({ 
      [STORAGE_KEYS.vanillasoftTabId]: tab.id 
    }, () => {
      // Step 3: Create new popup window
      chrome.windows.create({
        url: chrome.runtime.getURL("popup.html"),
        type: "popup",
        width: 480,
        height: 600
      });
      
      // Step 4: Close original popup
      window.close();
    });
  }
});
```

### 3. Window Specifications
- **Type**: Chrome popup window (floating window)
- **Dimensions**: 480px wide × 600px tall
- **Content**: Same popup.html (reused)
- **URL**: chrome-extension:// URI pointing to popup.html

### 4. Tab Context Preservation
- VanillaSoft tab ID is stored in: `ext_vanillasoft_tab_id` (chrome.storage.local)
- Allows popped-out window to:
  - Reference the correct VanillaSoft tab
  - Send refresh requests to correct tab
  - Maintain context even if user switches tabs

### 5. Workflow Context Maintenance
When pop-out is created:
- Selected workflow persists via storage key: `ext_alltalk_selected_workflow`
- User credentials maintained: `ext_alltalk_saved_email`, `ext_alltalk_saved_password`
- Tokens preserved: `ext_alltalk_access_token`, `ext_alltalk_refresh_token`
- Lead data can be sent to AllTalk Pro from popped-out window

### 6. Key Behaviors
- Pop-out window is independent - closing it doesn't affect browser
- New window can be repositioned freely on screen
- All storage is shared (window storage is same as popup storage)
- Refresh button still targets the stored VanillaSoft tab ID
- Works across multiple monitor setups

### 7. Storage Key for Tab Context
```javascript
const STORAGE_KEYS = {
  // ... other keys ...
  vanillasoftTabId: "ext_vanillasoft_tab_id"
};
```
This key stores the numeric tab ID to maintain context in pop-out mode.

## Polling Fix (v3.3 - RESOLVED)

### Issue
Polling for lead changes stopped working after the first lead loaded in pop-out mode. The `pollForContactChanges()` function would return early with no logging when `getTargetTabId()` returned null, making it impossible to detect when users switched to a new lead.

### Root Cause
- `getTargetTabId()` in pop-out mode intentionally refused to query the active tab (to avoid picking up the pop-out window itself)
- It only relied on stored tab ID, and if that lookup failed, it gave up immediately
- `pollForContactChanges()` had no logging when this happened, making failures invisible
- `popOutBtn` handler didn't guarantee storage was updated before `chrome.windows.create()` was called

### Fix Applied (v3.3)
1. **Retry logic in `getTargetTabId()` (lines 294-309)**:
   - When in pop-out mode with no stored tab ID, now calls `findVanillaSoftTab()` twice
   - First attempt: `findVanillaSoftTab()` 
   - If that fails: explicitly retries with logging "retrying findVanillaSoftTab()"
   - Stores result if found on retry
   - Gives pop-out mode a second chance before giving up

2. **Logging in `pollForContactChanges()` (line 1632)**:
   - When `getTargetTabId()` returns null, now logs: "Poll: no tabId found, will retry next interval"
   - Makes polling visibility clear—it's alive and trying, not silently dead

3. **Storage timing in `popOutBtn` handler (lines 214-220)**:
   - Both if/else branches now call `chrome.storage.local.set()` before `chrome.windows.create()`
   - Else branch explicitly saves null to storage to ensure storage callback fires first
   - New pop-out window always has consistent storage state ready when it initializes

### Result
Polling now reliably detects lead changes in pop-out mode. When a new lead loads in the VanillaSoft tab, the next polling cycle detects the name change and triggers `autoScrapeContact()`, displaying the new lead data in the pop-out window.

## Use Case
- Agent opens extension while viewing VanillaSoft lead
- Clicks "Pop Out" to get floating extension window
- Continues reviewing VanillaSoft lead details in main window
- Uses pop-out window to configure and send to AllTalk Pro
- Can resize, move, or minimize pop-out window as needed
