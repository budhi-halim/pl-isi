import { element, button } from '../assets/family/js/workspace.js';
import { createReadinessGate } from '../assets/family/js/readiness.js';
import { normalizeCode, displayPrice, formatProductionDate, canSortPrices } from './logic.js';
import { loadProducts } from './data.js';
import { initializeBackTop } from '../assets/family/js/back-top.js';
import { createNotifications } from '../assets/family/js/notifications.js';
import { icon } from '../assets/family/js/icons.js';
import { createProductionPreview } from './production-preview.js';
import { recordDiagnostic } from './diagnostics-client.js';
import { createProductTable } from './product-table.js';

const search = document.querySelector('#searchInput');
const priceToggle = document.querySelector('#togglePriceFilter');
const priceSort = document.querySelector('#price-sort');
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
let priceOrder = 'off';
const PRICE_ORDERS = ['off', 'ascending', 'descending'];
const PRICE_ORDER_LABELS = { off: 'Off', ascending: 'Low to high', descending: 'High to low' };
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
const productTable = createProductTable({ table, createRow: createProductRow });

function readFilters() {
  return { query: search.value, enablePrice: priceToggle.getAttribute('aria-checked') === 'true', minimum: minimum.value, maximum: maximum.value, priceOrder };
}

function updatePriceOrder(order) {
  priceOrder = order;
  priceSort.dataset.order = order;
  priceSort.querySelector('span').textContent = `Price: ${PRICE_ORDER_LABELS[order]}`;
  const next = PRICE_ORDERS[(PRICE_ORDERS.indexOf(order) + 1) % PRICE_ORDERS.length];
  priceSort.setAttribute('aria-label', `Sort by price in USD: ${PRICE_ORDER_LABELS[order].toLowerCase()}. Activate for ${next === 'off' ? 'original order' : `${next} price`}.`);
  document.querySelector('#price-column').setAttribute('aria-sort', order === 'off' ? 'none' : order);
}

function render() {
  if (!data) return;
  rendering++;
  table.closest('.isi-table-region').setAttribute('aria-busy', 'true');
  const filters = readFilters();
  const id = ++requestId;
  recordDiagnostic('worker-query', { id, queryLength: filters.query.length, enablePrice: filters.enablePrice, minimum: filters.minimum, maximum: filters.maximum, priceOrder });
  worker.postMessage({ type: 'query', id, filters });
}

function renderResult(result) {
  const current = ++rendering;
  const started = performance.now();
  recordDiagnostic('render-start', { generation: current, count: result.products.length, invalid: result.invalid });
  hidePopup(); for (const timer of copyTimers.values()) clearTimeout(timer); copyTimers.clear();
  visibleProducts = result.products;
  document.querySelector('#invalidQuery').hidden = !result.invalid;
  document.querySelector('#noResults').hidden = result.invalid || result.products.length > 0;
  document.querySelector('#result-count').textContent = `${result.products.length.toLocaleString()} products`;
  const viewStats = productTable.setProducts(visibleProducts);
  table.closest('.isi-table-region').setAttribute('aria-busy', 'false');
  recordDiagnostic('render-complete', { generation: current, count: result.products.length, durationMs: performance.now() - started, ...viewStats });
}

function createProductRow(product, index) {
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
  row.append(name, code, element('td', displayPrice(product.marketing_price, data.rate)));
  return row;
}

function schedule() { rendering++; requestId++; clearTimeout(debounce); recordDiagnostic('filter-scheduled', { queryLength: search.value.length }); debounce = setTimeout(render, 180); }
search.addEventListener('input', schedule);
minimum.addEventListener('input', schedule); maximum.addEventListener('input', schedule);
priceToggle.addEventListener('click', () => {
  const enabled = priceToggle.getAttribute('aria-checked') !== 'true';
  priceToggle.setAttribute('aria-checked', String(enabled));
  document.querySelector('#priceRange').hidden = !enabled;
  clearTimeout(debounce); render();
});
priceSort.addEventListener('click', () => {
  if (!data || priceSort.disabled) return;
  updatePriceOrder(PRICE_ORDERS[(PRICE_ORDERS.indexOf(priceOrder) + 1) % PRICE_ORDERS.length]);
  clearTimeout(debounce); render();
});
document.querySelector('#reset-filters').addEventListener('click', () => {
  clearTimeout(debounce); search.value = ''; minimum.value = ''; maximum.value = ''; priceToggle.setAttribute('aria-checked', 'false'); updatePriceOrder('off');
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
  recordDiagnostic('production-preview', { row: Number(row.dataset.row), input: event.pointerType || 'keyboard' });
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
    const fail = () => { recordDiagnostic('products-failed'); table.closest('.isi-table-region').setAttribute('aria-busy', 'false'); notifications.show('Products could not be displayed. Reload the page to try again.', { key: 'products-error', tone: 'error' }); };
    document.querySelector('#rate-warning').hidden = Boolean(data.rate);
    priceSort.disabled = !canSortPrices(data.products, data.rate);
    if (priceSort.disabled) { updatePriceOrder('off'); priceSort.setAttribute('aria-describedby', 'rate-warning'); }
    else priceSort.removeAttribute('aria-describedby');
    await new Promise((resolve, reject) => {
      let initializing = true;
      const failed = () => { if (initializing) { initializing = false; reject(new Error('products')); } else fail(); };
      worker.onmessage = async ({ data: response }) => {
        recordDiagnostic('worker-result', { id: response.id, currentId: requestId, count: response.indices?.length, durationMs: response.durationMs, error: response.error, invalid: response.invalid });
        if (response.id !== requestId) { recordDiagnostic('worker-result-discarded', { id: response.id }); return; }
        if (response.error) { failed(); return; }
        try {
          await renderResult({ invalid: response.invalid, products: Array.from(response.indices, index => data.products[index]) });
          if (initializing) { initializing = false; resolve(); }
        } catch { failed(); }
      };
      worker.onerror = event => { recordDiagnostic('worker-error', { message: event.message, filename: event.filename, line: event.lineno }); failed(); };
      recordDiagnostic('worker-initialize', { id: requestId + 1, count: data.products.length, rate: data.rate });
      worker.postMessage({ type: 'initialize', snapshot: data, id: ++requestId, filters: readFilters() });
    });
  }
});
recordDiagnostic('application-start');
gate.start().then(ready => recordDiagnostic('application-ready', { ready }));
window.addEventListener('pagehide', event => { hidePopup(); clearTimeout(debounce); for (const timer of copyTimers.values()) clearTimeout(timer); notifications.clear(); if (!event.persisted) { backTop.destroy(); preview.destroy(); productTable.destroy(); rendering++; requestId++; worker?.terminate(); } });
