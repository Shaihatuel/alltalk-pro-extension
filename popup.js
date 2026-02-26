const statusEl = document.getElementById("status");
const workflowSelect = document.getElementById("workflowSelect");
const popOutBtn = document.getElementById("popOutBtn");
const refreshContactBtn = document.getElementById("refreshContact");
const phoneButtonsContainer = document.getElementById("phoneButtonsContainer");

// ============================================
// TOKEN MANAGEMENT & API INTERCEPTOR
// ============================================

const ALLTALK_API = "https://api.alltalkpro.com";

// Use prefixed keys to avoid conflicts with the AllTalk website
const STORAGE_KEYS = {
  accessToken: "ext_alltalk_access_token",
  refreshToken: "ext_alltalk_refresh_token",
  savedEmail: "ext_alltalk_saved_email",
  savedPassword: "ext_alltalk_saved_password",
  selectedWorkflow: "ext_alltalk_selected_workflow",
  vanillasoftTabId: "ext_vanillasoft_tab_id"
};

// Injection retry tracking to avoid repeated attempts
const MAX_INJECTION_RETRIES = 2;
const injectionRetryCounts = {}; // map of tabId -> retry count

let isScraping = false;
let isRefreshing = false;
let refreshPromise = null;

function getTokens() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.accessToken, STORAGE_KEYS.refreshToken], (result) => {
      resolve({
        accessToken: result[STORAGE_KEYS.accessToken] || null,
        refreshToken: result[STORAGE_KEYS.refreshToken] || null
      });
    });
  });
}

function saveTokens(accessToken, refreshToken) {
  return new Promise((resolve) => {
    const data = { [STORAGE_KEYS.accessToken]: accessToken };
    if (refreshToken) {
      data[STORAGE_KEYS.refreshToken] = refreshToken;
    }
    chrome.storage.local.set(data, resolve);
  });
}

function clearTokens() {
  return new Promise((resolve) => {
    chrome.storage.local.remove([STORAGE_KEYS.accessToken, STORAGE_KEYS.refreshToken], resolve);
  });
}

async function refreshAccessToken() {
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  isRefreshing = true;
  
  refreshPromise = (async () => {
    const tokens = await getTokens();
    
    if (!tokens.refreshToken) {
      throw new Error("No refresh token available");
    }

    try {
      // CRITICAL: Use credentials: 'omit' to prevent ANY cookie interference
      const response = await fetch(`${ALLTALK_API}/api/v1/auth/refresh`, {
        method: "POST",
        credentials: "omit", // Don't send or receive cookies
        headers: {
          "Content-Type": "application/json",
          "Accept-Language": "en"
        },
        body: JSON.stringify({
          refresh_token: tokens.refreshToken
        })
      });

      if (!response.ok) {
        await clearTokens();
        throw new Error("Refresh token expired");
      }

      const data = await response.json();
      const newAccessToken = data.data?.tokens?.access_token || data.access_token;
      const newRefreshToken = data.data?.tokens?.refresh_token || data.refresh_token || tokens.refreshToken;

      if (!newAccessToken) {
        throw new Error("No access token in refresh response");
      }

      await saveTokens(newAccessToken, newRefreshToken);
      return newAccessToken;
    } catch (error) {
      throw error;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function apiRequest(endpoint, options = {}) {
  const tokens = await getTokens();
  
  if (!tokens.accessToken) {
    return { ok: false, status: 401, error: "Not authenticated" };
  }

  const headers = {
    "accept": "application/json",
    "Accept-Language": "en",
    "Authorization": `Bearer ${tokens.accessToken}`,
    ...options.headers
  };

  const url = endpoint.startsWith("http") ? endpoint : `${ALLTALK_API}${endpoint}`;

  try {
    // CRITICAL: Use credentials: 'omit' to prevent ANY cookie interference
    let response = await fetch(url, { 
      ...options, 
      headers,
      credentials: "omit" // Don't send or receive cookies
    });

    if (response.status === 401) {
      try {
        const newAccessToken = await refreshAccessToken();
        headers.Authorization = `Bearer ${newAccessToken}`;
        response = await fetch(url, { 
          ...options, 
          headers,
          credentials: "omit" // Don't send or receive cookies
        });
        
        if (response.status === 401) {
          handleExpiredToken();
          return { ok: false, status: 401, error: "Session expired" };
        }
      } catch (refreshError) {
        handleExpiredToken();
        return { ok: false, status: 401, error: "Session expired" };
      }
    }

    const data = await response.json();
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// ============================================
// CORE FUNCTIONS
// ============================================

function setStatus(msg) {
  if (statusEl) {
    statusEl.textContent = `Status: ${msg}`;
  }
}

// Show a small UI notice when injection retries are exhausted
function showInjectionExhaustedNotice() {
  if (typeof contactPreviewEl !== 'undefined' && contactPreviewEl) {
    contactPreviewEl.innerHTML = '<div class="field" style="color: #f87171;">Connection lost — please reload the VanillaSoft tab.</div>';
    contactPreviewEl.className = 'contact-preview active';
  }
  setStatus('Connection lost - reload VanillaSoft');
}

function handleExpiredToken() {
  clearTokens().then(() => {
    chrome.storage.local.get([STORAGE_KEYS.savedEmail, STORAGE_KEYS.savedPassword], (result) => {
      const savedEmail = result[STORAGE_KEYS.savedEmail];
      const savedPassword = result[STORAGE_KEYS.savedPassword];

      if (savedEmail && savedPassword && loginEmail && loginPassword) {
        loginEmail.value = savedEmail;
        loginPassword.value = savedPassword;
        if (tokenStatusEl) {
          tokenStatusEl.textContent = "Re-authenticating...";
          tokenStatusEl.className = "token-status";
        }
        setStatus("Re-authenticating...");
        performLogin();
        return;
      }

      // No saved credentials — show login form for manual sign-in
      if (tokenStatusEl) {
        tokenStatusEl.textContent = "Session expired - please sign in again";
        tokenStatusEl.className = "token-status";
      }
      if (settingsSection) {
        settingsSection.style.display = "block";
      }
      if (workflowSelect) {
        workflowSelect.innerHTML = '<option value="">Sign in to load workflows...</option>';
        workflowSelect.disabled = true;
      }
      setStatus("Session expired");
    });
  });
}

// Pop Out button
if (popOutBtn) {
  popOutBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.storage.local.set({ [STORAGE_KEYS.vanillasoftTabId]: tab.id }, () => {
        chrome.windows.create({
          url: chrome.runtime.getURL("popup.html"),
          type: "popup",
          width: 480,
          height: 600
        });
        window.close();
      });
    } else {
      // Even if active tab lookup failed, save to storage BEFORE opening pop-out
      // so getTargetTabId can use stored ID as fallback
      chrome.storage.local.set({ [STORAGE_KEYS.vanillasoftTabId]: null }, () => {
        chrome.windows.create({
          url: chrome.runtime.getURL("popup.html"),
          type: "popup",
          width: 480,
          height: 600
        });
        window.close();
      });
    }
  });
}

// Listen for lead change messages from content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "LEAD_CHANGED") {
    autoScrapeContact();
  }
});

// Find VanillaSoft tab across ALL windows in the browser
async function findVanillaSoftTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: ["https://vanillasoft.net/*", "https://*.vanillasoft.net/*"] }, (tabs) => {
      if (chrome.runtime.lastError) {
        console.log("Error querying tabs:", chrome.runtime.lastError);
        resolve(null);
        return;
      }
      
      if (tabs && tabs.length > 0) {
        console.log("Found VanillaSoft tab:", tabs[0].id, tabs[0].url);
        resolve(tabs[0]);
        return;
      }
      
      console.log("No VanillaSoft tabs found");
      resolve(null);
    });
  });
}

async function getTargetTabId() {
  return new Promise(async (resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.vanillasoftTabId], async (result) => {
      if (result[STORAGE_KEYS.vanillasoftTabId]) {
        chrome.tabs.get(result[STORAGE_KEYS.vanillasoftTabId], async (tab) => {
          if (chrome.runtime.lastError || !tab) {
            chrome.storage.local.remove([STORAGE_KEYS.vanillasoftTabId]);
            const vsTab = await findVanillaSoftTab();
            if (vsTab) {
              chrome.storage.local.set({ [STORAGE_KEYS.vanillasoftTabId]: vsTab.id });
              console.log('getTargetTabId: found VanillaSoft tab via findVanillaSoftTab ->', vsTab.id);
              resolve(vsTab.id);
            } else {
              console.log('getTargetTabId: no VanillaSoft tab found, resolving null');
              resolve(null);
            }
          } else if (tab.url && (tab.url.includes("vanillasoft.net"))) {
            console.log('getTargetTabId: resolved stored id ->', result[STORAGE_KEYS.vanillasoftTabId]);
            resolve(result[STORAGE_KEYS.vanillasoftTabId]);
          } else {
            chrome.storage.local.remove([STORAGE_KEYS.vanillasoftTabId]);
            const vsTab = await findVanillaSoftTab();
            if (vsTab) {
              chrome.storage.local.set({ [STORAGE_KEYS.vanillasoftTabId]: vsTab.id });
              console.log('getTargetTabId: found VanillaSoft tab via findVanillaSoftTab ->', vsTab.id);
              resolve(vsTab.id);
            } else {
              console.log('getTargetTabId: no VanillaSoft tab found, resolving null');
              resolve(null);
            }
          }
        });
      } else {
        const vsTab = await findVanillaSoftTab();
        if (vsTab) {
          chrome.storage.local.set({ [STORAGE_KEYS.vanillasoftTabId]: vsTab.id });
          console.log('getTargetTabId: found VanillaSoft tab via findVanillaSoftTab ->', vsTab.id);
          resolve(vsTab.id);
        } else {
          // If this popup is running in a pop-out window, do NOT fall back to
          // querying the active tab in the current window (that would return
          // the pop-out itself). Instead, rely only on the stored tab id.
          const isPopOutMode = window.location.href.includes("popup.html") && !window.opener;

          if (isPopOutMode) {
            // In pop-out mode we cannot safely assume the active tab is
            // the VanillaSoft tab, and falling back would pick the pop-out.
            // Try findVanillaSoftTab() again to give it a second chance
            // before giving up entirely.
            console.log('getTargetTabId: running in pop-out mode, retrying findVanillaSoftTab()');
            const retryTab = await findVanillaSoftTab();
            if (retryTab) {
              chrome.storage.local.set({ [STORAGE_KEYS.vanillasoftTabId]: retryTab.id });
              console.log('getTargetTabId: found VanillaSoft tab on retry ->', retryTab.id);
              resolve(retryTab.id);
            } else {
              console.log('getTargetTabId: retry failed, resolving null');
              resolve(null);
            }
          } else {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (activeTab && activeTab.url && activeTab.url.includes("vanillasoft.net")) {
              chrome.storage.local.set({ [STORAGE_KEYS.vanillasoftTabId]: activeTab.id });
              console.log('getTargetTabId: resolved activeTab ->', activeTab.id);
              resolve(activeTab.id);
            } else {
              console.log('getTargetTabId: activeTab not VanillaSoft, resolving null');
              resolve(null);
            }
          }
        }
      }
    });
  });
}

async function sendToContent(type, data = {}) {
  const tabId = await getTargetTabId();
  if (!tabId) {
    return { ok: false, error: "No tab found" };
  }
  return new Promise((resolve) => {
    const doSend = () => {
      chrome.tabs.sendMessage(tabId, { type, ...data }, async (response) => {
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message || '';
          // If missing receiving end, try injecting the content script (bounded retries)
          if (errMsg.includes('Receiving end does not exist') || errMsg.includes('Could not establish connection')) {
            const currentRetries = injectionRetryCounts[tabId] || 0;
            if (currentRetries < MAX_INJECTION_RETRIES) {
              injectionRetryCounts[tabId] = currentRetries + 1;
              console.log('sendToContent: injecting vanillasoft.js into tab', tabId, 'attempt', injectionRetryCounts[tabId]);
              try {
                await chrome.scripting.executeScript({ target: { tabId: tabId, allFrames: true }, files: ['vanillasoft.js'] });
                console.log('sendToContent: injection complete, retrying message in 500ms');
              } catch (e) {
                console.log('sendToContent: injection failed:', e && e.message ? e.message : e);
                resolve({ ok: false, error: errMsg });
                return;
              }

              setTimeout(() => {
                // retry once after injection
                chrome.tabs.sendMessage(tabId, { type, ...data }, (retryResponse) => {
                  if (chrome.runtime.lastError) {
                    console.log('sendToContent: retry error:', chrome.runtime.lastError.message);
                    resolve({ ok: false, error: chrome.runtime.lastError.message });
                  } else {
                    // Reset retry counter on success
                    injectionRetryCounts[tabId] = 0;
                    resolve(retryResponse || { ok: false, error: 'No response' });
                  }
                });
              }, 500);
              return;
            } else {
              console.log('sendToContent: injection retries exceeded for tab', tabId);
              showInjectionExhaustedNotice();
              resolve({ ok: false, error: errMsg });
              return;
            }
          }

          resolve({ ok: false, error: errMsg });
        } else {
          // Reset retry counter on success
          injectionRetryCounts[tabId] = 0;
          resolve(response || { ok: false, error: 'No response' });
        }
      });
    };

    doSend();
  });
}

// ============================================
// WORKFLOW FUNCTIONS
// ============================================

async function loadWorkflows() {
  if (!workflowSelect) return;
  workflowSelect.innerHTML = '<option value="">Loading workflows...</option>';
  
  const result = await apiRequest("/api/v1/workflows", { method: "GET" });
  
  if (!result.ok) {
    if (result.status === 401) return;
    workflowSelect.innerHTML = '<option value="">Failed to load workflows</option>';
    return;
  }
  
  const data = result.data;
  if (data.data && data.data.results) {
    const workflows = data.data.results.filter(item => 
      item.type === "workflow" && item.status !== "paused"
    );
    workflowSelect.innerHTML = '<option value="">Select a workflow...</option>';
    workflows.forEach(workflow => {
      const option = document.createElement("option");
      option.value = workflow.id;
      option.textContent = workflow.name;
      workflowSelect.appendChild(option);
    });
    workflowSelect.disabled = false;
    chrome.storage.local.get([STORAGE_KEYS.selectedWorkflow], (result) => {
      if (result[STORAGE_KEYS.selectedWorkflow]) {
        workflowSelect.value = result[STORAGE_KEYS.selectedWorkflow];
      }
    });
  } else {
    workflowSelect.innerHTML = '<option value="">Failed to load workflows</option>';
  }
}

if (workflowSelect) {
  workflowSelect.addEventListener("change", () => {
    chrome.storage.local.set({ [STORAGE_KEYS.selectedWorkflow]: workflowSelect.value });
  });
}

function formatDOB(dob) {
  if (!dob) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    const parts = dob.split("-");
    return `${parts[1]}/${parts[2]}/${parts[0]}`;
  }
  if (/^\d{2}-\d{2}-\d{4}$/.test(dob)) {
    return dob.replace(/-/g, '/');
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dob)) {
    return dob;
  }
  return dob;
}

function formatDOBDisplay(dob) {
  return formatDOB(dob);
}

function formatDOBForAPI(dob) {
  if (!dob) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    const parts = dob.split("-");
    return `${parts[1]}-${parts[2]}-${parts[0]}`;
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dob)) {
    return dob.replace(/\//g, '-');
  }
  if (/^\d{2}-\d{2}-\d{4}$/.test(dob)) {
    return dob;
  }
  return dob;
}

// SVG icon for copy button
const COPY_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
const CHECK_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

// Copy to clipboard helper
async function copyToClipboard(text, buttonEl) {
  try {
    await navigator.clipboard.writeText(text);
    if (buttonEl) {
      buttonEl.classList.add('copied');
      buttonEl.innerHTML = CHECK_ICON_SVG;
      setTimeout(() => {
        buttonEl.classList.remove('copied');
        buttonEl.innerHTML = COPY_ICON_SVG;
      }, 1500);
    }
  } catch (err) {
    console.error('Failed to copy:', err);
  }
}

// ============================================
// CONTACT & PHONE NUMBER FUNCTIONS
// ============================================

let scrapedContact = null;
let phoneNumbers = [];
let selectedPhoneIndex = 0;
let existingContactId = null;
let existingConversationId = null;
const contactPreviewEl = document.getElementById("contactPreview");
const addToAllTalkBtn = document.getElementById("addToAllTalk");
const settingsSection = document.getElementById("settingsSection");
const tokenStatusEl = document.getElementById("tokenStatus");

// Clean phone number - remove +1 or leading 1 for 11 digit numbers
function cleanPhoneNumber(phone) {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    cleaned = cleaned.substring(1);
  }
  return cleaned;
}

function formatPhoneDisplay(phone) {
  const cleaned = cleanPhoneNumber(phone);
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0,3)}) ${cleaned.slice(3,6)}-${cleaned.slice(6)}`;
  }
  return phone;
}

function createPhoneButton(phone, label, index) {
  const cleanedPhone = cleanPhoneNumber(phone);
  
  const btn = document.createElement("div");
  btn.className = "phone-btn";
  btn.dataset.phone = cleanedPhone;
  btn.dataset.index = index;
  
  btn.innerHTML = `
    <div class="phone-info">
      <span class="phone-label">${label}</span>
      <span class="phone-number">${formatPhoneDisplay(phone)}</span>
    </div>
    <div class="phone-actions">
      <span class="phone-status">Check</span>
      <button class="phone-copy-btn" title="Copy number">${COPY_ICON_SVG}</button>
    </div>
  `;
  
  // Click on main area to select/check
  btn.addEventListener("click", (e) => {
    if (e.target.classList.contains('phone-copy-btn') || e.target.closest('.phone-copy-btn')) return;
    selectPhoneNumber(index);
  });
  
  // Copy button click
  const copyBtn = btn.querySelector('.phone-copy-btn');
  copyBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    await copyToClipboard(cleanedPhone, copyBtn);
  });
  
  return btn;
}

async function selectPhoneNumber(index) {
  if (index >= phoneNumbers.length) return;
  
  selectedPhoneIndex = index;
  const phone = phoneNumbers[index].number;
  
  const buttons = phoneButtonsContainer.querySelectorAll(".phone-btn");
  buttons.forEach((btn, i) => {
    btn.classList.remove("selected");
    if (i === index) {
      btn.classList.add("selected");
      btn.querySelector(".phone-status").textContent = "Checking...";
    }
  });
  
  await checkContactInAllTalk(phone, index);
}

async function checkContactInAllTalk(phoneNumber, buttonIndex = 0) {
  const tokens = await getTokens();
  
  if (!tokens.accessToken) {
    if (addToAllTalkBtn) addToAllTalkBtn.disabled = false;
    setStatus("Contact loaded - sign in to check AllTalk");
    return;
  }
  
  setStatus("Checking AllTalk...");
  const cleanPhone = cleanPhoneNumber(phoneNumber);
  
  const result = await apiRequest(`/api/v1/contacts?search=${cleanPhone}`, { method: "GET" });
  
  const buttons = phoneButtonsContainer.querySelectorAll(".phone-btn");
  const currentBtn = buttons[buttonIndex];
  
  if (!result.ok) {
    if (result.status === 401) {
      if (addToAllTalkBtn) addToAllTalkBtn.disabled = false;
      return;
    }
    existingContactId = null;
    existingConversationId = null;
    if (currentBtn) {
      currentBtn.querySelector(".phone-status").textContent = "Not found";
    }
    if (addToAllTalkBtn) {
      addToAllTalkBtn.textContent = "➕ Add to AllTalk Pro";
      addToAllTalkBtn.disabled = false;
      addToAllTalkBtn.className = "btn-blue";
    }
    setStatus("Contact not in AllTalk");
    return;
  }
  
  const data = result.data;
  if (data.data && data.data.results && data.data.results.length > 0) {
    existingContactId = data.data.results[0].id;
    existingConversationId = data.data.results[0].conversation_id;
    setStatus("Contact found in AllTalk ✓");
    
    if (currentBtn) {
      currentBtn.querySelector(".phone-status").textContent = "Found ✓";
    }
    
    if (addToAllTalkBtn) {
      addToAllTalkBtn.textContent = "🔗 Open in AllTalk Pro";
      addToAllTalkBtn.disabled = false;
      addToAllTalkBtn.className = "btn-purple";
    }
  } else {
    existingContactId = null;
    existingConversationId = null;
    
    if (currentBtn) {
      currentBtn.querySelector(".phone-status").textContent = "Not found";
    }
    
    if (addToAllTalkBtn) {
      addToAllTalkBtn.textContent = "➕ Add to AllTalk Pro";
      addToAllTalkBtn.disabled = false;
      addToAllTalkBtn.className = "btn-blue";
    }
    setStatus("Contact not in AllTalk");
  }
}

function renderPhoneButtons() {
  if (!phoneButtonsContainer) return;
  
  phoneButtonsContainer.innerHTML = "";
  
  if (phoneNumbers.length === 0) {
    phoneButtonsContainer.innerHTML = '<div style="color: #6b7280; font-size: 12px;">No phone numbers found</div>';
    return;
  }
  
  phoneNumbers.forEach((phoneData, index) => {
    const btn = createPhoneButton(phoneData.number, phoneData.label, index);
    phoneButtonsContainer.appendChild(btn);
  });
}

async function autoScrapeContact(retryCount = 0) {
  if (isScraping && retryCount === 0) return;
  isScraping = true;
  try {
  setStatus("Finding VanillaSoft...");
  
  const tabId = await getTargetTabId();
  if (!tabId) {
    if (contactPreviewEl) {
      contactPreviewEl.innerHTML = '<div class="field" style="color: #f87171;">No VanillaSoft tab found in any window.<br><span style="font-size: 11px; color: #9ca3af;">Open VanillaSoft and click refresh.</span></div>';
      contactPreviewEl.className = "contact-preview active";
    }
    setStatus("No VanillaSoft tab found");
    renderPhoneButtons();
    return;
  }
  
  setStatus("Reading contact...");
  if (retryCount === 0) injectionRetryCounts[tabId] = 0; // RC5: fresh scrape gets a clean counter

  // Reset state
  existingContactId = null;
  existingConversationId = null;
  phoneNumbers = [];
  selectedPhoneIndex = 0;
  
  // Try using chrome.scripting.executeScript for more reliable scraping
  // First try main frame only (avoids cross-origin iframe errors like Stripe)
  try {
    const mainFrameResults = await chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: false },
      func: scrapeContactFromPage
    });
    
    let contactData = null;
    for (const result of mainFrameResults) {
      if (result.result && result.result.ok && (result.result.contact.firstName || result.result.contact.phone)) {
        contactData = result.result;
        break;
      }
    }
    
    if (contactData) {
      console.log("Found contact via main frame executeScript");
      processScrapedContact(contactData);
      return;
    }
  } catch (mainFrameError) {
    console.log("Main frame executeScript failed:", mainFrameError.message);
  }
  
  // Try allFrames but catch errors from cross-origin iframes (e.g., Stripe)
  try {
    const allFrameResults = await chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      func: scrapeContactFromPage
    });
    
    let contactData = null;
    for (const result of allFrameResults) {
      if (result.result && result.result.ok && (result.result.contact.firstName || result.result.contact.phone)) {
        contactData = result.result;
        break;
      }
    }
    
    if (contactData) {
      console.log("Found contact via allFrames executeScript");
      processScrapedContact(contactData);
      return;
    }
  } catch (allFrameError) {
    console.log("allFrames executeScript failed:", allFrameError.message);
  }
  
  // Try to inject content script first, then sendMessage
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      files: ["vanillasoft.js"]
    });
    console.log("Injected vanillasoft.js content script");
  } catch (injectError) {
    console.log("Content script injection failed:", injectError.message);
  }
  
  // Small delay to let injected script initialize
  await new Promise(r => setTimeout(r, 300));
  
  // Fallback: try sendMessage + bounded injection retries using async loop
  try {
    const attemptScrape = async () => {
      for (let attempt = 0; attempt <= MAX_INJECTION_RETRIES; attempt++) {
        const result = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, { type: "SCRAPE_CONTACT" }, (r) => {
            const err = chrome.runtime.lastError ? (chrome.runtime.lastError.message || '') : null;
            resolve({ resp: r, err });
          });
        });

        if (!result.err && result.resp && result.resp.ok) {
          injectionRetryCounts[tabId] = 0;
          processScrapedContact(result.resp);
          return true;
        }

        const errMsg = result.err || '';

        if (errMsg.includes("Receiving end does not exist") || errMsg.includes("Could not establish connection") || errMsg.includes("context invalidated")) {
          const currentRetries = injectionRetryCounts[tabId] || 0;
          if (currentRetries < MAX_INJECTION_RETRIES) {
            injectionRetryCounts[tabId] = currentRetries + 1;
            console.log('Auto-scrape: injecting vanillasoft.js into tab', tabId, 'attempt', injectionRetryCounts[tabId]);
            try {
              await chrome.scripting.executeScript({ target: { tabId: tabId, allFrames: true }, files: ["vanillasoft.js"] });
            } catch (e) {
              console.log('Auto-scrape: injection failed:', e && e.message ? e.message : e);
            }
            // wait and retry
            await new Promise(r => setTimeout(r, 500));
            continue; // next attempt
          } else {
            console.log('Auto-scrape: injection retries exceeded for tab', tabId);
            showInjectionExhaustedNotice();
            return false;
          }
        }

        // Non-recoverable or no response
        break;
      }
      return false;
    };

    const ok = await attemptScrape();
    if (!ok) {
      if (retryCount < 1) {
        setTimeout(() => autoScrapeContact(retryCount + 1), 500);
        return;
      }
      if (contactPreviewEl) {
        contactPreviewEl.innerHTML = '<div class="field" style="color: #fbbf24;">VanillaSoft page needs refresh.<br><span style="font-size: 11px; color: #9ca3af;">Please reload the VanillaSoft tab and try again.</span></div>';
        contactPreviewEl.className = "contact-preview active";
      }
      setStatus("Reload VanillaSoft tab");
      renderPhoneButtons();
      return;
    }
  } catch (e) {
    console.log('Auto-scrape unexpected error:', e && e.message ? e.message : e);
    if (contactPreviewEl) {
      contactPreviewEl.innerHTML = '<div class="field" style="color: #9ca3af;">Could not read contact data.</div>';
      contactPreviewEl.className = "contact-preview active";
    }
    setStatus("Could not read contact");
    renderPhoneButtons();
    return;
  }
  } finally {
    isScraping = false;
  }
}

// Function to be injected into the page - UNIVERSAL VERSION
function scrapeContactFromPage() {
  // ============================================
  // UTILITY FUNCTIONS
  // ============================================
  
  function cleanPhoneNumber(phone) {
    if (!phone) return '';
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      cleaned = cleaned.substring(1);
    }
    return cleaned;
  }
  
  function isPhoneNumber(text) {
    if (!text) return false;
    const cleaned = text.replace(/\D/g, '');
    return cleaned.length === 10 || (cleaned.length === 11 && cleaned.startsWith('1'));
  }
  
  function isEmail(text) {
    if (!text) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());
  }
  
  function isDate(text) {
    if (!text) return false;
    return /\d{4}-\d{2}-\d{2}|\d{2}[-\/]\d{2}[-\/]\d{4}/.test(text.trim());
  }
  
  function extractState(text) {
    if (!text) return '';
    const stateMatch = text.match(/\b([A-Z]{2})\b/);
    const validStates = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];
    if (stateMatch && validStates.includes(stateMatch[1])) {
      return stateMatch[1];
    }
    return '';
  }
  
  function extractZip(text) {
    if (!text) return '';
    const zipMatch = text.match(/\b(\d{5})(?:-\d{4})?\b/);
    return zipMatch ? zipMatch[1] : '';
  }
  
  function getElementText(el) {
    if (!el) return '';
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      return (el.value || el.getAttribute('data-previousvalue') || '').trim();
    }
    return (el.textContent || el.innerText || '').trim();
  }
  
  function findByIds(doc, ids) {
    for (const id of ids) {
      const el = doc.querySelector(id);
      if (el) {
        const text = getElementText(el);
        if (text) return text;
      }
    }
    return '';
  }
  
  function findByLabel(doc, labelTexts, cachedElements) {
    const allElements = cachedElements || doc.querySelectorAll('td, th, label, span, div');
    for (const labelText of labelTexts) {
      const lowerLabel = labelText.toLowerCase();
      for (const el of allElements) {
        const text = (el.textContent || '').toLowerCase().trim();
        if (text.includes(lowerLabel) || text === lowerLabel || text.startsWith(lowerLabel)) {
          let sibling = el.nextElementSibling;
          if (sibling) {
            const siblingText = getElementText(sibling);
            if (siblingText && siblingText.toLowerCase() !== lowerLabel) {
              return siblingText;
            }
          }
          const input = el.querySelector('input, select, textarea') || el.parentElement?.querySelector('input, select, textarea');
          if (input) {
            const inputText = getElementText(input);
            if (inputText) return inputText;
          }
          if (el.tagName === 'TD' || el.tagName === 'TH') {
            const nextCell = el.nextElementSibling;
            if (nextCell) {
              const cellText = getElementText(nextCell);
              if (cellText) return cellText;
            }
          }
          const parentSibling = el.parentElement?.nextElementSibling;
          if (parentSibling) {
            const psText = getElementText(parentSibling);
            if (psText && psText.toLowerCase() !== lowerLabel) {
              return psText;
            }
          }
        }
      }
    }
    return '';
  }
  
  // ============================================
  // FINDERS
  // ============================================
  
  // Validate that text looks like a real name, not a placeholder
  function isValidName(text) {
    if (!text) return false;
    
    const trimmed = text.trim();
    const words = trimmed.split(/\s+/);
    
    // Must be 2-4 words
    if (words.length < 2 || words.length > 4) return false;
    
    // Length must be between 3 and 50
    if (trimmed.length < 3 || trimmed.length >= 50) return false;
    
    // Cannot contain @ or digits
    if (/@|\d/.test(trimmed)) return false;
    
    // Cannot start or end with dashes or multiple spaces
    if (/^[-\s]+|[-\s]+$/.test(trimmed)) return false;
    
    // Cannot contain placeholder keywords
    const lowerText = trimmed.toLowerCase();
    const placeholderKeywords = ['select', 'choose', 'filter', 'all projects', 'project', '--'];
    for (const keyword of placeholderKeywords) {
      if (lowerText.includes(keyword)) return false;
    }
    
    return true;
  }
  
  function findContactName(doc, isIdLayout) {
    let firstName = findByIds(doc, ['#FirstName', '#first_name', '#firstName', '[name="FirstName"]', '[name="first_name"]']);
    let lastName = findByIds(doc, ['#LastName', '#last_name', '#lastName', '[name="LastName"]', '[name="last_name"]']);
    if (firstName || lastName) return { firstName, lastName };

    const nameSelectors = ['.contact-name', '.lead-name', '.customer-name', 'h1', 'h2', 'h3', '[class*="name"]', '[id*="name"]'];
    for (const selector of nameSelectors) {
      const els = doc.querySelectorAll(selector);
      for (const el of els) {
        const text = getElementText(el);
        // Use enhanced validation to reject placeholders
        if (isValidName(text)) {
          const parts = text.trim().split(/\s+/);
          return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
        }
      }
    }

    // Skipped on ID-based layouts — [class*="contact"] substring walk is expensive
    // and unnecessary when #FirstName/#LastName would have already returned above
    if (!isIdLayout) {
      const leftPanel = doc.querySelector('.contact-info, .lead-info, [class*="contact"], [class*="lead"]') || doc.body;
      const headerElements = leftPanel.querySelectorAll('h1, h2, h3, h4, strong, b');
      for (const el of headerElements) {
        const text = getElementText(el);
        // Use enhanced validation to reject placeholders
        if (isValidName(text)) {
          const words = text.trim().split(/\s+/);
          return { firstName: words[0], lastName: words.slice(1).join(' ') };
        }
      }
    }
    return { firstName: '', lastName: '' };
  }
  
  function findAllPhoneNumbers(doc) {
    const phoneNumbers = [];
    const seenNumbers = new Set();
    const excludedNumbers = new Set();
    
    // =============================================
    // STEP 1: BUILD EXCLUSION LIST - Only Contact ID
    // =============================================
    
    const allText = doc.body ? doc.body.textContent : '';
    
    // Only exclude the exact Contact ID number
    const contactIdMatch = allText.match(/Contact\s*ID[:\s]*(\d{7,11})/i);
    if (contactIdMatch) {
      excludedNumbers.add(contactIdMatch[1]);
      console.log('Excluded Contact ID:', contactIdMatch[1]);
    }
    
    // Find Contact ID by label
    doc.querySelectorAll('td, div, span, label').forEach(el => {
      const text = (el.textContent || '').trim().toLowerCase();
      if (text === 'contact id' || text === 'contactid' || text === 'lead id' || text === 'leadid') {
        const nextEl = el.nextElementSibling;
        if (nextEl) {
          const val = (nextEl.textContent || '').trim().replace(/\D/g, '');
          if (val.length >= 7 && val.length <= 11) {
            excludedNumbers.add(val);
            console.log('Excluded Contact ID (from label):', val);
          }
        }
      }
    });
    
    console.log('Excluded:', Array.from(excludedNumbers));
    
    // =============================================
    // STEP 2: ADD PHONE FUNCTION
    // =============================================
    
    function addPhone(number, label, source) {
      const cleaned = cleanPhoneNumber(number);
      const raw = number.replace(/\D/g, '');
      
      // Check exclusions - only Contact ID should be excluded
      if (excludedNumbers.has(cleaned) || excludedNumbers.has(raw) || excludedNumbers.has(raw.slice(-10))) {
        console.log('Rejected (Contact ID):', cleaned, source);
        return false;
      }
      
      if (cleaned.length === 10 && !seenNumbers.has(cleaned)) {
        seenNumbers.add(cleaned);
        phoneNumbers.push({ number: cleaned, label: label });
        console.log('✓ Found:', cleaned, label, 'via', source);
        return true;
      }
      return false;
    }
    
    // =============================================
    // STEP 3: TRY MULTIPLE DETECTION METHODS
    // =============================================
    
    // METHOD A: Direct ID selectors
    const idSelectors = ['#n2807139', '#Phone', '#PrimaryPhone', '#HomePhone', '#MobilePhone', '#CellPhone'];
    for (const sel of idSelectors) {
      const el = doc.querySelector(sel);
      if (el) {
        const val = el.value || el.textContent || '';
        if (isPhoneNumber(val)) {
          addPhone(val, 'Primary', 'ID selector');
        }
      }
    }

    // If Method A found phone(s) via ID selectors, skip expensive DOM scans (Methods B–E)
    if (phoneNumbers.length > 0) {
      console.log('Final result:', phoneNumbers);
      return phoneNumbers;
    }

    // METHOD B: Scan page for phone patterns near known labels using regex
    const labelPatterns = [
      { regex: /Primary\s*Phone[\s\n]*([1]?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i, label: 'Primary' },
      { regex: /Home\s*Phone[\s\n]*([1]?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i, label: 'Alt' },
      { regex: /Home[\s\n]+([1]?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i, label: 'Alt' },
      { regex: /Mobile\s*Phone[\s\n]*([1]?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i, label: 'Alt' },
      { regex: /Cell\s*Phone[\s\n]*([1]?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i, label: 'Alt' },
      { regex: /Work\s*Phone[\s\n]*([1]?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i, label: 'Alt' },
      { regex: /Best\s*Phone[\s\n]*([1]?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i, label: 'Alt' },
      { regex: /Another\s*Phone[\s\n]*([1]?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i, label: 'Alt' },
      { regex: /Other\s*Phone[\s\n]*([1]?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i, label: 'Alt' },
      { regex: /Alt\s*Phone[\s\n]*([1]?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i, label: 'Alt' },
      { regex: /phone:\s*(\d{10,11})\s*confidence:/gi, label: 'Alt' },
    ];
    
    for (const { regex, label } of labelPatterns) {
      const matches = allText.match(regex);
      if (matches) {
        const phoneMatch = matches[0].match(/\d{10,11}|\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
        if (phoneMatch) {
          addPhone(phoneMatch[0], phoneNumbers.length === 0 ? 'Primary' : label, 'regex pattern');
        }
      }
    }
    
    // METHOD C: Find elements with phone-related text and scan nearby
    const phoneKeywords = ['primary phone', 'home phone', 'mobile', 'cell phone', 'work phone', 'best phone', 'another phone', 'alt phone', 'other phone'];
    doc.querySelectorAll('td, div, span, label, th').forEach(el => {
      const text = (el.textContent || '').toLowerCase().trim();
      
      for (const keyword of phoneKeywords) {
        if (text === keyword || text.startsWith(keyword + '\n') || text.startsWith(keyword + ' ')) {
          // Check parent for phone
          const parent = el.parentElement;
          if (parent) {
            const parentText = parent.textContent || '';
            const phoneMatch = parentText.match(/[1]?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
            if (phoneMatch && isPhoneNumber(phoneMatch[0])) {
              // Only Primary if explicitly labeled, otherwise Alt
              let lbl = keyword.includes('primary') ? 'Primary' : 'Alt';
              addPhone(phoneMatch[0], phoneNumbers.length === 0 ? 'Primary' : lbl, 'keyword search');
            }
          }
          
          // Check next sibling
          const sib = el.nextElementSibling;
          if (sib) {
            const sibText = sib.textContent || '';
            const sibPhone = sibText.match(/[1]?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
            if (sibPhone && isPhoneNumber(sibPhone[0])) {
              addPhone(sibPhone[0], phoneNumbers.length === 0 ? 'Primary' : 'Alt', 'sibling search');
            }
          }
        }
      }
    });
    
    // METHOD D: Find standalone phone numbers (leaf elements with just a phone)
    // Only accept if parent has a phone-related label
    doc.querySelectorAll('div, span, td').forEach(el => {
      if (el.children.length === 0) {
        const text = (el.textContent || '').trim();
        if (text.match(/^[1]?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/)) {
          const parentText = (el.parentElement?.textContent || '').toLowerCase();
          
          // MUST have a phone-related label
          const hasPhoneLabel = parentText.includes('phone') || 
                               parentText.includes('home') && !parentText.includes('homepage') ||
                               parentText.includes('mobile') || parentText.includes('cell') ||
                               parentText.includes('work') || parentText.includes('best') ||
                               parentText.includes('primary') || parentText.includes('another');
          
          // Skip if in SMS area or no phone label
          const inSmsArea = parentText.includes('send from') || parentText.includes('delivered') ||
                           parentText.includes('michael') || parentText.includes('devin') ||
                           parentText.includes('noah') || parentText.includes('agent') ||
                           parentText.includes('pm ') || parentText.includes('am ');
          
          if (hasPhoneLabel && !inSmsArea) {
            let lbl = parentText.includes('primary') ? 'Primary' : 'Alt';
            addPhone(text, phoneNumbers.length === 0 ? 'Primary' : lbl, 'standalone element');
          }
        }
      }
    });
    
    // METHOD E: Find tel: links - but only if near phone-related content
    doc.querySelectorAll('a[href^="tel:"]').forEach(a => {
      const phone = a.href.replace('tel:', '').replace(/\D/g, '');
      const parentText = (a.parentElement?.textContent || '').toLowerCase();
      
      // Only accept if parent has phone-related label
      const hasPhoneLabel = parentText.includes('phone') || parentText.includes('home') ||
                           parentText.includes('mobile') || parentText.includes('cell') ||
                           parentText.includes('primary');
      
      // Skip if in SMS area
      const inSmsArea = parentText.includes('delivered') || parentText.includes('send from') ||
                       parentText.includes('michael') || parentText.includes('devin');
      
      if (hasPhoneLabel && !inSmsArea) {
        addPhone(phone, phoneNumbers.length === 0 ? 'Primary' : 'Alt', 'tel link');
      }
    });
    
    // METHOD F: Only scan if we found NO phones from Methods A-E
    // And require a phone label to be nearby
    if (phoneNumbers.length === 0) {
      console.log('No phones found from methods A-E, trying broad scan...');
      
      const allPhones = allText.match(/[1]?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || [];
      
      for (const phone of allPhones) {
        const cleaned = cleanPhoneNumber(phone);
        if (!excludedNumbers.has(cleaned) && !seenNumbers.has(cleaned)) {
          const idx = allText.indexOf(phone);
          const contextBefore = allText.substring(Math.max(0, idx - 80), idx).toLowerCase();
          
          // MUST have a phone-related label before it
          const hasPhoneLabel = contextBefore.includes('phone') || contextBefore.includes('home\n') || 
                               contextBefore.includes('home ') || contextBefore.includes('mobile') || 
                               contextBefore.includes('cell') || contextBefore.includes('work') || 
                               contextBefore.includes('best') || contextBefore.includes('primary');
          
          if (!hasPhoneLabel) {
            console.log('Skipping - no phone label:', cleaned);
            continue;
          }
          
          // Skip if near SMS-related words
          const contextAfter = allText.substring(idx, Math.min(allText.length, idx + 50)).toLowerCase();
          if (contextBefore.includes('delivered') || contextAfter.includes('delivered') ||
              contextBefore.includes('send from') || contextAfter.includes('send from') ||
              contextBefore.includes('michael') || contextBefore.includes('devin') ||
              contextBefore.includes('noah') || contextBefore.includes('agent')) {
            console.log('Skipping - SMS context:', cleaned);
            continue;
          }
          
          let lbl = contextBefore.includes('primary') ? 'Primary' : 'Alt';
          addPhone(phone, lbl, 'broad scan');
          
          if (phoneNumbers.length >= 3) break;
        }
      }
    }
    
    console.log('Final result:', phoneNumbers);
    return phoneNumbers;
  }
  
  function findEmail(doc, cachedElements) {
    const email = findByIds(doc, ['#Email', '#email', '#EmailAddress', '[name="Email"]', '[type="email"]']);
    if (isEmail(email)) return email;
    const emailByLabel = findByLabel(doc, ['Email', 'E-mail', 'Email Address'], cachedElements);
    if (isEmail(emailByLabel)) return emailByLabel;
    const elements = cachedElements || doc.querySelectorAll('td, div, span, a');
    for (const el of elements) {
      const text = getElementText(el);
      if (isEmail(text)) return text;
      if (el.tagName === 'A' && el.href && el.href.startsWith('mailto:')) {
        return el.href.replace('mailto:', '');
      }
    }
    return '';
  }
  
  function findDOB(doc, cachedElements) {
    const dob = findByIds(doc, ['#n2807164', '#DOB', '#dob', '#DateOfBirth', '#BirthDate', '#InsuredDOB', '[name="DOB"]', '[name="DateOfBirth"]']);
    if (isDate(dob)) return dob;

    // Try labels in priority order - Insured DOB first
    const priorityLabels = ['Insured DOB', 'DOB', 'Date of Birth', 'Birth Date', 'Birthday', 'Birthdate'];
    for (const label of priorityLabels) {
      const dobByLabel = findByLabel(doc, [label], cachedElements);
      if (isDate(dobByLabel)) return dobByLabel;
    }
    
    const allCells = doc.querySelectorAll('td, div, span');
    for (const cell of allCells) {
      const text = (cell.textContent || '').toLowerCase();
      
      // Skip if this is an "added on" or creation date field
      if (text.includes('added') || text.includes('created') || text.includes('joined') || 
          text.includes('registered') || text.includes('contact\'s time')) {
        continue;
      }
      
      if (text.includes('dob') || text.includes('birth') || text.includes('insured dob')) {
        const dateMatch = text.match(/\d{4}-\d{2}-\d{2}|\d{2}[-\/]\d{2}[-\/]\d{4}/);
        if (dateMatch) return dateMatch[0];
        const sibling = cell.nextElementSibling;
        if (sibling) {
          const siblingText = getElementText(sibling);
          if (isDate(siblingText)) return siblingText;
        }
      }
    }
    return '';
  }
  
  function findAddressInfo(doc, cachedElements) {
    let zipCode = findByIds(doc, ['#ZipCode', '#zip_code', '#Zip', '#PostalCode', '[name="ZipCode"]', '[name="Zip"]']);
    let state = findByIds(doc, ['#State', '#state', '[name="State"]']);
    if (zipCode && state) {
      return { zipCode: extractZip(zipCode) || zipCode, state: extractState(state) || state };
    }
    if (!zipCode) zipCode = findByLabel(doc, ['Zip', 'Zip Code', 'Postal Code'], cachedElements);
    if (!state) state = findByLabel(doc, ['State', 'Province', 'ST'], cachedElements);
    const addressElements = doc.querySelectorAll('td, div, span, address');
    for (const el of addressElements) {
      const text = getElementText(el);
      const addressMatch = text.match(/([A-Za-z\s]+),?\s+([A-Z]{2})\s+(\d{5})/);
      if (addressMatch) {
        if (!state) state = addressMatch[2];
        if (!zipCode) zipCode = addressMatch[3];
        break;
      }
    }
    return { zipCode: extractZip(zipCode) || zipCode, state: extractState(state) || state };
  }
  
  // ============================================
  // MAIN SCRAPE
  // ============================================
  
  function scrapeFromDoc(doc) {
    // Quick layout probe — if known ID fields exist, this is an ID-based layout (fast path)
    const isIdLayout = !!doc.querySelector('#FirstName, #LastName, #Phone, #n2807139, #PrimaryPhone, #HomePhone, #MobilePhone, #CellPhone');
    // Compute once and share across all findByLabel calls inside findEmail, findDOB, findAddressInfo
    const labelElements = doc.querySelectorAll('td, th, label, span, div');
    const nameData = findContactName(doc, isIdLayout);
    const phoneNumbers = findAllPhoneNumbers(doc);
    const addressInfo = findAddressInfo(doc, labelElements);
    const contact = {
      firstName: nameData.firstName,
      lastName: nameData.lastName,
      phone: phoneNumbers.length > 0 ? phoneNumbers[0].number : '',
      email: findEmail(doc, labelElements),
      dob: findDOB(doc, labelElements),
      zipCode: addressInfo.zipCode,
      state: addressInfo.state
    };
    return { contact, phoneNumbers };
  }
  
  function hasContactData(doc) {
    const hasKnownIds = doc.querySelector('#FirstName, #LastName, #Phone, #Email, [class*="contact"], [class*="lead"]');
    if (hasKnownIds) return true;
    const nameData = findContactName(doc);
    if (nameData.firstName || nameData.lastName) return true;
    return false;
  }
  
  // Check current document
  if (hasContactData(document)) {
    const { contact, phoneNumbers } = scrapeFromDoc(document);
    if (contact.firstName || contact.lastName || contact.phone || contact.email) {
      return { ok: true, contact, phoneNumbers };
    }
  }
  
  // Check iframes recursively (handles VanillaSoft's nested ASP frameset)
  function checkIframes(doc, depth) {
    if (depth > 3) return null; // Max 3 levels deep
    try {
      const iframes = doc.querySelectorAll('iframe');
      for (const iframe of iframes) {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (!iframeDoc) continue;
          
          if (hasContactData(iframeDoc)) {
            const { contact, phoneNumbers } = scrapeFromDoc(iframeDoc);
            if (contact.firstName || contact.lastName || contact.phone || contact.email) {
              return { ok: true, contact, phoneNumbers };
            }
          }
          
          // Check sub-iframes
          const subResult = checkIframes(iframeDoc, depth + 1);
          if (subResult) return subResult;
        } catch (e) { /* cross-origin iframe, skip */ }
      }
    } catch (e) { }
    return null;
  }
  
  const iframeResult = checkIframes(document, 0);
  if (iframeResult) return iframeResult;
  
  return { ok: false };
}

// Process scraped contact data
function processScrapedContact(response) {
  scrapedContact = response.contact;
  // Sync the poll baseline to the authoritative scraped name so that
  // non-deterministic findContactName() results don't keep re-triggering scrapes.
  lastContactName = (scrapedContact.firstName || '') + '|' + (scrapedContact.lastName || '');
  console.log('Scrape complete — lastContactName synced to:', lastContactName);
  phoneNumbers = response.phoneNumbers || [];
  
  // Clean all phone numbers
  phoneNumbers = phoneNumbers.map(p => ({
    ...p,
    number: cleanPhoneNumber(p.number)
  }));
  
  // Display contact info
  if (contactPreviewEl) {
    const formattedDOB = formatDOBDisplay(scrapedContact.dob);
    const copyBtnHtml = COPY_ICON_SVG;
    
    contactPreviewEl.innerHTML = `
      <div class="field"><span class="label">Name:</span><span class="value">${scrapedContact.firstName} ${scrapedContact.lastName}</span></div>
      <div class="field"><span class="label">Email:</span><span class="value">${scrapedContact.email || "N/A"}</span>${scrapedContact.email ? `<button class="copy-btn" data-copy="email" title="Copy email">${copyBtnHtml}</button>` : ''}</div>
      <div class="field"><span class="label">DOB:</span><span class="value">${formattedDOB || "N/A"}</span>${formattedDOB ? `<button class="copy-btn" data-copy="dob" title="Copy DOB">${copyBtnHtml}</button>` : ''}</div>
      <div class="field"><span class="label">Zip:</span><span class="value">${scrapedContact.zipCode || "N/A"}</span>${scrapedContact.zipCode ? `<button class="copy-btn" data-copy="zip" title="Copy zip">${copyBtnHtml}</button>` : ''}</div>
      <div class="field"><span class="label">State:</span><span class="value">${scrapedContact.state || "N/A"}</span></div>
    `;
    contactPreviewEl.className = "contact-preview active";
    
    // Add copy button event listeners
    contactPreviewEl.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const copyType = btn.dataset.copy;
        let textToCopy = '';
        
        if (copyType === 'email') {
          textToCopy = scrapedContact.email;
        } else if (copyType === 'dob') {
          textToCopy = formatDOBDisplay(scrapedContact.dob);
        } else if (copyType === 'zip') {
          textToCopy = scrapedContact.zipCode;
        }
        
        if (textToCopy) {
          await copyToClipboard(textToCopy, btn);
        }
      });
    });
  }
  
  // Render phone buttons
  renderPhoneButtons();
  
  // Auto-check first phone number
  if (phoneNumbers.length > 0) {
    selectPhoneNumber(0);
  } else {
    if (addToAllTalkBtn) addToAllTalkBtn.disabled = false;
    setStatus("Contact loaded ✓");
  }
}

// ============================================
// SETTINGS & LOGIN
// ============================================

const toggleSettingsBtn = document.getElementById("toggleSettings");
if (toggleSettingsBtn) {
  toggleSettingsBtn.addEventListener("click", () => {
    if (settingsSection) {
      if (settingsSection.style.display === "none") {
        settingsSection.style.display = "block";
        setTimeout(() => {
          settingsSection.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 50);
      } else {
        settingsSection.style.display = "none";
      }
    }
  });
}

chrome.storage.local.get([STORAGE_KEYS.accessToken], (result) => {
  if (result[STORAGE_KEYS.accessToken] && tokenStatusEl) {
    tokenStatusEl.textContent = "✓ Signed in";
    tokenStatusEl.className = "token-status saved";
    loadWorkflows();
  }
});

const loginBtn = document.getElementById("loginBtn");
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");

chrome.storage.local.get([STORAGE_KEYS.savedEmail, STORAGE_KEYS.savedPassword], (result) => {
  if (loginEmail && result[STORAGE_KEYS.savedEmail]) {
    loginEmail.value = result[STORAGE_KEYS.savedEmail];
  }
  if (loginPassword && result[STORAGE_KEYS.savedPassword]) {
    loginPassword.value = result[STORAGE_KEYS.savedPassword];
  }
});

async function performLogin() {
  if (!loginEmail || !loginPassword || !tokenStatusEl) return;
  const email = loginEmail.value.trim();
  const password = loginPassword.value;
  if (!email || !password) {
    tokenStatusEl.textContent = "Please enter email and password";
    tokenStatusEl.className = "token-status";
    return;
  }
  setStatus("Signing in...");
  tokenStatusEl.textContent = "Signing in...";
  
  try {
    // CRITICAL: Use credentials: 'omit' to prevent ANY cookie interference
    const response = await fetch(`${ALLTALK_API}/api/v1/auth/sign-in`, {
      method: "POST",
      credentials: "omit", // Don't send or receive cookies
      headers: {
        "Content-Type": "application/json",
        "Accept-Language": "en"
      },
      body: JSON.stringify({
        email: email,
        password: password,
        remember_me: true
      })
    });
    
    const data = await response.json();
    
    if (response.ok && data.data && data.data.tokens) {
      const accessToken = data.data.tokens.access_token;
      const refreshToken = data.data.tokens.refresh_token;
      
      if (!accessToken) {
        tokenStatusEl.textContent = "Login failed - no token received";
        tokenStatusEl.className = "token-status";
        setStatus("Login failed");
        return;
      }
      
      chrome.storage.local.set({ 
        [STORAGE_KEYS.accessToken]: accessToken,
        [STORAGE_KEYS.refreshToken]: refreshToken,
        [STORAGE_KEYS.savedEmail]: email,
        [STORAGE_KEYS.savedPassword]: password
      }, async () => {
        tokenStatusEl.textContent = "✓ Signed in";
        tokenStatusEl.className = "token-status saved";
        setStatus("Signed in ✓");
        
        // Load workflows and scrape contact
        loadWorkflows();
        autoScrapeContact();
      });
    } else {
      tokenStatusEl.textContent = data.message || "Login failed";
      tokenStatusEl.className = "token-status";
      setStatus("Login failed");
    }
  } catch (e) {
    tokenStatusEl.textContent = "Network error";
    tokenStatusEl.className = "token-status";
    setStatus("Network error");
  }
}

if (loginBtn) {
  loginBtn.addEventListener("click", performLogin);
}

if (loginEmail) {
  loginEmail.addEventListener("keypress", (e) => {
    if (e.key === "Enter") performLogin();
  });
}

if (loginPassword) {
  loginPassword.addEventListener("keypress", (e) => {
    if (e.key === "Enter") performLogin();
  });
}

// ============================================
// ADD TO ALLTALK
// ============================================

// Helper function to open URL in existing AllTalk tab or create new one
async function openInAllTalkTab(url) {
  const tabs = await chrome.tabs.query({ url: "https://app.alltalkpro.com/*" });
  
  if (tabs.length > 0) {
    const existingTab = tabs[0];
    await chrome.tabs.update(existingTab.id, { url: url, active: true });
    await chrome.windows.update(existingTab.windowId, { focused: true });
  } else {
    chrome.tabs.create({ url: url });
  }
}

if (addToAllTalkBtn) {
  addToAllTalkBtn.addEventListener("click", async () => {
    if (existingContactId) {
      await openInAllTalkTab(`https://app.alltalkpro.com/conversations?contactId=${existingContactId}&returnTo=contacts&conversationId=${existingConversationId}`);
      return;
    }
    if (!scrapedContact) {
      setStatus("No contact to add");
      return;
    }
    
    const tokens = await getTokens();
    if (!tokens.accessToken) {
      setStatus("Please sign in first");
      if (settingsSection) settingsSection.style.display = "block";
      return;
    }
    
    const selectedPhone = phoneNumbers[selectedPhoneIndex]?.number || cleanPhoneNumber(scrapedContact.phone) || "";
    const selectedWorkflowId = workflowSelect ? workflowSelect.value : "";
    setStatus("Adding to AllTalk Pro...");
    
    const contactData = {
      first_name: scrapedContact.firstName || "",
      last_name: scrapedContact.lastName || "",
      email: scrapedContact.email || "",
      country_code: "+1",
      phone_number: selectedPhone,
      birth_date: formatDOBForAPI(scrapedContact.dob) || "",
      zip_code: scrapedContact.zipCode || "",
      state: scrapedContact.state || ""
    };
    
    if (selectedWorkflowId) {
      contactData.workflow_id = selectedWorkflowId;
    }
    
    const result = await apiRequest("/api/v1/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(contactData)
    });
    
    if (!result.ok) {
      if (result.status === 401) return;
      setStatus("Failed: " + (result.data?.message || result.data?.error || result.error || "Unknown error"));
      return;
    }
    
    setStatus("Contact added to AllTalk Pro ✓");
    const data = result.data;
    const newContactId = data.data?.id || data.id;
    const newConversationId = data.data?.conversation_id || null;
    
    if (newContactId) {
      existingContactId = newContactId;
      existingConversationId = newConversationId;
      addToAllTalkBtn.textContent = "🔗 Open in AllTalk Pro";
      addToAllTalkBtn.className = "btn-purple";
      
      const buttons = phoneButtonsContainer.querySelectorAll(".phone-btn");
      if (buttons[selectedPhoneIndex]) {
        buttons[selectedPhoneIndex].querySelector(".phone-status").textContent = "Added ✓";
      }
    } else {
      addToAllTalkBtn.disabled = true;
    }
  });
}

// Auto-scrape contact when popup opens
autoScrapeContact();

// Refresh contact button
if (refreshContactBtn) {
  refreshContactBtn.addEventListener("click", () => {
    setStatus("Refreshing...");
    autoScrapeContact();
  });
}

// Poll for contact changes while popup is open
let lastContactName = "";
let pollInterval = null;
let isPollingActive = true;

async function pollForContactChanges() {
  console.log('Polling: checking for contact change');
  if (!isPollingActive) return;
  
  const tabId = await getTargetTabId();
  if (!tabId) {
    console.log("Poll: no tabId found, will retry next interval");
    return;
  }
  
  chrome.runtime.sendMessage({ type: "RELAY_GET_CONTACT_NAME", tabId }, (relayed) => {
    if (chrome.runtime.lastError) {
      console.log('Poll relay error:', chrome.runtime.lastError.message);
      return;
    }
    const response = relayed && relayed.response;
    const errMsg = (relayed && relayed.relayError) || '';
    console.log('Poll raw response:', JSON.stringify(response));

    if (errMsg) {
      console.log("Poll error:", errMsg);

      // If the content script is not present (e.g. page navigated/was reloaded),
      // attempt to inject it and retry once after a short delay.
      if (errMsg.includes("Receiving end does not exist") || errMsg.includes("Could not establish connection")) {
        // Check retry count for this tab
        const currentRetries = injectionRetryCounts[tabId] || 0;
        if (currentRetries >= MAX_INJECTION_RETRIES) {
          console.log('Poll: injection retries exceeded for tab', tabId);
          showInjectionExhaustedNotice();
        } else if (isScraping) {
          console.log('Poll: scrape already in progress, skipping injection');
        } else {
          console.log('Poll: content script missing, injecting vanillasoft.js into tab', tabId, 'attempt', currentRetries + 1);
          injectionRetryCounts[tabId] = currentRetries + 1;

          (async () => {
            try {
              await chrome.scripting.executeScript({ target: { tabId: tabId, allFrames: true }, files: ["vanillasoft.js"] });
              console.log('Poll: injection complete, retrying GET_CONTACT_NAME in 500ms');
            } catch (e) {
              console.log('Poll: injection failed:', e && e.message ? e.message : e);
              return;
            }

            setTimeout(() => {
              chrome.runtime.sendMessage({ type: "RELAY_GET_CONTACT_NAME", tabId }, (retryRelayed) => {
                if (chrome.runtime.lastError) {
                  console.log('Poll retry relay error:', chrome.runtime.lastError.message);
                  return;
                }

                const retryResponse = retryRelayed && retryRelayed.response;
                if (retryResponse && retryResponse.ok && retryResponse.name) {
                  // Reset retry counter on success
                  injectionRetryCounts[tabId] = 0;
                  const currentName = retryResponse.name;

                  if (!lastContactName) {
                    lastContactName = currentName;
                    console.log('Initial contact name set (retry):', currentName);
                    return;
                  }

                  if (currentName !== lastContactName) {
                    lastContactName = currentName;
                    console.log(`Name changed from ${lastContactName} to ${currentName}`);
                    setStatus("New contact detected...");
                    setTimeout(() => { autoScrapeContact(); }, 500);
                  }
                }
              });
            }, 500);
          })();
        }
      }

      return;
    }

    console.log('Poll guard check:', response && response.ok, response && response.name);
    if (response && response.ok && response.name) {
      // Reset injection retry counter on successful response
      injectionRetryCounts[tabId] = 0;
      const currentName = response.name;

      if (!lastContactName) {
        lastContactName = currentName;
        console.log("Initial contact name set:", currentName);
        return;
      }

      if (currentName !== lastContactName) {
        console.log('Poll name mismatch — current:', currentName, '| stored:', lastContactName);
        lastContactName = currentName;
        console.log(`Name changed from ${lastContactName} to ${currentName}`);
        setStatus("New contact detected...");
        setTimeout(() => { autoScrapeContact(); }, 500);
      }
    }
  });
}

// Start polling when popup opens
pollInterval = setInterval(pollForContactChanges, 1500);

// Run initial poll after a short delay to set the baseline name
setTimeout(pollForContactChanges, 1000);

// Clean up when popup closes
window.addEventListener('unload', () => {
  isPollingActive = false;
  if (pollInterval) {
    clearInterval(pollInterval);
  }
});

// Tracks the last URL we observed for the stored VanillaSoft tab so that
// same-page navigations (where changeInfo.url is undefined or unchanged) are
// distinguished from genuine cross-page navigations.
let lastKnownVsUrl = '';

// Reset per-tab state when the stored VanillaSoft tab navigates to a new page
// (e.g. user logs out of one office and into another in the same tab).
// Without this, stale injectionRetryCounts causes false "Connection lost" notices
// and a stale lastContactName can suppress the auto-scrape trigger on the new page.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return;
  // changeInfo.url is only present when the URL is actually changing.
  // If it's undefined this is a same-page reload/SPA navigation — ignore it.
  if (!changeInfo.url) return;
  chrome.storage.local.get([STORAGE_KEYS.vanillasoftTabId], (result) => {
    if (result[STORAGE_KEYS.vanillasoftTabId] !== tabId) return;
    // Skip if the URL hasn't changed from what we last saw (avoids double-fires).
    if (changeInfo.url === lastKnownVsUrl) return;
    lastKnownVsUrl = changeInfo.url;
    // Clear the injection retry counter so the new page gets a fresh budget
    injectionRetryCounts[tabId] = 0;
    // Clear the last-seen name so the first contact on the new page always
    // triggers a scrape, regardless of what office A's last name was
    lastContactName = '';
    console.log('Tab navigated to new URL — reset state for tab', tabId, '->', changeInfo.url);
  });
});
