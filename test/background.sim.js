const fs = require('fs');
const path = require('path');
// Loads background.js with a mocked chrome.* and replays the failure modes that
// have actually bitten: service-worker restarts orphaning state, and stale
// window bounds. Run with: node test/background.sim.js
const SRC = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const PANEL_URL = 'chrome-extension://abc/panel.html';

function makeWorld() {
  return {
    session: {}, local: {},
    tabs: new Map(),   // id -> {id, windowId, url, cs:bool, cursor:bool}
    windows: new Map(),// id -> {id}
    nextWin: 100,
  };
}
function addTab(w, id, windowId, url, cs = true) {
  w.tabs.set(id, { id, windowId, url, cs, cursor: false });
}

function startSW(w) {
  const L = {};
  const reg = (k) => ({ addListener: (fn) => { (L[k] = L[k] || []).push(fn); } });
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const chrome = {
    storage: {
      session: {
        get: async (k) => (w.session[k] === undefined ? {} : { [k]: clone(w.session[k]) }),
        set: async (o) => { Object.assign(w.session, clone(o)); },
      },
      local: {
        get: async (k) => (w.local[k] === undefined ? {} : { [k]: clone(w.local[k]) }),
        set: async (o) => { Object.assign(w.local, clone(o)); },
      },
    },
    runtime: {
      getURL: (p) => 'chrome-extension://abc/' + p,
      sendMessage: async () => {},
      onMessage: reg('msg'), onInstalled: reg('installed'), onStartup: reg('startup'),
    },
    action: { onClicked: reg('click') },
    commands: { onCommand: reg('cmd') },
    scripting: {
      executeScript: async ({ target }) => {
        const t = w.tabs.get(target.tabId);
        if (!t || !/^https?:/.test(t.url)) throw new Error('cannot inject');
        t.cs = true;
      },
    },
    tabs: {
      query: async (q) => {
        let out = [...w.tabs.values()];
        if (typeof q.url === 'string') out = out.filter((t) => t.url === q.url);
        else if (Array.isArray(q.url)) out = out.filter((t) => /^https?:/.test(t.url));
        if (q.active) out = out.filter((t) => t.active);
        return out.map(clone);
      },
      get: async (id) => { const t = w.tabs.get(id); if (!t) throw new Error('no tab'); return clone(t); },
      sendMessage: async (id, m) => {
        const t = w.tabs.get(id);
        if (!t || !t.cs) throw new Error('no receiver');
        if (m.type === 'PING') return { type: 'PONG', hostname: 'x', title: 'x' };
        if (m.type === 'SET_CURSOR') { t.cursor = !!(m.settings && m.settings.enabled); return { type: 'CURSOR_SET' }; }
        return {};
      },
      onRemoved: reg('tabRemoved'), onUpdated: reg('tabUpdated'), onActivated: reg('tabActivated'),
    },
    windows: {
      get: async (id) => { const x = w.windows.get(id); if (!x) throw new Error('no window'); return clone(x); },
      create: async (o) => {
        if (w.screen && (o.left !== undefined || o.top !== undefined)) {
          const onX = o.left + o.width * 0.5 > 0 && o.left + o.width * 0.5 < w.screen.w;
          const onY = o.top + o.height * 0.5 > 0 && o.top + o.height * 0.5 < w.screen.h;
          if (!onX || !onY) throw new Error('Invalid value for bounds. Bounds must be at least 50% within visible screen space.');
        }
        w.createCalls = (w.createCalls || 0) + 1;
        const id = w.nextWin++;
        w.windows.set(id, { id });
        addTab(w, 9000 + id, id, o.url, false);
        w.created = (w.created || 0) + 1;
        return { id };
      },
      update: async (id) => { if (!w.windows.get(id)) throw new Error('no window'); w.focused = id; return { id }; },
      onRemoved: reg('winRemoved'), onBoundsChanged: reg('winBounds'),
    },
  };
  new Function('chrome', SRC)(chrome);
  const fire = async (k, ...a) => { for (const fn of L[k] || []) await fn(...a); };
  return { fire };
}

const cursored = (w) => [...w.tabs.values()].filter((t) => t.cursor).map((t) => t.id);
let fails = 0;
function check(name, cond, extra = '') {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  ' + extra : ''));
  if (!cond) fails++;
}

(async () => {
  // ---- Scenario 1: the reported bug. Panel open, cursor on, SW dies between tab switches.
  console.log('\nScenario 1 — SW restarts between tab switches (the reported bug)');
  const w = makeWorld();
  w.local['cursor.v1'] = { enabled: true, size: 10, stroke: 2, color: '#FFFFFF', filled: false };
  w.windows.set(50, { id: 50 });            // panel window
  addTab(w, 500, 50, PANEL_URL, false);      // panel tab
  for (const id of [1, 2, 3, 4]) addTab(w, id, 1, 'https://site' + id + '.com');
  w.session['session.state.v1'] = { targetTabId: null, panelWindowId: 50, autoFollow: true };

  for (const id of [1, 2, 3, 4]) {
    const sw = startSW(w);                   // fresh SW each time = simulated teardown
    await sw.fire('tabActivated', { tabId: id });
  }
  check('at most one tab has a cursor', cursored(w).length === 1, 'cursored=' + JSON.stringify(cursored(w)));
  check('the cursor is on the last activated tab', cursored(w)[0] === 4);

  // ---- Scenario 2: panel closed, user keeps switching tabs
  console.log('\nScenario 2 — panel closed, user switches tabs');
  const w2 = makeWorld();
  w2.local['cursor.v1'] = { enabled: true, size: 10, stroke: 2, color: '#FFFFFF', filled: false };
  for (const id of [1, 2, 3]) addTab(w2, id, 1, 'https://site' + id + '.com');
  w2.session['session.state.v1'] = { targetTabId: null, panelWindowId: null, autoFollow: true };
  for (const id of [1, 2, 3]) {
    const sw = startSW(w2);
    await sw.fire('tabActivated', { tabId: id });
  }
  check('no cursor applied with no panel open', cursored(w2).length === 0, 'cursored=' + JSON.stringify(cursored(w2)));

  // ---- Scenario 3: closing the panel clears every cursor
  console.log('\nScenario 3 — closing the panel');
  const w3 = makeWorld();
  w3.local['cursor.v1'] = { enabled: true, size: 10, stroke: 2, color: '#FFFFFF', filled: false };
  w3.windows.set(50, { id: 50 });
  addTab(w3, 500, 50, PANEL_URL, false);
  addTab(w3, 1, 1, 'https://a.com');
  addTab(w3, 2, 1, 'https://b.com');
  w3.tabs.get(2).cursor = true;             // a cursor stranded by an earlier restart
  w3.session['session.state.v1'] = { targetTabId: null, panelWindowId: 50, autoFollow: true };
  let sw3 = startSW(w3);
  await sw3.fire('tabActivated', { tabId: 1 });
  check('binding tab 1 sweeps the stranded cursor off tab 2', cursored(w3).join() === '1', 'cursored=' + JSON.stringify(cursored(w3)));
  sw3 = startSW(w3);                        // SW dies again, then panel closes
  await sw3.fire('winRemoved', 50);
  check('closing the panel clears all cursors', cursored(w3).length === 0, 'cursored=' + JSON.stringify(cursored(w3)));

  // ---- Scenario 4: clicking the icon after a SW restart
  console.log('\nScenario 4 — clicking the toolbar icon after a SW restart');
  const w4 = makeWorld();
  w4.windows.set(50, { id: 50 });
  addTab(w4, 500, 50, PANEL_URL, false);
  addTab(w4, 1, 1, 'https://a.com');
  w4.session = {};                          // SW restarted AND session lost (worst case)
  w4.created = 0;
  const sw4 = startSW(w4);
  await sw4.fire('click', { id: 1 });
  check('does not create a second panel window', w4.created === 0, 'created=' + w4.created);
  check('focuses the existing panel', w4.focused === 50, 'focused=' + w4.focused);

  // ---- Scenario 5: turning the cursor off clears strays
  console.log('\nScenario 5 — toggling the cursor off');
  const w5 = makeWorld();
  w5.local['cursor.v1'] = { enabled: false };
  addTab(w5, 1, 1, 'https://a.com'); addTab(w5, 2, 1, 'https://b.com');
  w5.tabs.get(1).cursor = true; w5.tabs.get(2).cursor = true;
  w5.session['session.state.v1'] = { targetTabId: 1, panelWindowId: 50, autoFollow: true };
  const sw5 = startSW(w5);
  await sw5.fire('msg', { type: 'CURSOR_CHANGED' }, {}, () => {});
  await new Promise((r) => setTimeout(r, 20));
  check('off sweeps every tab, not just the bound one', cursored(w5).length === 0, 'cursored=' + JSON.stringify(cursored(w5)));

  // ---- Scenario 6: saved bounds point at a monitor that's no longer attached
  console.log('\nScenario 6 — saved panel position is off the current display');
  const w6 = makeWorld();
  w6.screen = { w: 1440, h: 900 };
  w6.local['panelBounds.v2'] = { width: 420, height: 820, left: -2400, top: 300 };
  addTab(w6, 1, 1, 'https://a.com');
  const sw6 = startSW(w6);
  let threw = false;
  try { await sw6.fire('click', { id: 1 }); } catch (e) { threw = true; }
  check('clicking the icon does not throw', !threw);
  check('panel window is created anyway', w6.windows.size === 1, 'windows=' + w6.windows.size);
  check('stale position is discarded', w6.local['panelBounds.v2'].left === undefined, JSON.stringify(w6.local['panelBounds.v2']));

  // Second click reuses it rather than retrying the bad bounds
  w6.createCalls = 0;
  const sw6b = startSW(w6);
  await sw6b.fire('click', { id: 1 });
  check('second click reuses the open panel', w6.createCalls === 0, 'createCalls=' + w6.createCalls);

  console.log(fails === 0 ? '\nAll checks passed.' : `\n${fails} check(s) FAILED.`);
  process.exit(fails === 0 ? 0 : 1);
})();
