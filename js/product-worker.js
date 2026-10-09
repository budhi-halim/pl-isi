import { filterProducts } from './logic.js';

let snapshot;
self.onmessage = ({ data: request }) => {
  if (request.type === 'initialize') snapshot = request.snapshot;
  if (!snapshot) return;
  try {
    const result = filterProducts(snapshot, request.filters);
    self.postMessage({ id: request.id, ...result });
  } catch { self.postMessage({ id: request.id, error: true }); }
};
