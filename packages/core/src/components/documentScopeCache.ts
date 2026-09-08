/** Synchronous scope identity without owning abandoned render allocations.
 * Mounted consumers and pending renders keep their scopes alive. The cache
 * only observes them; otherwise a render that never commits cannot run the
 * registration cleanup needed to release a strongly cached scope.
 */
export function createDocumentScopeCache<T extends object>(create: (onEmpty: () => void) => T) {
  const entries = new Map<string, WeakRef<T>>();
  const collected = new FinalizationRegistry<{ id: string; ref: WeakRef<T> }>(({ id, ref }) => {
    // Collection can arrive after onEmpty and a new allocation of this id.
    if (entries.get(id) === ref) entries.delete(id);
  });
  return {
    get(id: string): T {
      const existing = entries.get(id)?.deref();
      if (existing) return existing;
      const scope = create(() => {
        if (entries.get(id) === ref) entries.delete(id);
        collected.unregister(ref);
      });
      const ref = new WeakRef(scope);
      entries.set(id, ref);
      // Holdings must never contain scope: that would keep the target alive.
      collected.register(scope, { id, ref }, ref);
      return scope;
    },
  };
}
