# AllTalk Pro Extension v3.2 - Project Overview

## Project Purpose
AllTalk Pro is a Chrome browser extension that transfers contact/lead information from VanillaSoft CRM (a call center platform) to AllTalk Pro platform with one click. It enables seamless integration between VanillaSoft leads and AllTalk Pro workflows.

## Tech Stack
- **Language**: JavaScript (vanilla JavaScript, no frameworks)
- **Platform**: Chrome Extension (Manifest v3)
- **Architecture**: Service Worker + Content Scripts + Popup UI
- **APIs**: 
  - AllTalk Pro API (https://api.alltalkpro.com)
  - VanillaSoft CRM (browser-based, scraped via content scripts)
- **Storage**: Chrome extension local storage for tokens and settings

## Project Structure
```
AllTalk_Pro_Extension_v3.2/
├── manifest.json          # Extension configuration (v3)
├── popup.html             # UI for extension popup
├── popup.js               # Popup logic (1539 lines) - main application logic
├── background.js          # Service worker for background tasks
├── content.js             # Content script for lead picking
├── vanillasoft.js         # VanillaSoft lead scraper (751 lines)
├── icon*.png              # Extension icons (16, 48, 128)
└── logo.png               # Logo for UI
```

## Core Components

### 1. Manifest.json
- **Manifest Version**: 3
- **Permissions**: activeTab, scripting, storage, tabs
- **Host Permissions**: VanillaSoft.net domains only
- **Content Scripts**: Run on VanillaSoft pages at "document_idle"
- **Service Worker**: background.js for persistent operations

### 2. popup.js (Main Application Logic)
- **1539 lines of JavaScript**
- Handles authentication (token management)
- API requests to AllTalk Pro
- Workflow selection and lead transmission
- Phone number button generation
- Pop-out window functionality

### 3. vanillasoft.js (Lead Scraper)
- **751 lines of JavaScript**
- Universal scraper for multiple VanillaSoft layouts
- Extracts contact data: name, phone, email, address, state, zip, DOB
- Utility functions for data validation and cleaning
- Pattern matching for different field layouts

### 4. content.js (Element Picker)
- Enables "pick element" mode for mapping VanillaSoft fields
- Generates CSS selectors for any DOM element
- Sends picked element data back to extension
- Supports reading and setting element text/values

### 5. background.js (Service Worker)
- Minimal - just relays PICK_RESULT messages
