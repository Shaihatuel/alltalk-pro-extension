chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "PICK_RESULT") {
    chrome.runtime.sendMessage(msg);
  }

  if (msg.type === "RELAY_GET_CONTACT_NAME") {
    chrome.tabs.sendMessage(msg.tabId, { type: "GET_CONTACT_NAME" }, (response) => {
      const err = chrome.runtime.lastError ? (chrome.runtime.lastError.message || '') : null;
      sendResponse({ relayError: err, response: response || null });
    });
    return true; // keep message channel open for async sendResponse
  }
});
