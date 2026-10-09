import { element } from '../assets/family/js/workspace.js';
import { createRowHover, positionHover, fadeHover } from '../assets/family/js/row-hover.js';

export function createProductionPreview({ table, popup, describe, busy }) {
  const events = new AbortController();
  let pinnedRow = null;
  let described = null;
  popup.classList.add('isi-row-hover');
  popup.setAttribute('role', 'tooltip');
  function clearDescription() {
    described?.removeAttribute('aria-describedby');
    described = null;
  }
  function hide() {
    clearDescription();
    fadeHover(popup, false);
  }
  function show(row, point) {
    if (!row?.isConnected || busy()) return;
    const content = describe(row);
    if (!content) return;
    clearDescription();
    popup.replaceChildren(element('h2', 'Last production'), element('p', content.date || 'No data'));
    if (content.customer) popup.append(element('p', content.customer, 'isi-muted'));
    described = row.querySelector('.product-name');
    described?.setAttribute('aria-describedby', popup.id);
    fadeHover(popup, true);
    positionHover(popup, point);
  }
  const hover = createRowHover({ root: table, resolveRow: hit => hit.closest('tr[data-row]'), show, hide,
    move: point => { if (!popup.hidden) positionHover(popup, point); }, disabled: () => Boolean(pinnedRow) || busy() });
  function dismiss() { pinnedRow = null; hover.dismiss(); }
  function open(row, event) {
    if (busy() || !row?.isConnected) return;
    if (pinnedRow === row) { dismiss(); return; }
    hover.dismiss();
    pinnedRow = row;
    const bounds = event.detail === 0 && event.clientX === 0 && event.clientY === 0 ? (event.target.closest('button') || row).getBoundingClientRect() : null;
    show(row, bounds ? { x: bounds.left + bounds.width / 2, y: bounds.bottom } : { x: event.clientX, y: event.clientY });
  }
  const signal = events.signal;
  document.addEventListener('pointerdown', event => { if (!table.contains(event.target)) dismiss(); }, { passive: true, signal });
  document.addEventListener('scroll', () => { if (pinnedRow) dismiss(); }, { capture: true, passive: true, signal });
  document.addEventListener('keydown', dismiss, { signal });
  window.addEventListener('resize', () => { if (pinnedRow) dismiss(); }, { passive: true, signal });
  window.addEventListener('blur', dismiss, { signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) dismiss(); }, { signal });
  return { open, dismiss, destroy() { events.abort(); hover.destroy(); pinnedRow = null; clearDescription(); } };
}
