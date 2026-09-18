// ScrollRig — background service worker
// Opens the panel, tracks the bound tab, relays messages between panel and content script,
// handles keyboard shortcuts.

let targetTabId = null;
let panelWindowId = null;
let autoFollow = true;

// Bumped key: the panel's layout got taller, so stored bounds from the old
// design would clip it. A new key resets saved bounds once.
const BOUNDS_KEY = 'panelBounds.v2';
const DEFAULT_BOUNDS = { width: 420, height: 820 };

// Tabs that were already open before this extension (re)loaded never got the
// declarative content script injected — only tabs that navigate afterward do.
// Inject it manually whenever we bind to a tab, so scrolling works immediately.
async function pingTab(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return pong?.type === 'PONG';
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId) {
  if (await pingTab(tabId)) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch {
    // Restricted pages (chrome://, the Web Store, etc.) can't be injected into.
    return false;
  }
  // Confirm it actually took: executeScript resolves even when the script runs and
  // immediately returns, so only a reply proves there's a live listener in there.
  return pingTab(tabId);
}

// Tabs that were open before this install only get the declarative content script
// once they next navigate, so seed them now — otherwise the extension looks dead
// on every already-open tab until it's reloaded.
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.all(tabs.map((tab) => ensureContentScript(tab.id)));
});

async function getSavedBounds() {
  const stored = await chrome.storage.local.get(BOUNDS_KEY);
  return stored[BOUNDS_KEY] || DEFAULT_BOUNDS;
}

async function saveBounds(bounds) {
  await chrome.storage.local.set({ [BOUNDS_KEY]: bounds });
}

async function openPanel(initialTab) {
  if (panelWindowId !== null) {
    try {
      await chrome.windows.update(panelWindowId, { focused: true });
      return;
    } catch {
      panelWindowId = null; // window was closed externally; fall through to recreate
    }
  }

  const bounds = await getSavedBounds();
  const createOpts = {
    url: chrome.runtime.getURL('panel.html'),
    type: 'popup',
    width: bounds.width,
    height: bounds.height,
  };
  if (bounds.left !== undefined) createOpts.left = bounds.left;
  if (bounds.top !== undefined) createOpts.top = bounds.top;

  const win = await chrome.windows.create(createOpts);
  panelWindowId = win.id;

  if (initialTab && initialTab.id) {
    targetTabId = initialTab.id;
    await ensureContentScript(initialTab.id);
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  await openPanel(tab);
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === panelWindowId) {
    panelWindowId = null;
  }
});

chrome.windows.onBoundsChanged.addListener(async (window) => {
  if (window.id === panelWindowId) {
    await saveBounds({
      width: window.width,
      height: window.height,
      left: window.left,
      top: window.top,
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === targetTabId) {
    targetTabId = null;
    notifyPanel({ type: 'TAB_LOST', reason: 'closed' });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId !== targetTabId) return;
  if (changeInfo.status === 'loading' && changeInfo.url) {
    // Navigated — content script will reinject automatically on same/any origin.
    notifyPanel({ type: 'TAB_NAVIGATED', url: changeInfo.url });
  }
  if (changeInfo.status === 'complete') {
    // Fresh page, fresh content script with no cursor state — re-push it.
    applyCursorToTab(tabId);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!autoFollow) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  // Don't rebind to the panel window itself.
  if (tab.windowId === panelWindowId) return;
  if (tab.id === targetTabId) return; // already bound here
  if (targetTabId !== null) clearCursorOnTab(targetTabId); // leave the old tab as we found it
  targetTabId = tabId;
  await ensureContentScript(tabId);
  await applyCursorToTab(tabId);
  notifyPanel({ type: 'TAB_BOUND', tab: serializeTab(tab) });
});

function serializeTab(tab) {
  return { id: tab.id, title: tab.title, favIconUrl: tab.favIconUrl, url: tab.url };
}

// ── Custom cursor ──────────────────────────────────────────────────────────
// Storage is the single source of truth; the content script is a dumb renderer.
// The panel writes CURSOR_KEY and pings CURSOR_CHANGED; everything else reads
// from here so the setting re-applies across navigation and rebinds.
const CURSOR_KEY = 'cursor.v1';

async function getCursorSettings() {
  const data = await chrome.storage.local.get(CURSOR_KEY);
  return data[CURSOR_KEY] || null;
}

async function applyCursorToTab(tabId) {
  if (tabId === null || tabId === undefined) return;
  const settings = await getCursorSettings();
  if (!settings || !settings.enabled) return; // nothing to apply
  await ensureContentScript(tabId);
  chrome.tabs.sendMessage(tabId, { type: 'SET_CURSOR', settings }).catch(() => {});
}

function clearCursorOnTab(tabId) {
  if (tabId === null || tabId === undefined) return;
  chrome.tabs.sendMessage(tabId, { type: 'SET_CURSOR', settings: { enabled: false } }).catch(() => {});
}

function notifyPanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

// Message router: panel <-> content script, plus direct background commands.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case 'BIND_ACTIVE_TAB': {
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        let bound = activeTab && activeTab.windowId !== panelWindowId ? activeTab : null;
        if (!bound) {
          // Fall back to any active tab not in the panel window.
          const tabs = await chrome.tabs.query({ active: true });
          bound = tabs.find((t) => t.windowId !== panelWindowId) || null;
        }
        if (bound) {
          if (targetTabId !== null && targetTabId !== bound.id) clearCursorOnTab(targetTabId);
          targetTabId = bound.id;
          await ensureContentScript(bound.id);
          await applyCursorToTab(bound.id);
          sendResponse({ type: 'TAB_BOUND', tab: serializeTab(bound) });
        } else {
          sendResponse({ type: 'ERROR', message: 'No eligible tab to bind.' });
        }
        break;
      }
      case 'UNBIND_TAB': {
        if (targetTabId !== null) clearCursorOnTab(targetTabId);
        targetTabId = null;
        sendResponse({ type: 'TAB_UNBOUND' });
        break;
      }
      case 'CURSOR_CHANGED': {
        // Panel already wrote the new settings to storage. Push them straight to
        // the bound tab — unconditionally, so toggling OFF actually clears it
        // (applyCursorToTab short-circuits on disabled, which is only right for
        // navigation/rebind where a fresh page is already clean).
        if (targetTabId !== null) {
          const settings = (await getCursorSettings()) || { enabled: false };
          if (settings.enabled) await ensureContentScript(targetTabId);
          chrome.tabs.sendMessage(targetTabId, { type: 'SET_CURSOR', settings }).catch(() => {});
        }
        sendResponse({ type: 'CURSOR_APPLIED' });
        break;
      }
      case 'GET_BOUND_TAB': {
        if (targetTabId === null) {
          sendResponse({ type: 'TAB_UNBOUND' });
          break;
        }
        const tab = await chrome.tabs.get(targetTabId).catch(() => null);
        if (!tab) {
          targetTabId = null;
          sendResponse({ type: 'TAB_UNBOUND' });
        } else {
          sendResponse({ type: 'TAB_BOUND', tab: serializeTab(tab) });
        }
        break;
      }
      case 'SET_AUTO_FOLLOW': {
        autoFollow = !!message.value;
        sendResponse({ type: 'AUTO_FOLLOW_SET', value: autoFollow });
        break;
      }
      // Forward everything else to the content script in the bound tab.
      case 'RUN_SCROLL':
      case 'RUN_SEQUENCE':
      case 'PLAY_FROM_TO':
      case 'ABORT':
      case 'GET_SCROLL_POSITION':
      case 'JUMP_TO':
      case 'PING': {
        if (targetTabId === null) {
          sendResponse({ error: 'NO_BOUND_TAB' });
          break;
        }
        try {
          const response = await chrome.tabs.sendMessage(targetTabId, message);
          sendResponse(response);
        } catch (err) {
          // Content script may not be injected yet (fresh tab, race on navigation). Retry once.
          const injected = await ensureContentScript(targetTabId);
          if (!injected) {
            sendResponse({ error: 'TAB_UNREACHABLE', message: String(err) });
            break;
          }
          try {
            const response = await chrome.tabs.sendMessage(targetTabId, message);
            sendResponse(response);
          } catch (err2) {
            sendResponse({ error: 'TAB_UNREACHABLE', message: String(err2) });
          }
        }
        break;
      }
      case 'SEQUENCE_PROGRESS': {
        // Relayed from the content script; forward straight to the panel.
        notifyPanel(message);
        break;
      }
      case 'SCROLL_POSITION': {
        // Pushed by the content script on every scroll. Every tab has one
        // (content script matches <all_urls>), so only relay the bound tab's.
        if (sender.tab && sender.tab.id === targetTabId) notifyPanel(message);
        break;
      }
      default:
        break;
    }
  })();
  return true;
});

// Keyboard shortcuts — forward to the panel to trigger the same logic as button clicks.
chrome.commands.onCommand.addListener((command) => {
  notifyPanel({ type: 'SHORTCUT', command });
});
