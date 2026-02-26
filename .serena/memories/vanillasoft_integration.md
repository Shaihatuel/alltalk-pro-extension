# VanillaSoft Integration - How Leads Load

## VanillaSoft Data Flow

### 1. Lead Detection Process (vanillasoft.js)
The extension uses **universal scraping** to detect lead data from VanillaSoft pages:

#### Utility Functions for Data Validation:
- `cleanPhoneNumber()` - Removes formatting, handles +1 prefix, validates 10-11 digits
- `isPhoneNumber()` - Detects phone numbers (10 or 11 digits with leading 1)
- `isEmail()` - Basic email regex validation
- `isDate()` - Detects DOB formats (YYYY-MM-DD, MM/DD/YYYY)
- `extractState()` - Extracts 2-letter state codes from text
- `extractZip()` - Extracts 5-digit ZIP codes
- `getElementText()` - Unified element text extraction (handles input, textarea, select, div, span)

#### Field Detection Methods:
1. **By ID**: `findByIds(doc, ids)` - Searches for elements by multiple possible ID patterns
2. **By Label**: `findByLabel(doc, labelTexts)` - Finds labels and extracts associated values from siblings
3. **Pattern Matching**: Looks for keywords like "phone", "email", "first name", etc.

### 2. Lead Data Extraction Process
When refresh button clicked in popup:
1. Extension queries current VanillaSoft page via content script
2. `vanillasoft.js` receives message to extract lead data
3. Scraper identifies layout and extracts:
   - First name / Last name
   - Phone number (with cleaning)
   - Email address
   - Street address
   - City / State / ZIP
   - Date of Birth
4. Returns structured contact object to popup.js

### 3. Lead Transmission to AllTalk Pro
From popup.js:
1. User selects workflow from dropdown
2. Clicks "Send Lead" or similar button
3. Extension packages lead data with workflow ID
4. Makes authenticated API call to AllTalk Pro
5. Lead is created/associated with selected workflow

### 4. Data Cleaning Process
- Phone numbers: Removes all non-digits, strips leading +1 or 1
- Emails: Validated against regex pattern
- Addresses: Extracts state and ZIP separately
- DOB: Recognized in multiple formats

### 5. Multi-Layout Support
Vanillasoft.js is designed to work with multiple VanillaSoft UI layouts:
- Searches multiple possible selector paths
- Falls back through different field location patterns
- Validates extracted data matches expected type (email, phone, etc.)
- Handles both form inputs and text-only displays

### 6. Contact Name Detection (vanillasoft.js) - IMPROVED v3.3

**Search Priority (reordered to avoid false positives):**

1. **Known IDs** (highest priority) - Explicit form field IDs
   - #FirstName, #first_name, #firstName, [name="FirstName"], etc.
   
2. **Class-based selectors** - Intentional contact name areas
   - .contact-name, .lead-name, .customer-name
   - [class*="contact-name"], [id*="lead-name"]
   - More reliable than generic tags
   
3. **Panel-scoped searches** - Within contact/lead panels
   - Search within [class*="contact"], [class*="lead"], etc.
   - Priority: input fields (form data) → styled text (strong, b) → headings
   - Keeps search contextual to the contact card
   
4. **Header tags as fallback** - Last resort
   - h1, h2, h3 (now last instead of early)
   - Reduced since these often contain page headers like "VanillaSoft BETA"

**Validation: `isValidName()` - ENHANCED v3.3**

Now rejects:
- Placeholder keywords: 'select', 'choose', 'filter', 'all projects', '--', 'project'
- App/brand keywords: 'vanillasoft', 'alltalk', 'beta', 'pro', 'crm'
- Other system text: 'extension', 'app', 'version', 'loading', 'no data'
- Any individual word matching brand list: ['vanillasoft', 'alltalk', 'beta', 'pro', 'crm']

**Impact**: Prevents false positives like "VanillaSoft BETA" from being parsed as contact names. If h1 contains "VanillaSoft BETA", validation now rejects it because both words match brand keywords.

## Integration Points
- **Trigger**: Refresh button in extension popup
- **Source**: Current VanillaSoft page tab
- **Method**: Content script extracts DOM elements
- **Authentication**: AllTalk Pro bearer token (stored in chrome.storage.local)
- **Destination**: AllTalk Pro API endpoint with workflow context
