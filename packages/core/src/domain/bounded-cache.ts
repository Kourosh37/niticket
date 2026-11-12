/** Expiring LRU with explicit entry and byte budgets. Values are owned by callers. */
export class BoundedCache<T> {
  private entries = new Map<string, { value: T; expires: number; size: number; tags: string[] }>();
  private bytes = 0;
  constructor(
    private limits: { entries: number; bytes: number },
    private now = Date.now,
  ) {}

  get(key: string): T | undefined {
    const item = this.entries.get(key);
    if (!item) return;
    if (item.expires <= this.now()) {
      this.delete(key);
      return;
    }
    this.entries.delete(key);
    this.entries.set(key, item);
    return item.value;
  }

  set(key: string, value: T, ttl: number, size: number, tags: string[] = []) {
    this.delete(key);
    if (ttl <= 0 || size > this.limits.bytes || size < 0) return;
    this.entries.set(key, { value, expires: this.now() + ttl, size, tags });
    this.bytes += size;
    while (this.entries.size > this.limits.entries || this.bytes > this.limits.bytes)
      this.delete(this.entries.keys().next().value!);
  }

  delete(key: string) {
    const item = this.entries.get(key);
    if (item) {
      this.bytes -= item.size;
      this.entries.delete(key);
    }
  }

  invalidate(tags: readonly string[]) {
    for (const [key, item] of this.entries)
      if (item.tags.some((tag) => tags.includes(tag))) this.delete(key);
  }

  clear() {
    this.entries.clear();
    this.bytes = 0;
  }

  get size() {
    return this.entries.size;
  }
  get byteSize() {
    return this.bytes;
  }
}
