import { element, button } from '../assets/family/js/workspace.js';
import { createReadinessGate } from '../assets/family/js/readiness.js';
import { normalizeCode, displayPrice, formatProductionDate } from './logic.js';
import { loadProducts } from './data.js';
import { initializeBackTop } from '../assets/family/js/back-top.js';
import { createNotifications } from '../assets/family/js/notifications.js';
import { icon } from '../assets/family/js/icons.js';
import { createProductionPreview } from './production-preview.js';

const search = document.querySelector('#searchInput');
const priceToggle = document.querySelector('#togglePriceFilter');
const minimum = document.querySelector('#minPrice'), maximum = document.querySelector('#maxPrice');
const table = document.querySelector('#productTable');
const popup = document.querySelector('#production-popup');
let data = null;
let debounce = null;
let visibleProducts = [];
const copyTimers = new Map();
const notifications = createNotifications();
const backTop = initializeBackTop({ focusTarget: search });
let worker = null;
let requestId = 0;
let rendering = 0;
const copyIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 8.25V6A2.25 2.25 0 0 0 14.25 3.75H6A2.25 2.25 0 0 0 3.75 6v8.25A2.25 2.25 0 0 0 6 16.5h2.25m8.25-8.25H18A2.25 2.25 0 0 1 20.25 10.5V18A2.25 2.25 0 0 1 18 20.25h-7.5A2.25 2.25 0 0 1 8.25 18v-7.5a2.25 2.25 0 0 1 2.25-2.25h6Z"/></svg>';

const preview = createProductionPreview({ table, popup,
  busy: () => table.closest('.isi-table-region').getAttribute('aria-busy') === 'true',
  describe: row => {
    const product = visibleProducts[Number(row.dataset.row)];
    if (!product) return null;
    const last = data.lastProductionMap.get(normalizeCode(product.product_code || '').toLowerCase());
    return { date: formatProductionDate(last?.date), customer: last?.customer };
  }
});
const hidePopup = () => preview.dismiss();
const yieldToInput = () => globalThis.scheduler?.yield ? scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0));

function render() {
  if (!data) return;
  rendering++;
  table.closest('.isi-table-region').setAttribute('aria-busy', 'true');
  const filters = { query: search.value, enablePrice: priceToggle.checked, minimum: minimum.value, maximum: maximum.value };
  worker.postMessage({ type: 'query', id: ++requestId, filters });
}

async function renderResult(result) {
  const current = ++rendering;
  hidePopup(); for (const timer of copyTimers.values()) clearTimeout(timer); copyTimers.clear();
  visibleProducts = result.products;
  document.querySelector('#invalidQuery').hidden = !result.invalid;
  document.querySelector('#noResults').hidden = result.invalid || result.products.length > 0;
  document.querySelector('#result-count').textContent = `${result.products.length.toLocaleString()} products`;
  let removalStart = performance.now();
  for (const body of [...table.tBodies]) {
    body.remove();
    if (performance.now() - removalStart >= 8) {
      await yieldToInput();
      if (current !== rendering) return;
      removalStart = performance.now();
    }
  }
  let fragment = element('tbody');
  let sliceStart = performance.now();
  for (const [index, product] of result.products.entries()) {
    const row = element('tr'); row.dataset.row = index;
    row.append(element('td', index + 1));
    const name = element('td'), nameContent = element('div', undefined, 'product-name-content');
    const details = button(product.product_name || 'Unnamed product', null, 'product-name');
    details.dataset.action = 'details';
    details.setAttribute('aria-label', `${product.product_name || 'Product'} — last production`);
    nameContent.append(details);
    const codeKey = normalizeCode(product.product_code || '').toLowerCase();
    for (const tag of data.tagsMap.get(codeKey) || []) {
      const badge = element('span', tag.icon, 'tag-badge'); badge.setAttribute('aria-label', tag.tag); nameContent.append(badge);
    }
    name.append(nameContent);
    const code = element('td'), codeContent = element('div', undefined, 'product-code');
    const copy = button('', null, 'isi-button isi-button--icon isi-button--quiet');
    copy.dataset.action = 'copy';
    copy.innerHTML = copyIcon; copy.setAttribute('aria-label', 'Copy product code');
    codeContent.append(element('span', product.product_code || ''), copy); code.append(codeContent);
    row.append(name, code, element('td', displayPrice(product.marketing_price, data.rate))); fragment.append(row);
    if ((index + 1) % 32 === 0 || index === result.products.length - 1) {
      table.append(fragment); fragment = element('tbody');
    }
    // Cooperatively build the complete searchable table without one long input-blocking task.
    if (performance.now() - sliceStart >= 8 || index === result.products.length - 1) {
      await yieldToInput();
      if (current !== rendering) return;
      sliceStart = performance.now();
    }
  }
  table.closest('.isi-table-region').setAttribute('aria-busy', 'false');
}

function schedule() { rendering++; requestId++; clearTimeout(debounce); debounce = setTimeout(render, 180); }
search.addEventListener('input', schedule);
minimum.addEventListener('input', schedule); maximum.addEventListener('input', schedule);
priceToggle.addEventListener('change', () => { document.querySelector('#priceRange').hidden = !priceToggle.checked; render(); });
document.querySelector('#reset-filters').addEventListener('click', () => {
  clearTimeout(debounce); search.value = ''; minimum.value = ''; maximum.value = ''; priceToggle.checked = false;
  document.querySelector('#priceRange').hidden = true; render(); search.focus();
});
table.addEventListener('click', async event => {
  if (table.closest('.isi-table-region').getAttribute('aria-busy') === 'true') return;
  const row = event.target.closest('tr[data-row]'); if (!row) return;
  const product = visibleProducts[Number(row.dataset.row)];
  const copy = event.target.closest('[data-action="copy"]');
  if (copy) {
    try {
      await navigator.clipboard.writeText(String(product.product_code || ''));
      if (!copy.isConnected) return;
      clearTimeout(copyTimers.get(copy)); copy.innerHTML = icon('check'); copy.setAttribute('aria-label', 'Copied');
      copyTimers.set(copy, setTimeout(() => { copy.innerHTML = copyIcon; copy.setAttribute('aria-label', 'Copy product code'); copyTimers.delete(copy); }, 1500));
    } catch { notifications.show('Unable to copy. Select the product code and copy it manually.', { key: 'copy-error', tone: 'error' }); }
    return;
  }
  preview.open(row, event);
});
table.addEventListener('contextmenu', event => {
  const row = event.target.closest('tr[data-row]'); if (!row) return;
  event.preventDefault(); preview.open(row, event);
});

const gate = createReadinessGate({ host: document.querySelector('#loading-host'), content: document.querySelector('#workspace-content'),
  logoUrl: 'assets/family/assets/icons/family.svg', load: loadProducts,
  onReady: async result => {
    data = result; document.querySelector('#lastUpdated').textContent = `Last updated: ${formatProductionDate(data.updated) || 'Not available'}`;
    worker?.terminate(); worker = new Worker(new URL('./product-worker.js', import.meta.url), { type: 'module' });
    const fail = () => { table.closest('.isi-table-region').setAttribute('aria-busy', 'false'); notifications.show('Products could not be displayed. Reload the page to try again.', { key: 'products-error', tone: 'error' }); };
    document.querySelector('#rate-warning').hidden = Boolean(data.rate);
    await new Promise((resolve, reject) => {
      let initializing = true;
      const failed = () => { if (initializing) { initializing = false; reject(new Error('products')); } else fail(); };
      worker.onmessage = async ({ data: response }) => {
        if (response.id !== requestId) return;
        if (response.error) { failed(); return; }
        try {
          await renderResult({ invalid: response.invalid, products: Array.from(response.indices, index => data.products[index]) });
          if (initializing) { initializing = false; resolve(); }
        } catch { failed(); }
      };
      worker.onerror = failed;
      worker.postMessage({ type: 'initialize', snapshot: data, id: ++requestId, filters: { query: search.value, enablePrice: priceToggle.checked, minimum: minimum.value, maximum: maximum.value } });
    });
  }
});
gate.start();
window.addEventListener('pagehide', event => { hidePopup(); clearTimeout(debounce); for (const timer of copyTimers.values()) clearTimeout(timer); notifications.clear(); if (!event.persisted) { backTop.destroy(); preview.destroy(); rendering++; requestId++; worker?.terminate(); } });
