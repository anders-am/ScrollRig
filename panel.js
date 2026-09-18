// ScrollRig — panel script
// All UI logic. Talks to the content script only via background.js.

(() => {
  // ---------- messaging ----------

  function send(type, payload) {
    return chrome.runtime.sendMessage({ type, payload }).catch((err) => ({ error: String(err) }));
  }

  // ---------- state ----------

  let boundTab = null;
  let boundHostname = null;
  let lastViewportHeight = 800;

  let capture = { start: null, end: null };
  let marks = []; // [{name, y}]
  let sequenceSteps = [];
  let presets = []; // [{name, steps}]
  let draggedIndex = null;
  let sequenceAbortRequested = false;

  const $ = (id) => document.getElementById(id);

  // ---------- toast ----------

  let toastTimer = null;
  function toast(message, warn = false) {
    const el = $('toast');
    el.textContent = message;
    el.classList.toggle('warn', warn);
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
  }

  // ---------- option rows ----------
  // A row is its own value: presets plus a final slot you type into.
  // Non-empty custom input wins over the selected preset.

  function initOptionRow(rowEl) {
    rowEl.dataset.preset = rowEl.dataset.value || '';
    const custom = rowEl.querySelector('input.custom');

    rowEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button.opt');
      if (!btn) return;
      rowEl.dataset.preset = btn.dataset.value;
      if (custom) custom.value = '';
      paintRow(rowEl);
    });

    if (custom) {
      custom.addEventListener('input', () => {
        custom.classList.remove('invalid');
        paintRow(rowEl);
      });
    }
  }

  function paintRow(rowEl) {
    const custom = rowEl.querySelector('input.custom');
    const hasCustom = custom && custom.value.trim() !== '';
    rowEl.querySelectorAll('button.opt').forEach((b) => {
      b.classList.toggle('active', !hasCustom && b.dataset.value === rowEl.dataset.preset);
    });
    if (custom) custom.classList.toggle('active', hasCustom);
  }

  // Numeric value of a row: custom input, else preset ('viewport' resolves live).
  function rowNumber(rowEl, fallback) {
    const custom = rowEl.querySelector('input.custom');
    const raw = custom ? custom.value.trim() : '';
    if (raw !== '') {
      const n = parseFloat(raw);
      if (!Number.isNaN(n)) return n;
    }
    const preset = rowEl.dataset.preset;
    if (preset === 'viewport') return lastViewportHeight;
    const n = parseFloat(preset);
    return Number.isNaN(n) ? fallback : n;
  }

  // Easing rows carry a cubic-bezier in their custom slot.
  function rowEasing(rowEl) {
    const custom = rowEl.querySelector('input.custom');
    const raw = custom ? custom.value.trim() : '';
    if (raw !== '') {
      const parts = raw.split(',').map((s) => parseFloat(s.trim()));
      if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
        custom.classList.remove('invalid');
        return { easing: 'custom', customBezier: parts };
      }
      custom.classList.add('invalid');
      toast('Bezier needs four numbers, e.g. 0.25, 0.1, 0.25, 1', true);
    }
    return { easing: rowEl.dataset.preset };
  }

  ['qs-distance', 'qs-duration', 'qs-easing', 'qs-direction', 'cap-duration', 'cap-easing'].forEach((id) => {
    initOptionRow($(id));
  });

  // ---------- tab binding ----------

  function setBoundState(bound, lost = false) {
    $('status-dot').classList.toggle('lost', lost);
    $('btn-run').disabled = !bound;
  }

  async function refreshHostname() {
    if (!boundTab) {
      boundHostname = null;
      return;
    }
    const res = await send('PING');
    if (res && res.hostname) {
      boundHostname = res.hostname;
      await loadDomainData();
    }
  }

  async function updateTabUI(tab) {
    boundTab = tab;
    if (tab) {
      let label = tab.title || tab.url || 'Untitled';
      try {
        label = new URL(tab.url).hostname || label;
      } catch { /* keep title */ }
      $('tab-title').textContent = label;
      setBoundState(true);
      await refreshHostname();
      await fetchPositionOnce();
    } else {
      $('tab-title').textContent = 'No tab bound';
      setBoundState(false);
      clearReadout();
    }
  }

  async function bindActiveTab() {
    const res = await send('BIND_ACTIVE_TAB');
    if (res && res.type === 'TAB_BOUND') {
      await updateTabUI(res.tab);
    } else {
      toast(res?.message || 'No tab to bind.', true);
    }
  }

  async function initBinding() {
    const res = await send('GET_BOUND_TAB');
    if (res && res.type === 'TAB_BOUND') await updateTabUI(res.tab);
    else await bindActiveTab();
  }

  chrome.runtime.onMessage.addListener((message) => {
    switch (message.type) {
      case 'TAB_LOST':
        $('tab-title').textContent = 'Tab lost — rebind';
        setBoundState(false, true);
        clearReadout();
        break;
      case 'TAB_NAVIGATED':
        setTimeout(async () => {
          if (!boundTab) return;
          await refreshHostname();
          await fetchPositionOnce();
        }, 400);
        break;
      case 'TAB_BOUND':
        updateTabUI(message.tab);
        break;
      case 'SHORTCUT':
        handleShortcut(message.command);
        break;
      case 'SEQUENCE_PROGRESS':
        highlightStep(message.stepIndex);
        break;
      case 'SCROLL_POSITION':
        updateReadout(message.position, message.maxScroll, message.viewportHeight);
        break;
    }
  });

  // ---------- position readout ----------
  // The content script pushes SCROLL_POSITION on every native scroll event
  // (rAF-coalesced at the source), so the readout tracks the real position
  // with no polling interval and no added lag. A one-time fetch seeds the
  // value whenever there's nothing to push yet — right after binding, or
  // right after a navigation before the page has scrolled at all.

  function updateReadout(position, maxScroll, viewportHeight) {
    const pos = Math.round(position);
    const max = Math.round(maxScroll);
    $('readout-position').textContent = pos;
    $('readout-max').textContent = max;
    $('meter-fill').style.width = max > 0 ? `${Math.min(100, (pos / max) * 100)}%` : '0%';
    if (viewportHeight) lastViewportHeight = viewportHeight;
  }

  function clearReadout() {
    $('readout-position').textContent = '0';
    $('readout-max').textContent = '0';
    $('meter-fill').style.width = '0%';
  }

  async function fetchPositionOnce() {
    if (!boundTab) return;
    const res = await send('GET_SCROLL_POSITION');
    if (res && res.type === 'POSITION') {
      updateReadout(res.position, res.maxScroll, res.viewportHeight);
    } else if (res && res.error === 'TAB_UNREACHABLE') {
      $('tab-title').textContent = 'Tab lost — rebind';
      setBoundState(false, true);
      clearReadout();
    }
  }

  // ---------- storage (per-domain) ----------

  const key = (prefix) => `${prefix}:${boundHostname}`;

  async function loadDomainData() {
    if (!boundHostname) return;
    const data = await chrome.storage.local.get([key('positions'), key('presets')]);
    const pos = data[key('positions')] || { start: null, end: null, saved: [] };
    capture.start = pos.start;
    capture.end = pos.end;
    marks = pos.saved || [];
    presets = data[key('presets')] || [];
    $('cap-start').value = capture.start ?? '';
    $('cap-end').value = capture.end ?? '';
    renderMarks();
    renderPresets();
  }

  async function savePositions() {
    if (!boundHostname) return;
    await chrome.storage.local.set({
      [key('positions')]: { start: capture.start, end: capture.end, saved: marks },
    });
  }

  async function savePresets() {
    if (!boundHostname) return;
    await chrome.storage.local.set({ [key('presets')]: presets });
  }

  // ---------- tabs ----------

  const RUN_LABELS = {
    quick: 'Run scroll',
    capture: 'Run start → end',
    sequence: 'Run sequence',
  };

  function activeTabName() {
    return document.querySelector('.tab-btn.active').dataset.tab;
  }

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $('panel-' + btn.dataset.tab).classList.add('active');
      $('run-label').textContent = RUN_LABELS[btn.dataset.tab];
    });
  });

  // ---------- Quick ----------

  async function playQuick() {
    if (!boundTab) return;
    const { easing, customBezier } = rowEasing($('qs-easing'));
    const res = await send('RUN_SCROLL', {
      distance: rowNumber($('qs-distance'), 1000),
      duration: rowNumber($('qs-duration'), 1000),
      direction: $('qs-direction').dataset.preset,
      easing,
      customBezier,
    });
  }

  // ---------- From → To ----------

  function readCaptureInputs() {
    const s = parseFloat($('cap-start').value);
    const e = parseFloat($('cap-end').value);
    capture.start = Number.isNaN(s) ? null : Math.round(s);
    capture.end = Number.isNaN(e) ? null : Math.round(e);
    savePositions();
  }

  ['cap-start', 'cap-end'].forEach((id) => {
    $(id).addEventListener('input', readCaptureInputs);
  });

  async function grabCurrent(which) {
    if (!boundTab) return;
    const res = await send('GET_SCROLL_POSITION');
    if (res?.type !== 'POSITION') return;
    const y = Math.round(res.position);
    $(which === 'start' ? 'cap-start' : 'cap-end').value = y;
    readCaptureInputs();
  }

  $('cap-now-start').addEventListener('click', () => grabCurrent('start'));
  $('cap-now-end').addEventListener('click', () => grabCurrent('end'));

  async function playCapture() {
    if (!boundTab) return;
    if (capture.start === null || capture.end === null) {
      toast('Set both start and end first.', true);
      return;
    }
    const { easing, customBezier } = rowEasing($('cap-easing'));
    sequenceAbortRequested = false;
    await send('PLAY_FROM_TO', {
      startY: capture.start,
      endY: capture.end,
      duration: rowNumber($('cap-duration'), 2000),
      easing,
      customBezier,
      settleMs: 300,
    });
  }

  // ---------- Marks ----------

  function renderMarks() {
    const list = $('marks-list');
    list.textContent = '';
    if (marks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-empty';
      empty.textContent = 'Nothing saved for this site yet.';
      list.appendChild(empty);
      return;
    }
    marks.forEach((mark, idx) => {
      const row = document.createElement('div');
      row.className = 'list-item';

      const name = document.createElement('span');
      name.className = 'list-name';
      name.textContent = mark.name;

      const meta = document.createElement('span');
      meta.className = 'list-meta';

      const value = document.createElement('span');
      value.className = 'list-value';
      value.textContent = mark.y;

      const jump = document.createElement('button');
      jump.className = 'mini';
      jump.textContent = 'Go';
      jump.addEventListener('click', () => send('JUMP_TO', { y: mark.y }));

      const del = document.createElement('button');
      del.className = 'mini danger';
      del.textContent = 'Del';
      del.addEventListener('click', () => {
        marks.splice(idx, 1);
        renderMarks();
        savePositions();
      });

      meta.append(value, jump, del);
      row.append(name, meta);
      list.appendChild(row);
    });
  }

  $('mark-save').addEventListener('click', async () => {
    if (!boundTab) return;
    const input = $('mark-name');
    const name = input.value.trim();
    if (!name) {
      toast('Name the position first.', true);
      return;
    }
    const res = await send('GET_SCROLL_POSITION');
    if (res?.type !== 'POSITION') return;
    marks.push({ name, y: Math.round(res.position) });
    input.value = '';
    renderMarks();
    savePositions();
  });

  // ---------- Sequence ----------

  const stepId = () => Math.random().toString(36).slice(2, 10);

  function newStep(type) {
    if (type === 'wait') return { id: stepId(), type: 'wait', duration: 500 };
    if (type === 'scrollTo') return { id: stepId(), type: 'scrollTo', targetY: 0, duration: 800, easing: 'easeInOut' };
    return { id: stepId(), type: 'scrollBy', distance: 500, direction: 'down', duration: 600, easing: 'easeInOut' };
  }

  const STEP_LABEL = { wait: 'Wait', scrollTo: 'Scroll to', scrollBy: 'Scroll by' };
  // [value, label] — labels match the easing row's vocabulary, not the internal names.
  const EASINGS = [['linear', 'Linear'], ['easeOut', 'Out'], ['easeInOut', 'In-Out'], ['easeOutExpo', 'Expo']];
  const DIRECTIONS = [['down', 'Down ↓'], ['up', 'Up ↑']];

  function field(labelText, value, onChange, width) {
    const wrap = document.createElement('label');
    wrap.className = 'step-field';
    const lbl = document.createElement('span');
    lbl.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.value = value;
    if (width) input.style.width = width;
    input.addEventListener('input', () => onChange(input.value));
    wrap.append(lbl, input);
    return wrap;
  }

  const CROSSHAIR_SVG =
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="2.6" stroke="currentColor" stroke-width="1"></circle><path d="M6 0.6V2.4M6 9.6V11.4M0.6 6H2.4M9.6 6H11.4" stroke="currentColor" stroke-width="1" stroke-linecap="round"></path></svg>';

  // Same as field(), but for an absolute scroll position: a crosshair rides
  // inside the input's right edge to grab the live position instead of typing one.
  function positionField(labelText, value, onChange) {
    const wrap = document.createElement('label');
    wrap.className = 'step-field';
    const lbl = document.createElement('span');
    lbl.textContent = labelText;

    const posWrap = document.createElement('span');
    posWrap.className = 'pos-input';

    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.className = 'pos';
    input.value = value;
    input.addEventListener('input', () => onChange(input.value));

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'crosshair';
    btn.title = 'Use current position';
    btn.setAttribute('aria-label', 'Use current scroll position');
    btn.innerHTML = CROSSHAIR_SVG;
    btn.addEventListener('click', async () => {
      if (!boundTab) return;
      const res = await send('GET_SCROLL_POSITION');
      if (res?.type !== 'POSITION') return;
      const y = Math.round(res.position);
      input.value = y;
      onChange(y);
    });

    posWrap.append(input, btn);
    wrap.append(lbl, posWrap);
    return wrap;
  }

  function select(labelText, options, value, onChange) {
    const wrap = document.createElement('label');
    wrap.className = 'step-field';
    const lbl = document.createElement('span');
    lbl.textContent = labelText;
    const sel = document.createElement('select');
    options.forEach(([val, text]) => {
      const o = document.createElement('option');
      o.value = val;
      o.textContent = text;
      if (val === value) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => onChange(sel.value));
    wrap.append(lbl, sel);
    return wrap;
  }

  function renderSequence() {
    const list = $('seq-list');
    list.textContent = '';
    if (sequenceSteps.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-empty';
      empty.textContent = 'No steps yet.';
      list.appendChild(empty);
      return;
    }
    sequenceSteps.forEach((step, idx) => list.appendChild(renderStep(step, idx)));
  }

  function renderStep(step, idx) {
    const card = document.createElement('div');
    card.className = 'step';
    card.draggable = true;
    card.dataset.index = idx;

    const head = document.createElement('div');
    head.className = 'step-head';

    const title = document.createElement('div');
    title.className = 'step-title';
    const index = document.createElement('span');
    index.className = 'step-index';
    index.textContent = String(idx + 1).padStart(2, '0');
    const type = document.createElement('span');
    type.className = 'step-type';
    type.textContent = STEP_LABEL[step.type];
    title.append(index, type);

    const actions = document.createElement('div');
    actions.className = 'step-actions';
    const dup = document.createElement('button');
    dup.className = 'mini';
    dup.textContent = 'Dup';
    dup.addEventListener('click', () => {
      sequenceSteps.splice(idx + 1, 0, { ...step, id: stepId() });
      renderSequence();
      scrollStepIntoView(idx + 1);
    });
    const del = document.createElement('button');
    del.className = 'mini danger';
    del.textContent = 'Del';
    del.addEventListener('click', () => {
      sequenceSteps.splice(idx, 1);
      renderSequence();
    });
    actions.append(dup, del);
    head.append(title, actions);

    const fields = document.createElement('div');
    fields.className = 'step-fields';

    if (step.type === 'wait') {
      fields.append(field('ms', step.duration, (v) => (step.duration = Number(v))));
    } else if (step.type === 'scrollBy') {
      fields.append(
        field('px', step.distance, (v) => (step.distance = Number(v))),
        select('dir', DIRECTIONS, step.direction, (v) => (step.direction = v)),
        field('ms', step.duration, (v) => (step.duration = Number(v))),
        select('ease', EASINGS, step.easing, (v) => (step.easing = v))
      );
    } else {
      fields.append(
        positionField('to', step.targetY, (v) => (step.targetY = Number(v))),
        field('ms', step.duration, (v) => (step.duration = Number(v))),
        select('ease', EASINGS, step.easing, (v) => (step.easing = v))
      );
    }

    card.addEventListener('dragstart', () => {
      draggedIndex = idx;
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      draggedIndex = null;
      hideDropIndicator();
    });

    card.append(head, fields);
    return card;
  }

  // ---------- Drag reorder: a line shows exactly where the step will land ----------

  const dropIndicator = document.createElement('div');
  dropIndicator.className = 'drop-indicator';

  function stepCards() {
    return [...$('seq-list').querySelectorAll('.step')];
  }

  // Index (0..count) where the dragged step would land if dropped at this Y.
  function dropIndexAt(clientY) {
    const cards = stepCards();
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return cards.length;
  }

  function showDropIndicator(index) {
    const list = $('seq-list');
    const ref = stepCards()[index] || null;
    if (dropIndicator.parentNode !== list || dropIndicator.nextSibling !== ref) {
      list.insertBefore(dropIndicator, ref);
    }
  }

  function hideDropIndicator() {
    if (dropIndicator.parentNode) dropIndicator.remove();
  }

  const seqList = $('seq-list');

  seqList.addEventListener('dragover', (e) => {
    if (draggedIndex === null) return;
    e.preventDefault();
    showDropIndicator(dropIndexAt(e.clientY));
  });

  seqList.addEventListener('dragleave', (e) => {
    if (!seqList.contains(e.relatedTarget)) hideDropIndicator();
  });

  seqList.addEventListener('drop', (e) => {
    e.preventDefault();
    hideDropIndicator();
    if (draggedIndex === null) return;
    let target = dropIndexAt(e.clientY);
    if (draggedIndex < target) target -= 1;
    if (target !== draggedIndex) {
      const [moved] = sequenceSteps.splice(draggedIndex, 1);
      sequenceSteps.splice(target, 0, moved);
    }
    draggedIndex = null;
    renderSequence();
  });

  function highlightStep(index) {
    document.querySelectorAll('.step').forEach((s) => s.classList.remove('running'));
    const card = document.querySelector(`.step[data-index="${index}"]`);
    if (card) card.classList.add('running');
  }

  // New steps always land at the end — scroll that into view so a long
  // sequence never hides what you just added.
  function scrollStepIntoView(index) {
    stepCards()[index]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function addStep(type) {
    sequenceSteps.push(newStep(type));
    renderSequence();
    scrollStepIntoView(sequenceSteps.length - 1);
  }

  $('seq-add-scroll').addEventListener('click', () => addStep('scrollBy'));
  $('seq-add-scroll-to').addEventListener('click', () => addStep('scrollTo'));
  $('seq-add-wait').addEventListener('click', () => addStep('wait'));

  async function playSequence() {
    if (!boundTab || sequenceSteps.length === 0) return;
    const speedMultiplier = parseFloat($('sel-speed').value) || 1;
    const loop = $('chk-loop').checked;
    sequenceAbortRequested = false;

    do {
      const res = await send('RUN_SEQUENCE', { steps: sequenceSteps, speedMultiplier });
      document.querySelectorAll('.step').forEach((s) => s.classList.remove('running'));
      if (!res || res.aborted) break;
    } while (loop && !sequenceAbortRequested);
  }

  // ---------- Presets ----------

  function renderPresets() {
    const list = $('preset-list');
    list.textContent = '';
    if (presets.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'list-empty';
      empty.textContent = 'No saved sequences yet.';
      list.appendChild(empty);
      return;
    }
    presets.forEach((preset, idx) => {
      const row = document.createElement('div');
      row.className = 'list-item';

      const name = document.createElement('span');
      name.className = 'list-name';
      name.textContent = preset.name;

      const meta = document.createElement('span');
      meta.className = 'list-meta';

      const count = document.createElement('span');
      count.className = 'list-value';
      count.textContent = `${preset.steps.length} steps`;

      const load = document.createElement('button');
      load.className = 'mini';
      load.textContent = 'Load';
      load.addEventListener('click', () => {
        sequenceSteps = preset.steps.map((s) => ({ ...s, id: stepId() }));
        renderSequence();
      });

      const del = document.createElement('button');
      del.className = 'mini danger';
      del.textContent = 'Del';
      del.addEventListener('click', () => {
        presets.splice(idx, 1);
        renderPresets();
        savePresets();
      });

      meta.append(count, load, del);
      row.append(name, meta);
      list.appendChild(row);
    });
  }

  $('preset-save').addEventListener('click', () => {
    const input = $('preset-name');
    const name = input.value.trim();
    if (!name) { toast('Name the sequence first.', true); return; }
    if (sequenceSteps.length === 0) { toast('Add steps first.', true); return; }
    presets.push({ name, steps: sequenceSteps.map((s) => ({ ...s })) });
    input.value = '';
    renderPresets();
    savePresets();
  });

  $('preset-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ presets }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scrollrig-${boundHostname || 'presets'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $('preset-import').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const imported = Array.isArray(parsed.presets) ? parsed.presets : Array.isArray(parsed) ? parsed : [];
        presets.push(...imported);
        renderPresets();
        savePresets();
        toast(`Imported ${imported.length} preset(s).`);
      } catch {
        toast('That file is not valid JSON.', true);
      }
    });
    input.click();
  });

  // ---------- Stagger generator ----------

  const staggerModal = $('stagger-modal');
  $('seq-stagger').addEventListener('click', () => staggerModal.classList.remove('hidden'));
  $('stg-cancel').addEventListener('click', () => staggerModal.classList.add('hidden'));

  $('stg-generate').addEventListener('click', () => {
    const total = parseFloat($('stg-total').value) || 2000;
    const count = Math.max(1, parseInt($('stg-steps').value, 10) || 5);
    const duration = parseFloat($('stg-duration').value) || 600;
    const pause = parseFloat($('stg-pause').value) || 800;
    const per = Math.round(total / count);

    for (let i = 0; i < count; i++) {
      sequenceSteps.push({ id: stepId(), type: 'scrollBy', distance: per, direction: 'down', duration, easing: 'easeInOut' });
      if (i < count - 1) sequenceSteps.push({ id: stepId(), type: 'wait', duration: pause });
    }
    renderSequence();
    scrollStepIntoView(sequenceSteps.length - 1);
    staggerModal.classList.add('hidden');
  });

  // ---------- Run / abort ----------

  function runActive() {
    const tab = activeTabName();
    if (tab === 'quick') return playQuick();
    if (tab === 'capture') return playCapture();
    return playSequence();
  }

  async function abortActive() {
    sequenceAbortRequested = true;
    if (boundTab) await send('ABORT');
  }

  $('btn-run').addEventListener('click', runActive);
  $('btn-stop').addEventListener('click', abortActive);

  function handleShortcut(command) {
    if (command === 'set-start') grabCurrent('start');
    else if (command === 'set-end') grabCurrent('end');
    else if (command === 'play') runActive();
    else if (command === 'abort') abortActive();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') abortActive();
  });

  // ---------- Header ----------

  $('btn-bind').addEventListener('click', bindActiveTab);
  $('chk-auto-follow').addEventListener('change', (e) => {
    chrome.runtime.sendMessage({ type: 'SET_AUTO_FOLLOW', value: e.target.checked }).catch(() => {});
  });

  // ---------- init ----------

  document.querySelectorAll('.opts[data-value]').forEach(paintRow);
  renderSequence();
  renderMarks();
  renderPresets();
  initBinding();
})();
