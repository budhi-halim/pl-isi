import { groupOffsets, mountedGroups, ROWS_PER_GROUP } from './list-layout.js';

/** Keep native row controls near the viewport, retaining a focused row until focus leaves it. */
export function createProductTable({ table, createRow }) {
  const events = new AbortController();
  const signal = events.signal;
  const region = table.parentElement;
  const groups = new Map();
  const measurements = new Map();
  let products = [], offsets = [0], frame = 0, destroyed = false;
  let regionWidth = 0;
  let layoutDirty = true;
  table.dataset.windowed = 'true';
  table.tHead.rows[0].setAttribute('aria-rowindex', '1');

  function schedule() {
    if (!destroyed && !document.hidden && !frame) frame = requestAnimationFrame(() => { frame = 0; update(); });
  }

  const observer = new ResizeObserver(entries => {
    let changed = false;
    for (const { target, contentRect } of entries) {
      if (target === region) {
        if (Math.abs(contentRect.width - regionWidth) > 0.5) { regionWidth = contentRect.width; changed = true; }
        continue;
      }
      const index = Number(target.dataset.group);
      if (groups.get(index) !== target || contentRect.height <= 0) continue;
      if (Math.abs(contentRect.height - (measurements.get(index) || offsets[index + 1] - offsets[index])) < 0.5) continue;
      measurements.set(index, contentRect.height); changed = true;
    }
    if (changed) { offsets = groupOffsets(products.length, measurements); layoutDirty = true; schedule(); }
  });
  observer.observe(region);

  function createGroup(index) {
    const body = document.createElement('tbody');
    body.dataset.group = index;
    const first = index * ROWS_PER_GROUP;
    for (let rowIndex = first; rowIndex < Math.min(first + ROWS_PER_GROUP, products.length); rowIndex++) {
      const row = createRow(products[rowIndex], rowIndex);
      row.setAttribute('aria-rowindex', String(rowIndex + 2));
      body.append(row);
    }
    groups.set(index, body);
    observer.observe(body);
    return body;
  }

  function spacer(height) {
    const body = document.createElement('tbody');
    body.className = 'product-table-spacer';
    body.setAttribute('aria-hidden', 'true');
    // A measured spacer preserves the document's native scroll range.
    body.style.setProperty('--spacer-height', `${height}px`);
    const row = body.insertRow();
    row.insertCell().colSpan = 4;
    return body;
  }

  function focusedGroup() {
    const row = document.activeElement?.closest('tr[data-row]');
    return row && table.contains(row) ? Math.floor(Number(row.dataset.row) / ROWS_PER_GROUP) : -1;
  }

  function update(extraGroup = -1) {
    if (destroyed) return;
    const top = -table.tHead.getBoundingClientRect().bottom;
    const required = mountedGroups(offsets, top, innerHeight, [focusedGroup(), extraGroup]);
    const requiredSet = new Set(required);
    const changed = required.length !== groups.size || required.some(index => !groups.has(index));
    if (!changed && !layoutDirty) return;
    layoutDirty = false;
    for (const [index, body] of groups) {
      if (requiredSet.has(index)) continue;
      observer.unobserve(body); body.remove(); groups.delete(index);
    }
    const children = [];
    let end = 0;
    for (const index of required) {
      if (offsets[index] > end) children.push(spacer(offsets[index] - end));
      children.push(groups.get(index) || createGroup(index));
      end = offsets[index + 1];
    }
    if (offsets.at(-1) > end) children.push(spacer(offsets.at(-1) - end));
    const retained = new Set(children);
    for (const body of [...table.tBodies]) if (!retained.has(body)) body.remove();
    // Surviving groups keep their DOM positions and focused controls.
    let cursor = table.tBodies[0] || null;
    for (const body of children) {
      if (body === cursor) cursor = cursor.nextElementSibling;
      else table.insertBefore(body, cursor);
    }
  }

  function setProducts(next) {
    for (const body of groups.values()) observer.unobserve(body);
    groups.clear(); measurements.clear(); products = next; layoutDirty = true;
    offsets = groupOffsets(products.length);
    for (const body of [...table.tBodies]) body.remove();
    table.setAttribute('aria-rowcount', String(products.length + 1));
    update();
  }

  table.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
    const control = event.target.closest('button[data-action]');
    const row = control?.closest('tr[data-row]');
    if (!row) return;
    const backwards = event.shiftKey;
    if (control.dataset.action !== (backwards ? 'details' : 'copy')) return;
    const next = Number(row.dataset.row) + (backwards ? -1 : 1);
    if (next < 0 || next >= products.length) return;
    const group = Math.floor(next / ROWS_PER_GROUP);
    if (groups.has(group)) return;
    event.preventDefault();
    update(group);
    const target = groups.get(group).querySelector(`[data-row="${next}"] [data-action="${backwards ? 'copy' : 'details'}"]`);
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }, { signal });
  table.addEventListener('focusin', schedule, { signal });
  table.addEventListener('focusout', schedule, { signal });
  document.addEventListener('scroll', schedule, { capture: true, passive: true, signal });
  window.addEventListener('resize', schedule, { passive: true, signal });
  window.addEventListener('pageshow', schedule, { signal });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(frame); frame = 0; }
    else schedule();
  }, { signal });

  return { setProducts, destroy() { destroyed = true; events.abort(); observer.disconnect(); cancelAnimationFrame(frame); groups.clear(); measurements.clear(); products = []; } };
}
