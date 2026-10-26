import assert from 'node:assert/strict';
import test from 'node:test';
import { canSortPrices, filterProducts, sortProductsByPrice } from '../js/logic.js';

const products = [
  { product_code: 'USD10', product_name: 'Seasoning', marketing_price: '10' },
  { product_code: 'BLANK', product_name: 'Seasoning', marketing_price: '' },
  { product_code: 'IDR5', product_name: 'Seasoning', marketing_price: '100000' },
  { product_code: 'ZERO', product_name: 'Seasoning', marketing_price: '0' },
  { product_code: 'IDR10', product_name: 'Seasoning', marketing_price: '200000' },
  { product_code: 'USD15', product_name: 'Seasoning', marketing_price: '15' }
];
const codes = items => items.map(item => item.product_code);
const snapshot = { products, rate: 20000, lastProductionMap: new Map(), tagsMap: new Map(), rawTagsList: [] };

test('ascending compares USD and IDR, treating blank prices as zero', () => {
  assert.deepEqual(codes(sortProductsByPrice(products, 'ascending', 20000)), ['BLANK', 'ZERO', 'IDR5', 'USD10', 'IDR10', 'USD15']);
});

test('descending retains source order for ties instead of reversing them', () => {
  assert.deepEqual(codes(sortProductsByPrice(products, 'descending', 20000)), ['USD15', 'USD10', 'IDR10', 'IDR5', 'BLANK', 'ZERO']);
});

test('off preserves the input order and sorting never mutates the input', () => {
  const original = structuredClone(products);
  sortProductsByPrice(products, 'ascending', 20000);
  sortProductsByPrice(products, 'descending', 20000);
  assert.deepEqual(products, original);
  assert.equal(sortProductsByPrice(products, 'off', 20000), products);
});

test('sorting uses unrounded amounts', () => {
  const items = [{ product_code: 'HIGH', marketing_price: '100001' }, { product_code: 'LOW', marketing_price: '5' }];
  assert.deepEqual(codes(sortProductsByPrice(items, 'ascending', 20000)), ['LOW', 'HIGH']);
});

test('mixed currencies cannot be sorted without a usable exchange rate', () => {
  for (const rate of [null, undefined, 0, -1, NaN, Infinity]) {
    assert.equal(canSortPrices(products, rate), false);
    assert.equal(sortProductsByPrice(products, 'ascending', rate), products);
  }
  const usdOnly = products.filter(product => !product.product_code.startsWith('IDR'));
  assert.equal(canSortPrices(usdOnly, null), true);
  assert.deepEqual(codes(sortProductsByPrice(usdOnly, 'ascending', null)), ['BLANK', 'ZERO', 'USD10', 'USD15']);
});

test('filtering and price sorting compose without changing tie order', () => {
  assert.deepEqual(codes(filterProducts(snapshot, { enablePrice: true, minimum: '5', maximum: '10', priceOrder: 'descending' }).products), ['USD10', 'IDR10', 'IDR5']);
  assert.deepEqual(codes(filterProducts(snapshot, { query: 'IDR', priceOrder: 'descending' }).products), ['IDR10', 'IDR5']);
  assert.deepEqual(filterProducts(snapshot, { enablePrice: true, maximum: '0' }).products, []);
  assert.deepEqual(codes(filterProducts(snapshot).products), codes(products));
});
