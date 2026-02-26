console.log("Content script loaded");

let pickedEl = null;

function getPath(el) {
  const parts = [];
  while (el && el.nodeType === 1) {
    let selector = el.nodeName.toLowerCase();
    if (el.id) {
      selector += '#' + el.id;
      parts.unshift(selector);
      break;
    } else {
      let sib = el, nth = 1;
      while (sib = sib.previousElementSibling) {
        if (sib.nodeName.toLowerCase() === selector) nth++;
      }
      if (nth !== 1) selector += `:nth-of-type(${nth})`;
    }
    parts.unshift(selector);
    el = el.parentNode;
  }
  return parts.join(' > ');
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "START_PICK") {
    document.body.style.cursor = "crosshair";
    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      document.body.style.cursor = "";
      document.removeEventListener("click", onClick, true);
      pickedEl = e.target;
      const path = getPath(pickedEl);
      chrome.storage.local.set({ pickedPath: path }, () => {
        chrome.runtime.sendMessage({ type: "PICK_RESULT", ok: true, path });
      });
    }
    document.addEventListener("click", onClick, true);
    sendResponse({ ok: true });
  }
  if (msg.type === "GET_TEXT") {
    chrome.storage.local.get(["pickedPath"], (result) => {
      if (!result.pickedPath) {
        sendResponse({ ok: false, error: "No box picked" });
        return;
      }
      const el = document.querySelector(result.pickedPath);
      if (!el) {
        sendResponse({ ok: false, error: "Element not found" });
        return;
      }
      const text = el.value !== undefined ? el.value : el.innerText;
      sendResponse({ ok: true, text });
    });
    return true;
  }
  if (msg.type === "SET_TEXT") {
    chrome.storage.local.get(["pickedPath"], (result) => {
      if (!result.pickedPath) {
        sendResponse({ ok: false, error: "No box picked" });
        return;
      }
      const el = document.querySelector(result.pickedPath);
      if (!el) {
        sendResponse({ ok: false, error: "Element not found" });
        return;
      }
      if (el.value !== undefined) {
        el.value = msg.text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        el.innerText = msg.text;
      }
      sendResponse({ ok: true });
    });
    return true;
  }
});
