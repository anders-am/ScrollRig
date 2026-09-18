// ScrollRig — content script
// Owns the scroll engine. No UI. Listens for messages relayed from the panel via background.js.

(() => {
  // A previous copy of this script may still be live in the page — from an earlier
  // injection, or orphaned in the isolated world after the extension was reloaded or
  // reinstalled. Its globals outlive the extension, but its listeners belong to a dead
  // context that will never answer another message. So tear that copy down and take
  // over; bailing out here would leave the page permanently unreachable until reload.
  if (typeof window.__scrollRigTeardown === 'function') {
    try {
      window.__scrollRigTeardown();
    } catch { /* already dead — nothing left to clean up */ }
  }

  const EASINGS = {
    linear: (t) => t,
    easeOut: (t) => 1 - Math.pow(1 - t, 3),
    easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    easeOutExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  };

  let activeCancel = null;
  let wheelWorks = null; // null = untested, true/false once calibrated
  let extensionContextDead = false;
  let cursorStyleEl = null;

  // chrome.runtime.sendMessage THROWS synchronously (not a rejected promise)
  // once the extension reloads and orphans this injected copy of the script —
  // "Extension context invalidated." A plain .catch() doesn't cover that.
  function safeSendMessage(message) {
    if (extensionContextDead) return;
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch {
      extensionContextDead = true;
      window.removeEventListener('scroll', reportScrollPosition);
    }
  }

  // Cubic-bezier easing solved via Newton-Raphson on the parametric curve, same
  // shape as CSS's cubic-bezier(x1, y1, x2, y2).
  function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
    const sampleY = (t) => ((ay * t + by) * t + cy) * t;
    const sampleDX = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return function (t) {
      let x = t;
      for (let i = 0; i < 8; i++) {
        const dx = sampleX(x) - t;
        if (Math.abs(dx) < 1e-5) break;
        const d = sampleDX(x);
        if (Math.abs(d) < 1e-6) break;
        x -= dx / d;
      }
      return sampleY(x);
    };
  }

  // Some sites block or ignore synthetic wheel events. Calibrate once per page
  // by dispatching a tiny wheel nudge and checking if scrollY actually moved.
  function calibrateWheel(target) {
    return new Promise((resolve) => {
      if (wheelWorks !== null) {
        resolve(wheelWorks);
        return;
      }
      const before = window.scrollY;
      dispatchWheel(target, 40);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          wheelWorks = window.scrollY !== before;
          // Undo the calibration nudge either way (wheel-driven or direct).
          const after = window.scrollY;
          if (after !== before) {
            window.scrollTo({ top: before, behavior: 'instant' });
          }
          resolve(wheelWorks);
        });
      });
    });
  }

  function getTargetElement(selector) {
    if (!selector) return window;
    try {
      const el = document.querySelector(selector);
      return el || window;
    } catch {
      return window;
    }
  }

  function dispatchWheel(target, deltaY) {
    const evt = new WheelEvent('wheel', {
      deltaY,
      bubbles: true,
      cancelable: true,
      view: window,
    });
    if (target === window) {
      window.dispatchEvent(evt);
    } else {
      target.dispatchEvent(evt);
    }
  }

  // Runs one scroll animation. distance is signed (negative = scroll up).
  async function runScroll({ distance, duration, easing = 'easeInOut', targetSelector, speedMultiplier = 1, customBezier }, signal) {
    const target = getTargetElement(targetSelector);
    const works = await calibrateWheel(target);
    const effectiveDuration = Math.max(1, duration / (speedMultiplier || 1));

    return new Promise((resolve) => {
      const ease =
        easing === 'custom' && Array.isArray(customBezier) && customBezier.length === 4
          ? cubicBezier(...customBezier)
          : EASINGS[easing] || EASINGS.easeInOut;
      const startY = window.scrollY;
      const startTime = performance.now();
      let lastValue = 0;
      let rafId = null;

      function cleanup() {
        if (rafId !== null) cancelAnimationFrame(rafId);
        signal?.removeEventListener('abort', onAbort);
      }

      function onAbort() {
        cleanup();
        resolve({ aborted: true, finalPosition: window.scrollY });
      }
      signal?.addEventListener('abort', onAbort);

      function step(now) {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / effectiveDuration, 1);
        const eased = ease(t);
        const currentValue = distance * eased;

        if (works) {
          const delta = currentValue - lastValue;
          lastValue = currentValue;
          dispatchWheel(target, delta);
        } else {
          window.scrollTo({ top: startY + currentValue, behavior: 'instant' });
        }

        if (t < 1) {
          rafId = requestAnimationFrame(step);
        } else {
          cleanup();
          resolve({ aborted: false, finalPosition: window.scrollY, startY });
        }
      }

      rafId = requestAnimationFrame(step);
    });
  }

  async function runScrollTo({ targetY, duration, easing, targetSelector, speedMultiplier, customBezier }, signal) {
    const startY = window.scrollY;
    const distance = targetY - startY;
    const result = await runScroll({ distance, duration, easing, targetSelector, speedMultiplier, customBezier }, signal);
    if (result.aborted) return result;

    // Snap-correct if we landed within 5px but not exact; leave larger gaps visible.
    const gap = targetY - window.scrollY;
    if (Math.abs(gap) > 0 && Math.abs(gap) <= 5) {
      window.scrollTo({ top: targetY, behavior: 'instant' });
    }
    return { aborted: false, finalPosition: window.scrollY };
  }

  function delay(ms, signal) {
    return new Promise((resolve) => {
      const id = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve({ aborted: false });
      }, ms);
      function onAbort() {
        clearTimeout(id);
        resolve({ aborted: true });
      }
      signal?.addEventListener('abort', onAbort);
    });
  }

  function jumpTo(y) {
    window.scrollTo({ top: y, behavior: 'instant' });
  }

  function abortActive() {
    if (activeCancel) {
      activeCancel();
      activeCancel = null;
    }
  }

  async function handleRunScroll(payload) {
    abortActive();
    const controller = new AbortController();
    activeCancel = () => controller.abort();
    const distance = payload.direction === 'up' ? -Math.abs(payload.distance) : Math.abs(payload.distance);
    const result = await runScroll({ ...payload, distance }, controller.signal);
    activeCancel = null;
    return { type: 'SCROLL_COMPLETE', finalPosition: result.finalPosition, aborted: result.aborted };
  }

  async function handleRunSequence(payload) {
    abortActive();
    const controller = new AbortController();
    activeCancel = () => controller.abort();
    const { steps } = payload;

    for (let i = 0; i < steps.length; i++) {
      if (controller.signal.aborted) break;
      const step = steps[i];
      safeSendMessage({
        type: 'SEQUENCE_PROGRESS',
        stepIndex: i,
        totalSteps: steps.length,
      });

      if (step.type === 'wait') {
        await delay(step.duration / (payload.speedMultiplier || 1), controller.signal);
      } else if (step.type === 'scrollBy') {
        const distance = step.direction === 'up' ? -Math.abs(step.distance) : Math.abs(step.distance);
        await runScroll(
          { distance, duration: step.duration, easing: step.easing, targetSelector: step.targetSelector, speedMultiplier: payload.speedMultiplier, customBezier: step.customBezier },
          controller.signal
        );
      } else if (step.type === 'scrollTo') {
        await runScrollTo(
          { targetY: step.targetY, duration: step.duration, easing: step.easing, targetSelector: step.targetSelector, speedMultiplier: payload.speedMultiplier, customBezier: step.customBezier },
          controller.signal
        );
      }
    }

    const aborted = controller.signal.aborted;
    activeCancel = null;
    return { type: 'SEQUENCE_COMPLETE', aborted, finalPosition: window.scrollY };
  }

  async function handlePlayFromTo(payload) {
    abortActive();
    const controller = new AbortController();
    activeCancel = () => controller.abort();

    jumpTo(payload.startY);
    await delay(payload.settleMs ?? 300, controller.signal);
    if (controller.signal.aborted) {
      activeCancel = null;
      return { type: 'SCROLL_COMPLETE', aborted: true, finalPosition: window.scrollY };
    }

    const result = await runScrollTo(
      { targetY: payload.endY, duration: payload.duration, easing: payload.easing, targetSelector: payload.targetSelector, speedMultiplier: payload.speedMultiplier, customBezier: payload.customBezier },
      controller.signal
    );
    activeCancel = null;
    return { type: 'SCROLL_COMPLETE', finalPosition: result.finalPosition, aborted: result.aborted };
  }

  // ── Custom cursor ────────────────────────────────────────────────────────
  // Drawn as a real CSS cursor from an inline SVG data URI, not a mousemove-
  // following element: the compositor draws it with zero latency, so the
  // recording never catches it trailing the pointer. Trade-off is SVG-only and
  // a 128px browser cap — fine for a small circle. Do NOT "upgrade" this to a
  // follower div; the latency is the whole reason it's done this way.
  function cursorRule(settings) {
    const size = Math.max(4, Math.min(96, Number(settings.size) || 10));
    const stroke = Math.max(0, Number(settings.stroke) || 0);
    const color = settings.color || '#FFFFFF';
    // Canvas must exceed the circle by the stroke, or the stroke clips at the edge.
    const canvas = size + stroke + 2;
    const c = canvas / 2;
    const r = size / 2 - (settings.filled ? 0 : stroke / 2);
    const circle = settings.filled
      ? `<circle cx="${c}" cy="${c}" r="${r}" fill="${color}"/>`
      : `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}">${circle}</svg>`;
    // '#' in the hex colour must be encoded or the data URI is truncated there.
    const encoded = encodeURIComponent(svg).replace(/#/g, '%23');
    const hot = Math.round(c);
    // '*, *::before, *::after' + !important overrides the site's contextual
    // cursors (pointer over links, text over inputs) — one cursor, always.
    return `*, *::before, *::after { cursor: url("data:image/svg+xml,${encoded}") ${hot} ${hot}, auto !important; }`;
  }

  function applyCursor(settings) {
    if (!settings || !settings.enabled) return clearCursor();
    if (!cursorStyleEl) {
      cursorStyleEl = document.createElement('style');
      cursorStyleEl.id = '__scrollrig-cursor';
      // documentElement, not body — survives frameworks that replace <body>.
      document.documentElement.appendChild(cursorStyleEl);
    }
    cursorStyleEl.textContent = cursorRule(settings);
  }

  function clearCursor() {
    if (cursorStyleEl) cursorStyleEl.remove();
    cursorStyleEl = null;
  }

  function onMessage(message, sender, sendResponse) {
    (async () => {
      switch (message.type) {
        case 'RUN_SCROLL': {
          const res = await handleRunScroll(message.payload);
          sendResponse(res);
          break;
        }
        case 'RUN_SEQUENCE': {
          const res = await handleRunSequence(message.payload);
          sendResponse(res);
          break;
        }
        case 'PLAY_FROM_TO': {
          const res = await handlePlayFromTo(message.payload);
          sendResponse(res);
          break;
        }
        case 'ABORT': {
          abortActive();
          sendResponse({ type: 'ABORTED', finalPosition: window.scrollY });
          break;
        }
        case 'GET_SCROLL_POSITION': {
          sendResponse({
            type: 'POSITION',
            position: window.scrollY,
            maxScroll: document.documentElement.scrollHeight - window.innerHeight,
            viewportHeight: window.innerHeight,
          });
          break;
        }
        case 'JUMP_TO': {
          jumpTo(message.payload.y);
          sendResponse({ type: 'POSITION', position: window.scrollY });
          break;
        }
        case 'SET_CURSOR': {
          applyCursor(message.settings);
          sendResponse({ type: 'CURSOR_SET' });
          break;
        }
        case 'PING': {
          sendResponse({ type: 'PONG', hostname: location.hostname, title: document.title });
          break;
        }
        default:
          sendResponse({ error: 'unknown message type' });
      }
    })();
    return true; // keep channel open for async sendResponse
  }
  chrome.runtime.onMessage.addListener(onMessage);

  // Push live position on every native scroll event instead of making the
  // panel poll for it — rAF-coalesced so a flood of scroll events collapses
  // to one message per frame, not the poll's fixed 100ms lag.
  let scrollReportRaf = null;
  function reportScrollPosition() {
    if (scrollReportRaf !== null) return;
    scrollReportRaf = requestAnimationFrame(() => {
      scrollReportRaf = null;
      safeSendMessage({
        type: 'SCROLL_POSITION',
        position: window.scrollY,
        maxScroll: document.documentElement.scrollHeight - window.innerHeight,
        viewportHeight: window.innerHeight,
      });
    });
  }
  window.addEventListener('scroll', reportScrollPosition, { passive: true });

  // Lets the next injected copy retire this one cleanly. Pure-JS cleanup runs first,
  // since touching chrome.* throws once this context has been invalidated.
  window.__scrollRigTeardown = () => {
    abortActive();
    // Remove the cursor override, or an uninstall/reload strands the <style>
    // element on the page with no live extension to take it down — the user
    // would have to reload every open tab to get their real cursor back.
    clearCursor();
    if (scrollReportRaf !== null) cancelAnimationFrame(scrollReportRaf);
    window.removeEventListener('scroll', reportScrollPosition);
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch { /* context already gone; the listener is inert anyway */ }
  };
})();
