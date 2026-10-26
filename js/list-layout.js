export const ROWS_PER_GROUP = 24;
const ESTIMATED_ROW_HEIGHT = 54;

export function groupOffsets(rowCount, measurements = new Map()) {
  const offsets = [0];
  for (let first = 0; first < rowCount; first += ROWS_PER_GROUP) {
    const measured = measurements.get(offsets.length - 1);
    const height = Number.isFinite(measured) && measured > 0 ? measured : Math.min(ROWS_PER_GROUP, rowCount - first) * ESTIMATED_ROW_HEIGHT;
    offsets.push(offsets.at(-1) + height);
  }
  return offsets;
}

export function groupAtOffset(offsets, position) {
  let low = 0, high = Math.max(0, offsets.length - 2);
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (offsets[middle] <= position) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function mountedGroups(offsets, top, viewportHeight, pinned = []) {
  const count = offsets.length - 1;
  if (!count) return [];
  const buffer = Math.min(1000, Math.max(300, viewportHeight));
  const first = groupAtOffset(offsets, Math.max(0, top - buffer));
  const last = groupAtOffset(offsets, Math.max(0, top + viewportHeight + buffer));
  const groups = new Set(Array.from({ length: last - first + 1 }, (_, index) => first + index));
  for (const group of pinned) if (Number.isInteger(group) && group >= 0 && group < count) groups.add(group);
  return [...groups].sort((a, b) => a - b);
}
