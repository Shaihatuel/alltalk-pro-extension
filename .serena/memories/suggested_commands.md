# Development Commands & Operations

## Extension Development & Testing

### Loading/Debugging Extension
```bash
# macOS specific paths
open chrome://extensions/        # Open Chrome extensions page
# or use: Cmd+Shift+X in Chrome

# Enable "Developer mode" toggle in top right
# Click "Load unpacked"
# Select /Users/shaihatuel/Desktop/AllTalk_Pro_Extension_v3.2
```

### Testing Changes
1. After modifying any .js file:
   - Go to chrome://extensions/
   - Click "Reload" button on AllTalk Pro extension
   - Test in VanillaSoft site with extension

2. For manifest.json changes:
   - Must fully unload and reload extension
   - Click the trash icon to unload
   - Click "Load unpacked" again

### Debugging
```bash
# View extension console
# In chrome://extensions/ find AllTalk Pro
# Click on "service_worker" link to open background script debugger

# View popup console
# Right-click extension icon > "Inspect popup"
# Or open popup, right-click > "Inspect"

# View content script console
# Open VanillaSoft page
# Open Developer Tools (F12)
# Console shows content script and vanillasoft.js output
```

## File Operations (macOS)
```bash
# View project structure
ls -la /Users/shaihatuel/Desktop/AllTalk_Pro_Extension_v3.2/

# Check file sizes to understand complexity
ls -lh /Users/shaihatuel/Desktop/AllTalk_Pro_Extension_v3.2/*.js

# Edit files
# Use VS Code or text editor
code /Users/shaihatuel/Desktop/AllTalk_Pro_Extension_v3.2/

# View specific file
cat /Users/shaihatuel/Desktop/AllTalk_Pro_Extension_v3.2/popup.js | head -50
```

## Code Quality Checks

### Search for Issues in Code
```bash
# Check for console.logs (should be minimal in production)
grep -n "console.log" /Users/shaihatuel/Desktop/AllTalk_Pro_Extension_v3.2/*.js

# Find TODO/FIXME comments
grep -n "TODO\|FIXME" /Users/shaihatuel/Desktop/AllTalk_Pro_Extension_v3.2/*.js

# Check for hardcoded URLs (should use ALLTALK_API constant)
grep -n "https://" /Users/shaihatuel/Desktop/AllTalk_Pro_Extension_v3.2/*.js

# Find potential security issues (eval, innerHTML without sanitization)
grep -n "eval\|innerHTML" /Users/shaihatuel/Desktop/AllTalk_Pro_Extension_v3.2/*.js
```

## Testing Workflows

### Manual Testing Checklist
1. Load extension in Chrome
2. Navigate to vanillasoft.net
3. Open extension popup
4. Sign in with AllTalk credentials
5. Click "Refresh Contact" (or similar) to load lead
6. Verify lead data appears correctly
7. Select workflow
8. Send lead to AllTalk Pro
9. Verify lead appears in AllTalk Pro interface
10. Test pop-out mode - click "Pop Out" button

### Authentication Testing
1. Sign in with credentials
2. Wait for workflow load
3. Sign out (if logout button exists)
4. Verify session expired message
5. Sign in again with same credentials
6. Verify token refresh works

## Common Tasks

### Add New Field to Lead
1. Edit vanillasoft.js - add utility function for new field
2. Add field extraction logic to main scraper
3. Update lead object structure
4. Edit popup.js to display new field
5. Test extraction on VanillaSoft page
6. Test transmission to AllTalk Pro

### Debug Lead Scraping
1. Open VanillaSoft page with lead
2. Open extension popup
3. Right-click popup > "Inspect"
4. Check Console for errors
5. Check Network tab for API calls
6. Use "Pick Element" tool if needed

### Test New API Endpoint
1. Check ALLTALK_API constant at top of popup.js
2. Verify endpoint path matches AllTalk Pro API docs
3. Test in apiRequest() function
4. Monitor Network tab in DevTools
5. Check response status and data
