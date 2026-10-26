/* Loaded before styles and application modules on the diagnostic page only. */
(() => {
  'use strict';
  if (globalThis.plIsiDiagnostics) return;

  // === Session buffer ===
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const MAX_ENTRIES = 12000;
  const MAX_CHARACTERS = 2000000;
  const startup = [];
  const recent = new Array(MAX_ENTRIES);
  const counts = Object.create(null);
  let head = 0, length = 0, characters = 0, dropped = 0, sequence = 0, stopped = false;
  const round = value => Math.round(value * 100) / 100;

  function record(event, details = {}) {
    if (stopped) return;
    try {
      const entry = { sequence: ++sequence, atMs: round(performance.now()), event, ...details };
      let text = JSON.stringify(entry, (key, value) => typeof value === 'number' ? round(value) : value);
      if (text.length > 8000) text = JSON.stringify({ sequence: entry.sequence, atMs: entry.atMs, event, truncated: true, detail: text.slice(0, 6000) });
      counts[event] = (counts[event] || 0) + 1;
      if (startup.length < 64) { startup.push(text); characters += text.length; return; }
      while (length && (length === MAX_ENTRIES || characters + text.length > MAX_CHARACTERS)) {
        characters -= recent[head].length;
        recent[head] = undefined; head = (head + 1) % MAX_ENTRIES; length--; dropped++;
      }
      recent[(head + length) % MAX_ENTRIES] = text; length++; characters += text.length;
    } catch { /* Diagnostics must never interrupt the product page. */ }
  }

  function stats() { return { recorded: sequence, retained: startup.length + length, dropped, characters, elapsedMs: round(performance.now() - started) }; }
  function snapshot() {
    const entries = startup.concat(Array.from({ length }, (_, index) => recent[(head + index) % MAX_ENTRIES]));
    return { schema: 1, application: 'Product List diagnostics', startedAt, exportedAt: new Date().toISOString(), timeOrigin: performance.timeOrigin,
      page: location.origin + location.pathname, retention: { ...stats(), maxEntries: MAX_ENTRIES + 64, maxCharacters: MAX_CHARACTERS, startupEntriesPreserved: startup.length },
      counts: { ...counts }, events: entries.map(text => JSON.parse(text)) };
  }
  Object.defineProperty(globalThis, 'plIsiDiagnostics', { configurable: true, value: Object.freeze({ record, snapshot, stats }) });

  // === Browser activity ===
  const events = new AbortController();
  const observers = [];
  const restorers = [];
  const listen = (target, type, handler, options = {}) => target?.addEventListener(type, handler, { passive: true, signal: events.signal, ...options });
  const safeUrl = value => { if (!value) return ''; try { const url = new URL(value, location.href); return url.origin + url.pathname; } catch { return String(value).slice(0, 300); } };
  const targetName = target => target instanceof Element ? (target.id ? `#${target.id}` : target.closest('.workspace-back-top') ? 'back-to-top' : `${target.tagName.toLowerCase()}${target.dataset.action ? `[${target.dataset.action}]` : ''}`) : 'window';
  const errorDetails = error => ({ name: error?.name || 'Error', message: String(error?.message || error || '').slice(0, 1500), stack: String(error?.stack || '').slice(0, 4000) });
  const viewport = () => ({ width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio, visual: window.visualViewport ? { width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale, offsetTop: visualViewport.offsetTop } : null });
  record('recorder-start', { state: document.readyState, visible: !document.hidden, userAgent: navigator.userAgent, language: navigator.language,
    hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory, touchPoints: navigator.maxTouchPoints, viewport: viewport(),
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, contentVisibility: CSS.supports('content-visibility', 'auto'),
    performanceTypes: globalThis.PerformanceObserver?.supportedEntryTypes || [], connection: navigator.connection ? { effectiveType: navigator.connection.effectiveType, rtt: navigator.connection.rtt, downlink: navigator.connection.downlink, saveData: navigator.connection.saveData } : null });

  function wrap(owner, name, factory) {
    const original = owner[name];
    if (typeof original !== 'function') return;
    const wrapped = factory(original);
    owner[name] = wrapped;
    restorers.push(() => { if (owner[name] === wrapped) owner[name] = original; });
  }
  let fetchId = 0;
  wrap(window, 'fetch', original => function (...args) {
    const id = ++fetchId, at = performance.now();
    const url = safeUrl(args[0] instanceof Request ? args[0].url : args[0]);
    record('fetch-start', { id, url, method: args[1]?.method || (args[0] instanceof Request ? args[0].method : 'GET') });
    try {
      return original.apply(this, args).then(response => {
        record('fetch-response', { id, url, status: response.status, redirected: response.redirected, responseUrl: safeUrl(response.url), durationMs: performance.now() - at });
        return response;
      }, error => { record('fetch-failed', { id, url, durationMs: performance.now() - at, ...errorDetails(error) }); throw error; });
    } catch (error) { record('fetch-failed', { id, url, durationMs: performance.now() - at, ...errorDetails(error) }); throw error; }
  });
  for (const level of ['debug', 'log', 'info', 'warn', 'error']) wrap(console, level, original => function (...args) {
    record('console', { level, values: args.slice(0, 8).map(value => value instanceof Error ? errorDetails(value) : typeof value === 'object' ? Object.prototype.toString.call(value) : String(value).slice(0, 1500)) });
    return original.apply(this, args);
  });
  listen(window, 'error', event => record('error', { ...errorDetails(event.error || event.message), url: safeUrl(event.filename || event.target?.src || event.target?.href || ''), line: event.lineno, column: event.colno }), { capture: true });
  listen(window, 'unhandledrejection', event => record('unhandled-rejection', errorDetails(event.reason)));
  listen(window, 'online', () => record('network-state', { online: true }));
  listen(window, 'offline', () => record('network-state', { online: false }));
  listen(window, 'resize', () => record('viewport', viewport()));
  listen(window.visualViewport, 'resize', () => record('visual-viewport', viewport()));

  // === Input, scrolling and main-thread timing ===
  let activeUntil = 0, lastScroll = 0, scrollEvents = 0, lastScrollSample = 0;
  let lastFrame = 0, frame = 0, frames = 0, frameTotal = 0, worstFrame = 0, slowFrames = 0;
  let lastHeartbeat = performance.now(), heartbeat = 0;
  let changes = { batches: 0, added: 0, removed: 0, attributes: 0 };
  let lastTouchMove = 0;
  for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'click', 'touchstart', 'touchend', 'touchcancel', 'wheel', 'input', 'change', 'keydown', 'focusin', 'focusout']) {
    listen(document, type, event => {
      if (type === 'wheel' && performance.now() - lastTouchMove < 150) return;
      if (type === 'wheel') lastTouchMove = performance.now();
      const target = targetName(event.target);
      if (target === 'back-to-top' || ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'wheel'].includes(type)) activeUntil = performance.now() + 5000;
      record('input', { type, target, pointerType: event.pointerType, trusted: event.isTrusted, eventAtMs: event.timeStamp,
        dispatchDelayMs: Math.max(0, performance.now() - event.timeStamp), key: ['Tab', 'Enter', 'Escape', ' ', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown'].includes(event.key) ? event.key : undefined,
        valueLength: type === 'input' ? event.target.value?.length : undefined, x: event.clientX, y: event.clientY, scrollY });
    }, { capture: true });
  }
  listen(document, 'touchmove', event => {
    if (performance.now() - lastTouchMove < 150) return;
    lastTouchMove = performance.now(); activeUntil = lastTouchMove + 1500;
    record('touch-move', { target: targetName(event.target), scrollY, touches: event.touches.length });
  }, { capture: true });
  listen(document, 'scroll', () => { lastScroll = performance.now(); scrollEvents++; }, { capture: true });
  listen(document, 'scrollend', event => record('scroll-end', { target: targetName(event.target), scrollY, scrollX }), { capture: true });
  for (const method of ['scrollTo', 'scrollBy']) wrap(window, method, original => function (...args) {
    const at = performance.now(); activeUntil = at + 5000;
    const options = typeof args[0] === 'object' ? { top: args[0]?.top, left: args[0]?.left, behavior: args[0]?.behavior } : { left: args[0], top: args[1] };
    record('scroll-call', { method, options, scrollY, scrollX });
    try { return original.apply(this, args); }
    finally { record('scroll-call-returned', { method, durationMs: performance.now() - at, scrollY, scrollX }); }
  });
  wrap(HTMLElement.prototype, 'focus', original => function (...args) {
    const at = performance.now(); record('focus-call', { target: targetName(this), preventScroll: args[0]?.preventScroll });
    try { return original.apply(this, args); }
    finally { record('focus-call-returned', { target: targetName(this), durationMs: performance.now() - at }); }
  });

  function measureFrame(at) {
    frame = 0;
    if (stopped || document.hidden) return;
    if (lastFrame) {
      const gap = at - lastFrame;
      frames++; frameTotal += gap; worstFrame = Math.max(worstFrame, gap);
      if (gap >= 50) slowFrames++;
      if (gap >= 100) record('frame-gap', { durationMs: gap, scrollY, recentScroll: at - lastScroll < 1000 });
    }
    lastFrame = at;
    if ((at < activeUntil || at - lastScroll < 500) && at - lastScrollSample >= 120) {
      record('scroll-sample', { scrollY, scrollX, events: scrollEvents });
      lastScrollSample = at; scrollEvents = 0;
    }
    frame = requestAnimationFrame(measureFrame);
  }
  function pulse() {
    const now = performance.now();
    record('performance-window', { elapsedMs: now - lastHeartbeat, visible: !document.hidden, frames, averageFrameMs: frames ? frameTotal / frames : null,
      worstFrameMs: worstFrame, slowFrames, scrollEvents, domChanges: changes, heapBytes: performance.memory?.usedJSHeapSize });
    lastHeartbeat = now; frames = 0; frameTotal = 0; worstFrame = 0; slowFrames = 0;
    changes = { batches: 0, added: 0, removed: 0, attributes: 0 };
  }
  function startMeasurements() {
    if (!heartbeat) heartbeat = setInterval(pulse, 1000);
    if (!frame && !document.hidden) frame = requestAnimationFrame(measureFrame);
  }
  function pauseMeasurements() { cancelAnimationFrame(frame); frame = 0; lastFrame = 0; clearInterval(heartbeat); heartbeat = 0; }
  listen(document, 'visibilitychange', () => {
    record('visibility', { visible: !document.hidden });
    pulse(); pauseMeasurements();
    if (!document.hidden) startMeasurements();
  });
  listen(window, 'pageshow', event => { record('pageshow', { persisted: event.persisted }); lastHeartbeat = performance.now(); startMeasurements(); });

  // === Browser-provided performance evidence ===
  function observe(type, summarize, options = {}) {
    if (!globalThis.PerformanceObserver?.supportedEntryTypes?.includes(type)) return;
    try {
      const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) record(type, summarize(entry)); });
      observer.observe({ type, buffered: true, ...options }); observers.push(observer);
    } catch (error) { record('observer-unavailable', { type, message: error.message }); }
  }
  observe('resource', entry => ({ url: safeUrl(entry.name), initiator: entry.initiatorType, startMs: entry.startTime, durationMs: entry.duration,
    requestStartMs: entry.requestStart, responseStartMs: entry.responseStart, responseEndMs: entry.responseEnd, transferBytes: entry.transferSize, bodyBytes: entry.decodedBodySize }));
  observe('navigation', entry => ({ type: entry.type, startMs: entry.startTime, responseStartMs: entry.responseStart, responseEndMs: entry.responseEnd,
    domInteractiveMs: entry.domInteractive, domContentLoadedMs: entry.domContentLoadedEventEnd, loadEndMs: entry.loadEventEnd, durationMs: entry.duration }));
  observe('longtask', entry => ({ startMs: entry.startTime, durationMs: entry.duration, attribution: Array.from(entry.attribution || [], item => ({ name: item.name, container: item.containerType, url: safeUrl(item.containerSrc || '') })) }));
  observe('long-animation-frame', entry => ({ startMs: entry.startTime, durationMs: entry.duration, blockingDurationMs: entry.blockingDuration,
    renderStartMs: entry.renderStart, styleAndLayoutStartMs: entry.styleAndLayoutStart, scripts: Array.from(entry.scripts || [], script => ({ url: safeUrl(script.sourceURL || ''),
      function: script.sourceFunctionName, invoker: script.invoker, startMs: script.startTime, durationMs: script.duration, forcedStyleAndLayoutMs: script.forcedStyleAndLayoutDuration })) }));
  observe('event', entry => ({ name: entry.name, target: targetName(entry.target), startMs: entry.startTime, durationMs: entry.duration,
    processingStartMs: entry.processingStart, processingEndMs: entry.processingEnd, interactionId: entry.interactionId }), { durationThreshold: 16 });
  observe('layout-shift', entry => ({ startMs: entry.startTime, value: entry.value, recentInput: entry.hadRecentInput }));
  observe('paint', entry => ({ name: entry.name, startMs: entry.startTime }));
  const mutations = new MutationObserver(records => {
    changes.batches++;
    for (const entry of records) { changes.added += entry.addedNodes.length; changes.removed += entry.removedNodes.length; if (entry.type === 'attributes') changes.attributes++; }
  });
  mutations.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'aria-busy', 'data-state'] });
  observers.push(mutations);
  listen(document, 'DOMContentLoaded', () => {
    record('dom-ready', { state: document.readyState });
    if (!globalThis.ResizeObserver) return;
    const resize = new ResizeObserver(entries => { for (const entry of entries) record('element-resize', { target: targetName(entry.target), width: entry.contentRect.width, height: entry.contentRect.height }); });
    for (const target of [document.querySelector('#productTable'), document.querySelector('.isi-table-region')]) if (target) resize.observe(target);
    observers.push(resize);
  });
  listen(window, 'load', () => record('page-loaded', { state: document.readyState }));
  listen(window, 'pagehide', event => {
    record('pagehide', { persisted: event.persisted }); pulse(); pauseMeasurements();
    if (event.persisted) return;
    stopped = true; events.abort(); observers.forEach(observer => observer.disconnect()); restorers.reverse().forEach(restore => restore());
  });
  startMeasurements();
})();
