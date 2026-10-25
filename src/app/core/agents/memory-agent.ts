/**
 * MemoryAgent - Agent that provides a simple in‑memory store for
 * persisting context, state, or cached data across agent invocations
 * within the same session. In a browser‑based Angular app this could
 * be backed by localStorage or sessionStorage; here we use a plain
 * class field for simplicity.
 *
 * The agent supports storing key‑value pairs, retrieving by key,
 * and clearing the store. It can be used by the planner or other
 * agents to maintain conversation history, configuration snapshots,
 * or any transient data that should outlive a single function call.
 */
export class MemoryAgent {
  private store: Map<string, unknown> = new Map();

  /** Store a value under the given key. */
  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  /** Retrieve the value for a key, or undefined if not found. */
  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  /** Check whether a key exists in the store. */
  has(key: string): boolean {
    return this.store.has(key);
  }

  /** Remove a key from the store. */
  delete(key: string): void {
    this.store.delete(key);
  }

  /** Clear the entire store. */
  clear(): void {
    this.store.clear();
  }

  /** Get all stored keys. */
  keys(): string[] {
    return Array.from(this.store.keys());
  }

  /** Get a shallow copy of all stored entries. */
  getAll(): Map<string, unknown> {
    return new Map(this.store);
  }

  /** Persist the current store to browser localStorage (if available). */
  persistToLocalStorage(): void {
    if (typeof window !== 'undefined') {
      try {
        const serializable: Record<string, unknown> = {};
        this.store.forEach((value, key) => {
          try {
            serializable[key] = JSON.stringify(value);
          } catch {
            serializable[key] = String(value);
          }
        });
        localStorage.setItem('memory-agent-store', JSON.stringify(serializable));
      } catch (e) {
        console.warn('Could not persist MemoryAgent to localStorage', e);
      }
    }
  }

  /** Load the store from browser localStorage (if available). */
  loadFromLocalStorage(): void {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('memory-agent-store');
        if (raw) {
          const parsed: Record<string, unknown> = JSON.parse(raw);
          this.store = new Map(Object.entries(parsed).map(([k, v]) => [k, JSON.parse(String(v))]));
        }
      } catch (e) {
        console.warn('Could not load MemoryAgent from localStorage', e);
      }
    }
  }
}