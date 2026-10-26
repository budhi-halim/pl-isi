import { productionMap, productTags } from './logic.js';
import { fetchExchange } from '../assets/family/js/exchange-service.js';

const base = ['localhost', '127.0.0.1'].includes(location.hostname) ? location.origin : 'https://budhi-halim.github.io';

async function json(url, signal) {
  const response = await fetch(url, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('unavailable');
  return response.json();
}

export async function loadProducts(signal) {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(45000)]);
  const [products, production, tags, exchange, updated] = await Promise.all([
    json('data/products.json', requestSignal),
    json(`${base}/general-database/data/last_production.json`, requestSignal),
    json('data/product_tags.json', requestSignal),
    fetchExchange('today.json', requestSignal).catch(() => null),
    fetch('data/last_updated.txt', { signal: requestSignal, cache: 'no-store' }).then(response => response.ok ? response.text() : '').catch(() => '')
  ]);
  if (![products, production, tags].every(Array.isArray) || products.some(product => !product || typeof product !== 'object')) throw new Error('schema');
  const tagData = productTags(tags);
  const candidate = exchange?.tt_counter_selling_rate_buffered;
  return { products, lastProductionMap: productionMap(production), tagsMap: tagData.map, rawTagsList: tagData.rawList,
    rate: Number.isFinite(candidate) && candidate > 0 ? candidate : null, updated: updated.trim() };
}
