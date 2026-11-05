/** A list ranked by `order` and cut at its cap, with the full count kept. */
export type Ranked<T> = { readonly items: readonly T[]; readonly total: number };

/**
 * The best `cap` items of a stream, in memory bounded by about twice the cap whatever the stream's
 * length (plan P5): items pile up to that, then are sorted and cut. `cap` null keeps every item.
 */
export class BoundedTop<T> {
  #items: T[] = [];
  #total = 0;

  constructor(
    private readonly cap: number | null,
    private readonly order: (a: T, b: T) => number,
  ) {}

  push(item: T): void {
    this.#total++;
    this.#items.push(item);
    if (this.cap !== null && this.#items.length >= this.cap * 2 + 32) this.#cut();
  }

  ranked(): Ranked<T> {
    this.#cut();
    return { items: [...this.#items], total: this.#total };
  }

  #cut(): void {
    this.#items.sort(this.order);
    if (this.cap !== null) this.#items.length = Math.min(this.#items.length, this.cap);
  }
}

/** Code-unit order for paths, so a ranking never depends on the host's locale. */
export function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `items` ranked by `order`, then by path, and cut at `cap`. */
export function ranked<T extends { path: string }>(
  items: readonly T[],
  cap: number | null,
  order: (a: T, b: T) => number,
): Ranked<T> {
  const top = new BoundedTop<T>(cap, (a, b) => order(a, b) || byText(a.path, b.path));
  for (const item of items) top.push(item);
  return top.ranked();
}
