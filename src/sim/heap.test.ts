import { describe, expect, it } from 'vitest';
import { MinHeap } from './heap';

describe('MinHeap', () => {
  it('returns items in key order and grows past its initial capacity', () => {
    const heap = new MinHeap(2);
    [5, 1, 4, 2, 3, 0.5].forEach((key, item) => heap.push(item, key));
    const order: number[] = [];
    const keys: number[] = [];
    while (heap.size > 0) {
      order.push(heap.pop());
      keys.push(heap.lastKey);
    }
    expect(order).toEqual([5, 1, 3, 4, 2, 0]);
    expect(keys).toEqual([0.5, 1, 2, 3, 4, 5]);
  });
});
