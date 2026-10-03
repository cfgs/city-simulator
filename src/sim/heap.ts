/** Binär min-heap över heltal med flyttalsnycklar. Allokerar bara när den behöver växa. */
export class MinHeap {
  private items: Int32Array;
  private keys: Float64Array;
  size = 0;
  /** Nyckeln för det senast uttagna elementet. */
  lastKey = 0;

  constructor(capacity = 1024) {
    this.items = new Int32Array(capacity);
    this.keys = new Float64Array(capacity);
  }

  clear(): void {
    this.size = 0;
  }

  push(item: number, key: number): void {
    if (this.size === this.items.length) this.grow();
    const items = this.items;
    const keys = this.keys;
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      items[i] = items[parent];
      keys[i] = keys[parent];
      i = parent;
    }
    items[i] = item;
    keys[i] = key;
  }

  pop(): number {
    const items = this.items;
    const keys = this.keys;
    const top = items[0];
    this.lastKey = keys[0];
    const n = --this.size;
    if (n > 0) {
      const item = items[n];
      const key = keys[n];
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && keys[child + 1] < keys[child]) child++;
        if (keys[child] >= key) break;
        items[i] = items[child];
        keys[i] = keys[child];
        i = child;
      }
      items[i] = item;
      keys[i] = key;
    }
    return top;
  }

  private grow(): void {
    const items = new Int32Array(this.items.length * 2);
    const keys = new Float64Array(this.keys.length * 2);
    items.set(this.items);
    keys.set(this.keys);
    this.items = items;
    this.keys = keys;
  }
}
