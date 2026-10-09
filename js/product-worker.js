import { filterProducts } from './logic.js';

let snapshot;
let indices;
self.onmessage = ({ data: request }) => {
  if (request.type === 'initialize') {
    snapshot = request.snapshot;
    indices = new Map(snapshot.products.map((product, index) => [product, index]));
  }
  if (!snapshot) return;
  try {
    const result = filterProducts(snapshot, request.filters);
    const matches = Uint32Array.from(result.products, product => indices.get(product));
    self.postMessage({ id: request.id, invalid: result.invalid, indices: matches }, [matches.buffer]);
  } catch { self.postMessage({ id: request.id, error: true }); }
};
