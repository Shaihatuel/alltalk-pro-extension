# Code Style & Conventions

## JavaScript Style (Vanilla JS, no framework)

### Naming Conventions
- **Variables**: camelCase (e.g., `statusEl`, `accessToken`, `isRefreshing`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `ALLTALK_API`, `STORAGE_KEYS`)
- **Functions**: camelCase (e.g., `getTokens()`, `refreshAccessToken()`)
- **Objects/Classes**: PascalCase (if any constructors used)
- **DOM element variables**: Often suffixed with "El" (e.g., `statusEl`, `workflowSelect`)

### Code Organization
1. **Comments Section Headers**: Use `// ============================================`
2. **Function Groups**: Related functions grouped in commented sections
3. **Storage/Constants**: Defined at top of file
4. **Error Handling**: Try-catch for async operations
5. **Comments**: Describe "why" not "what" - code should be self-documenting

### Async/Await Pattern
```javascript
async function example() {
  try {
    const result = await somePromise();
    return result;
  } catch (error) {
    // Handle error
  } finally {
    // Cleanup if needed
  }
}
```

### Promise Pattern (fallback)
```javascript
function getTokens() {
  return new Promise((resolve) => {
    chrome.storage.local.get([...], (result) => {
      resolve(result);
    });
  });
}
```

### DOM Event Listeners
```javascript
if (element) {
  element.addEventListener("click", async () => {
    // Handle event
  });
}
```

### Chrome Extension APIs
- Always check if element exists before adding listeners
- Use `chrome.storage.local` for persistent data
- Use `chrome.runtime.onMessage` for cross-script communication
- Use `chrome.tabs.query()` for tab operations
- Use `chrome.windows.create()` for window management

## HTML Style (popup.html)

### Structure
- Semantic HTML with clear structure
- Dark theme (#25293b background, #e5e7eb text)
- Flexbox for layouts
- Responsive with min-width/height

### CSS Conventions
- BEM-like naming: `.class-name` not `.className`
- Inline styles: Minimal, prefer external <style>
- Transitions: `transition: all 0.15s ease;`
- Colors: Hex codes with dark theme palette

### Button Styling
- Background: `#3d4357` (dark gray)
- Hover: Lighter shade `#4d5367`
- Text: `#9ca3af` (light gray) or `#e5e7eb` (light)
- Padding: `3px 8px` for small, `8px 12px` for regular

## Security Practices

### Credentials
- Never hardcode credentials
- Store tokens with prefixed keys to avoid conflicts
- Use bearer token pattern for API auth
- Clear tokens on session expiration

### API Calls
- Always use `credentials: "omit"` to prevent cookie interference
- Validate response status codes
- Handle 401 (unauthorized) with token refresh
- Validate data structure before using

### Content Scripts
- Validate element selectors before using
- Sanitize scraped text data
- Don't expose sensitive data in logs
- Handle missing elements gracefully

## Documentation Style

### Comments
```javascript
// ============================================
// SECTION NAME
// ============================================

// Single line comment for clarity
function doSomething() {
  // Explain non-obvious logic
  return result;
}
```

### Inline Documentation
- Minimal but clear
- Explain "why" not "what"
- Note critical sections (e.g., "CRITICAL: credentials: 'omit'")
- Flag breaking changes or version differences

## Error Handling

### API Errors
```javascript
if (!response.ok) {
  // Handle specific error
  throw new Error("Descriptive message");
}
```

### Async Errors
```javascript
try {
  // Async operation
} catch (error) {
  console.error("Context: " + error.message);
  // Handle gracefully
}
```

## Testing Notes
- Console.log used for debugging (check vanillasoft.js line 1)
- Status messages shown in UI for user feedback
- Error states persist in UI (token status, workflow dropdown)
- No unit tests detected - manual testing used
