import assert from 'node:assert/strict';
import test from 'node:test';
import { groupOffsets, groupAtOffset, mountedGroups, ROWS_PER_GROUP } from '../js/list-layout.js';

test('empty lists and partial final groups have accurate scroll ranges', () => {
  assert.deepEqual(groupOffsets(0), [0]);
  assert.deepEqual(mountedGroups([0], 100, 700), []);
  assert.deepEqual(groupOffsets(25), [0, 1296, 1350]);
  assert.deepEqual(groupOffsets(25, new Map([[0, 1440], [1, 80]])), [0, 1440, 1520]);
});

test('offset lookups clamp overscroll and choose the next group at a boundary', () => {
  const offsets = groupOffsets(100);
  assert.equal(groupAtOffset(offsets, -100), 0);
  assert.equal(groupAtOffset(offsets, 1295), 0);
  assert.equal(groupAtOffset(offsets, 1296), 1);
  assert.equal(groupAtOffset(offsets, 100000), 4);
});

test('scrolling a full catalog keeps a bounded, contiguous visible window', () => {
  const offsets = groupOffsets(6435);
  for (let top = 0; top <= offsets.at(-1); top += 500) {
    const groups = mountedGroups(offsets, top, 735);
    assert.ok(groups.length * ROWS_PER_GROUP <= 96);
    assert.ok(offsets[groups[0]] <= top);
    assert.ok(offsets[groups.at(-1) + 1] >= Math.min(offsets.at(-1), top + 735));
    assert.ok(groups.every((group, index) => index === 0 || group === groups[index - 1] + 1));
  }
});

test('focus pins only the relevant groups instead of mounting every intervening row', () => {
  const offsets = groupOffsets(6435);
  const visible = mountedGroups(offsets, 200000, 735);
  const pinned = mountedGroups(offsets, 200000, 735, [0, 0, -1, 999]);
  assert.deepEqual(pinned, [0, ...visible]);
});
