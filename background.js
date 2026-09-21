// ScrollRig — background service worker
// Opens the panel, tracks the bound tab, relays messages between panel and content script,
// handles keyboard shortcuts.

// This is an MV3 service worker: Chrome tears it down after ~30s idle and on
// system sleep, which wipes every module-level variable. These three describe
// live, persistent state (a cursor painted onto a page, a panel window on
// screen), so keeping them only in memory meant a restart orphaned whatever
// they were tracking. They're cached here but backed by chrome.storage.session,
// which survives SW restarts and clears on browser restart — exactly the
// lifetime we want. Every entry point must `await loadState()` before reading.
let targetTabId = null;
let panelWindowId = null;
let autoFollow = true;

const STATE_KEY = 'session.state.v1';
let statePromise = null;

function loadState() {
  if (!statePromise) {
    statePromise = (async () => {
      const stored = await chrome.storage.session.get(STATE_KEY);
      const s = stored[STATE_KEY];
      if (s) {
        targetTabId = s.targetTabId ?? null;
        panelWindowId = s.panelWindowId ?? null;
        autoFollow = s.autoFollow ?? true;
      }
    })();
  }
  return statePromise;
}

async function saveState() {
  await chrome.storage.session.set({
    [STATE_KEY]: { targetTabId, panelWindowId, autoFollow },
  });
}

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
  // Stale bookkeeping from a previous version shouldn't describe this one.
  await chrome.storage.session.remove(STATE_KEY).catch(() => {});
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.all(tabs.map((tab) => ensureContentScript(tab.id)));
  // Nothing is bound yet on a fresh start, so no page should be wearing a
  // cursor. This also clears any left stranded by an older build.
  await clearCursorEverywhere();
});

async function getSavedBounds() {
  const stored = await chrome.storage.local.get(BOUNDS_KEY);
  return stored[BOUNDS_KEY] || DEFAULT_BOUNDS;
}

async function saveBounds(bounds) {
  await chrome.storage.local.set({ [BOUNDS_KEY]: bounds });
}

// Chrome refuses windows.create outright — it throws rather than clamping —
// when the requested bounds aren't at least 50% on a visible display. Saved
// coordinates go stale whenever a monitor is unplugged or the resolution
// changes, and guessing which coordinates are valid isn't possible without the
// system.display permission. So let Chrome arbitrate: try the saved position,
// and on rejection drop it and let Chrome place the window itself.
async function createPanelWindow(bounds) {
  const base = {
    url: chrome.runtime.getURL('panel.html'),
    type: 'popup',
    width: bounds.width || DEFAULT_BOUNDS.width,
    height: bounds.height || DEFAULT_BOUNDS.height,
  };

  if (bounds.left !== undefined && bounds.top !== undefined) {
    try {
      return await chrome.windows.create({ ...base, left: bounds.left, top: bounds.top });
    } catch {
      // Stale position — forget it so the next open doesn't repeat this.
      await chrome.storage.local
        .set({ [BOUNDS_KEY]: { width: base.width, height: base.height } })
        .catch(() => {});
    }
  }

  try {
    return await chrome.windows.create(base);
  } catch {
    // Even the size was rejected (absurd stored dimensions). Fall back to stock.
    return chrome.windows
      .create({ ...base, width: DEFAULT_BOUNDS.width, height: DEFAULT_BOUNDS.height })
      .catch(() => null);
  }
}

async function openPanel(initialTab) {
  await loadState();

  // Reuse an existing panel. After a SW restart panelWindowId is gone, so also
  // look the window up by URL — without this, clicking the icon spawned a second
  // panel (often offscreen, so it read as "nothing opened") and leaked the first.
  let existingId = null;
  if (panelWindowId !== null && (await chrome.windows.get(panelWindowId).catch(() => null))) {
    existingId = panelWindowId;
  } else {
    existingId = await findPanelWindowId();
  }

  if (existingId !== null) {
    panelWindowId = existingId;
    await saveState();
    await chrome.windows.update(existingId, { focused: true, state: 'normal' }).catch(() => {});
    return;
  }

  const bounds = await getSavedBounds();
  const win = await createPanelWindow(bounds);
  if (!win) return; // couldn't open at all; nothing to record
  panelWindowId = win.id;

  if (initialTab && initialTab.id) {
    targetTabId = initialTab.id;
    await ensureContentScript(initialTab.id);
  }
  await saveState();
}

chrome.action.onClicked.addListener(async (tab) => {
  await openPanel(tab);
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  await loadState();
  if (windowId === panelWindowId) {
    panelWindowId = null;
    targetTabId = null;
    await saveState();
    // The panel is the only way to switch the cursor off, so leaving it painted
    // on a page after the panel closes strands the user with no control.
    await clearCursorEverywhere();
  }
});

chrome.windows.onBoundsChanged.addListener(async (window) => {
  await loadState();
  if (window.id === panelWindowId) {
    await saveBounds({
      width: window.width,
      height: window.height,
      left: window.left,
      top: window.top,
    });
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await loadState();
  if (tabId === targetTabId) {
    targetTabId = null;
    await saveState();
    notifyPanel({ type: 'TAB_LOST', reason: 'closed' });
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  await loadState();
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
  await loadState();
  if (!autoFollow) return;
  // Auto-follow only means anything while the panel is open. Without this the
  // extension kept binding — and painting the cursor onto — every tab the user
  // clicked long after they'd closed the panel.
  if (!(await panelIsOpen())) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  // Don't rebind to the panel window itself.
  if (tab.windowId === panelWindowId) return;
  if (tab.id === targetTabId) return; // already bound here
  targetTabId = tabId;
  await saveState();
  // Sweep rather than clearing just the previous tab: self-heals any cursor
  // stranded by an earlier restart instead of leaving it painted forever.
  await clearCursorEverywhere(tabId);
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

// Clearing only the one tab we *think* we cursored is too fragile: if that
// bookkeeping is ever lost, the cursor is stranded on a page with no way to
// remove it. Sweeping every tab makes the invariant "at most one tab has a
// cursor" self-healing, and costs one message per tab that already has a
// content script. Tabs without one reject the message and are skipped.
async function clearCursorEverywhere(exceptTabId = null) {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.all(
    tabs.map((tab) => {
      if (tab.id === exceptTabId || tab.id === undefined) return null;
      return chrome.tabs
        .sendMessage(tab.id, { type: 'SET_CURSOR', settings: { enabled: false } })
        .catch(() => {});
    })
  );
}

// The panel window may still be on screen after the SW restarted and forgot its
// id. Find it by its URL rather than creating a second one.
async function findPanelWindowId() {
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('panel.html') });
  return tabs.length > 0 ? tabs[0].windowId : null;
}

async function panelIsOpen() {
  if (panelWindowId !== null) {
    const win = await chrome.windows.get(panelWindowId).catch(() => null);
    if (win) return true;
  }
  const found = await findPanelWindowId();
  if (found !== null) {
    panelWindowId = found;
    await saveState();
    return true;
  }
  if (panelWindowId !== null) {
    panelWindowId = null;
    await saveState();
  }
  return false;
}

function notifyPanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

// Message router: panel <-> content script, plus direct background commands.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    await loadState();
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
          targetTabId = bound.id;
          await saveState();
          await clearCursorEverywhere(bound.id);
          await ensureContentScript(bound.id);
          await applyCursorToTab(bound.id);
          sendResponse({ type: 'TAB_BOUND', tab: serializeTab(bound) });
        } else {
          sendResponse({ type: 'ERROR', message: 'No eligible tab to bind.' });
        }
        break;
      }
      case 'UNBIND_TAB': {
        targetTabId = null;
        await saveState();
        await clearCursorEverywhere();
        sendResponse({ type: 'TAB_UNBOUND' });
        break;
      }
      case 'CURSOR_CHANGED': {
        // Panel already wrote the new settings to storage. Push them straight to
        // the bound tab — unconditionally, so toggling OFF actually clears it
        // (applyCursorToTab short-circuits on disabled, which is only right for
        // navigation/rebind where a fresh page is already clean).
        const settings = (await getCursorSettings()) || { enabled: false };
        if (!settings.enabled) {
          // Turning it off sweeps every tab, not just the bound one, so a cursor
          // stranded on some other tab can always be cleared from the panel.
          await clearCursorEverywhere();
        } else if (targetTabId !== null) {
          await ensureContentScript(targetTabId);
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
          await saveState();
          sendResponse({ type: 'TAB_UNBOUND' });
        } else {
          sendResponse({ type: 'TAB_BOUND', tab: serializeTab(tab) });
        }
        break;
      }
      case 'GET_AUTO_FOLLOW': {
        sendResponse({ type: 'AUTO_FOLLOW', value: autoFollow });
        break;
      }
      case 'SET_AUTO_FOLLOW': {
        autoFollow = !!message.value;
        await saveState();
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
