import { ParseError, searchStrings } from './advanced_search.js';

export function normalizeCode(code) {
  if (!code && code !== 0) return '';
  return code.toString().replace(/^\*/, '').trim().replace(/\s+/g, ' ');
}

export function productionMap(records) {
  const map = new Map();
  for (const item of records) {
    const key = normalizeCode(item.product_code || '').toLowerCase();
    if (!key) continue;
    const existing = map.get(key);
    if (!existing || (Date.parse(item.date || '') || 0) >= (Date.parse(existing.date || '') || 0)) map.set(key, item);
  }
  return map;
}

export function productTags(groups) {
  const map = new Map();
  for (const { tag, icon, products } of groups) for (const value of products) {
    const code = normalizeCode(value).toLowerCase();
    if (!map.has(code)) map.set(code, []);
    map.get(code).push({ tag, icon });
  }
  return { map, rawList: [...groups.map(group => group.tag.toLowerCase()), 'ordered'] };
}

/** Ordered uses precisely the same availability rule as the production detail. */
export function isOrdered(last) { return Boolean(last?.date || last?.customer); }

export function filterProducts({ products, rate, lastProductionMap, tagsMap, rawTagsList }, { query = '', enablePrice = false, minimum = '', maximum = '' }) {
  const prefixes = Array.from(query.matchAll(/(?:^|\s)#([a-zA-Z0-9]+)/g), match => match[1].toLowerCase());
  const resolvedTags = [];
  for (const prefix of prefixes) {
    const matches = rawTagsList.filter(tag => tag.startsWith(prefix));
    if (matches.length !== 1) return { products: [], invalid: true };
    resolvedTags.push(matches[0]);
  }
  const cleanQuery = query.replace(/(?:^|\s)#[a-zA-Z0-9]+/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
  const min = parseFloat(minimum) || 0;
  const max = parseFloat(maximum) || Infinity;
  const inputs = [];
  if (String(minimum).trim() !== '') inputs.push(min);
  if (String(maximum).trim() !== '') inputs.push(max);
  const searchUnit = inputs.length ? (Math.max(...inputs) >= 1000 ? 'IDR' : 'USD') : null;
  try {
    return { invalid: false, products: products.filter(product => {
      const code = normalizeCode(product.product_code || '').toLowerCase();
      const tags = (tagsMap.get(code) || []).map(tag => tag.tag.toLowerCase());
      if (isOrdered(lastProductionMap.get(code))) tags.push('ordered');
      if (!resolvedTags.every(tag => tags.includes(tag))) return false;
      if (cleanQuery && !searchStrings(cleanQuery, [`${product.product_name || ''} ${product.product_code || ''}`.trim()]).length) return false;
      const price = parseFloat(product.marketing_price) || 0;
      if (enablePrice && (product.marketing_price === '' || price === 0)) return false;
      if (!enablePrice) return true;
      if (!rate) return price >= min && price <= max;
      const isUSD = price < 1000;
      const value = searchUnit === 'USD' ? (isUSD ? price : price / rate) : (isUSD ? price * rate : price);
      return value >= min && value <= max;
    }) };
  } catch (error) {
    if (error instanceof ParseError) return { products: [], invalid: true };
    throw error;
  }
}

export function formatWithCommas(value) {
  const parts = String(value).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

export function displayPrice(value, rate) {
  const price = parseFloat(value);
  if (!Number.isNaN(price) && price > 0 && rate) {
    const converted = price < 1000 ? Math.ceil(price * rate / 1000) * 1000 : Math.ceil(price / rate * 10) / 10;
    return `${formatWithCommas(price)} (${formatWithCommas(converted)})`;
  }
  return formatWithCommas(value || '');
}

export function formatProductionDate(value) {
  if (!value) return '';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${parseInt(match[3])} ${months[parseInt(match[2]) - 1]} ${parseInt(match[1])}`;
}
