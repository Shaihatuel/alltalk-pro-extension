# Authentication & Token Management Flow

## Token Storage Architecture
All tokens stored with prefixed keys to avoid conflicts with AllTalk website:

```javascript
const STORAGE_KEYS = {
  accessToken: "ext_alltalk_access_token",
  refreshToken: "ext_alltalk_refresh_token",
  savedEmail: "ext_alltalk_saved_email",
  savedPassword: "ext_alltalk_saved_password",
  selectedWorkflow: "ext_alltalk_selected_workflow",
  vanillasoftTabId: "ext_vanillasoft_tab_id"
};
```

## Token Functions

### getTokens()
- Retrieves both access and refresh tokens from chrome.storage.local
- Returns Promise with {accessToken, refreshToken} object
- Returns nulls if tokens not found

### saveTokens(accessToken, refreshToken)
- Saves tokens to chrome.storage.local with prefixed keys
- refreshToken is optional
- Returns Promise when complete

### clearTokens()
- Removes both access and refresh tokens
- Used on session expiration
- Called by handleExpiredToken()

## Token Refresh Mechanism

### refreshAccessToken()
- Prevents concurrent refresh attempts (race condition safe)
- Uses `isRefreshing` flag and `refreshPromise` for deduplication
- Sends refresh_token to `ALLTALK_API/api/v1/auth/refresh`
- Critical: Uses `credentials: "omit"` to prevent cookie interference
- Extracts new tokens from nested response structure (handles multiple API versions)

### API Request Handler (apiRequest)
- Automatic bearer token inclusion in Authorization header
- Intercepts 401 responses and triggers token refresh
- Falls back to handleExpiredToken() if refresh fails
- Uses `credentials: "omit"` for all API calls

## Security Notes
- Tokens stored unencrypted in chrome.storage.local (standard Chrome extension practice)
- `credentials: "omit"` prevents CSRF and cookie conflicts with AllTalk website
- Refresh token rotated on each successful refresh
- No cookies sent between extension and API
- Bearer token in Authorization header for all authenticated requests

## API Base URL
- Production: https://api.alltalkpro.com
- All endpoints relative to this base (e.g., `/api/v1/auth/refresh`)
