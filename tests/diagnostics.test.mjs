import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../js/diagnostics-early.js', import.meta.url), 'utf8');

function createRecorder() {
  const listeners = new Map();
  const frames = new Map();
  const timers = new Map();
  const intervals = new Map();
  const observers = new Map();
  let now = 0, identifier = 0, geometryReads = 0;
  const surface = name => ({ addEventListener(type, callback) { listeners.set(`${name}:${type}`, callback); } });
  class Element {
    closest() { return null; }
    focus() {}
  }
  class PerformanceObserver {
    static supportedEntryTypes = ['event'];
    constructor(callback) { this.callback = callback; }
    observe({ type }) { observers.set(type, this.callback); }
    disconnect() {}
  }
  const document = { ...surface('document'), hidden: false, readyState: 'loading', documentElement: {}, querySelector: () => null };
  const context = vm.createContext({
    ...surface('window'), document, Element, HTMLElement: Element, PerformanceObserver,
    MutationObserver: class { observe() {} disconnect() {} },
    AbortController, URL, Request, console: { ...console },
    performance: { now: () => now, timeOrigin: 0 },
    location: { origin: 'https://example.test', pathname: '/pl-isi-log.html', href: 'https://example.test/pl-isi-log.html' },
    navigator: {}, CSS: { supports: () => true }, matchMedia: () => ({ matches: false }),
    innerWidth: 392, innerHeight: 735, devicePixelRatio: 2.75,
    requestAnimationFrame(callback) { frames.set(++identifier, callback); return identifier; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback) { timers.set(++identifier, callback); return identifier; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback) { intervals.set(++identifier, callback); return identifier; },
    clearInterval(id) { intervals.delete(id); }
  });
  context.window = context;
  Object.defineProperties(context, {
    scrollY: { get() { geometryReads++; return 250; } },
    scrollX: { get() { geometryReads++; return 0; } }
  });
  vm.runInContext(source, context);
  return {
    snapshot: () => context.plIsiDiagnostics.snapshot(),
    reads: () => geometryReads,
    event(target, type, details = {}) { listeners.get(`${target}:${type}`)?.({ type, timeStamp: now, ...details }); },
    frame(at) { now = at; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(at)); },
    flush() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); },
    pulse() { intervals.forEach(callback => callback()); },
    observe(type, entries) { observers.get(type)({ getEntries: () => entries }); }
  };
}

test('frame gaps and input recording do not force scroll geometry reads', () => {
  const recorder = createRecorder();
  recorder.frame(16);
  recorder.frame(200);
  recorder.event('document', 'pointerdown');
  assert.equal(recorder.reads(), 0);
  assert.ok(recorder.snapshot().events.some(entry => entry.event === 'frame-gap' && entry.durationMs === 184));
});

test('scroll geometry is coalesced after a paint opportunity and carries its sample time', () => {
  const recorder = createRecorder();
  recorder.event('document', 'scroll');
  recorder.event('document', 'scroll');
  recorder.frame(150);
  assert.equal(recorder.reads(), 0);
  recorder.flush();
  assert.equal(recorder.reads(), 2);
  recorder.event('document', 'pointerdown');
  const input = recorder.snapshot().events.find(entry => entry.event === 'input');
  assert.equal(input.scrollY, 250);
  assert.equal(input.scrollPositionAtMs, 150);
  recorder.pulse();
  const pulse = recorder.snapshot().events.find(entry => entry.event === 'performance-window');
  assert.equal(pulse.scrollEvents, 2, 'Frame sampling must not reset the whole performance window');
});

test('ancestor pointer events retain aggregate delays without duplicating individual records', () => {
  const recorder = createRecorder();
  const base = { startTime: 1, duration: 2500, processingStart: 2499, processingEnd: 2499, interactionId: 0 };
  recorder.observe('event', [...Array.from({ length: 10 }, () => ({ ...base, name: 'pointerenter' })), { ...base, name: 'pointerdown' }]);
  recorder.pulse();
  const events = recorder.snapshot().events;
  assert.equal(events.filter(entry => entry.event === 'event').length, 1);
  const summary = events.find(entry => entry.event === 'performance-window').passiveEvents.pointerenter;
  assert.equal(summary.count, 10);
  assert.equal(summary.worstDispatchDelayMs, 2498);
  assert.equal(summary.worstDurationMs, 2500);
});

test('leaving the page cancels queued geometry work', () => {
  const recorder = createRecorder();
  recorder.event('document', 'scroll');
  recorder.frame(16);
  recorder.event('window', 'pagehide', { persisted: false });
  recorder.flush();
  recorder.frame(200);
  assert.equal(recorder.reads(), 0);
});
