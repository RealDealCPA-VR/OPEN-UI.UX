import Store from 'electron-store';

// Wraps `new Store(options)` so construction happens on first property access,
// not at module load.
//
// Why: electron-store defers to `conf` for path resolution, which requires
// either `app.getPath('userData')` (Electron) or an explicit `projectName`. In
// a plain-Node context (vitest, scripts), instantiating at module top-level
// throws `Please specify the projectName option` — which is what breaks any
// test that transitively imports `storage/settings.ts` or `routing/routing-
// store.ts` from outside Electron.
//
// The Proxy preserves the API surface of the underlying Store (e.g.
// `settingsStore.store`, `settingsStore.onDidChange(...)`, `set`, `get`)
// without callers having to switch to a `getStore()` function — that would
// ripple through every consumer in the main process.

export function lazyElectronStore<T extends Record<string, unknown>>(
  options: ConstructorParameters<typeof Store<T>>[0],
): Store<T> {
  let inst: Store<T> | null = null;
  const get = (): Store<T> => {
    if (!inst) inst = new Store<T>(options);
    return inst;
  };
  return new Proxy({} as Store<T>, {
    get(_t, prop): unknown {
      const target = get() as unknown as Record<PropertyKey, unknown>;
      const value = target[prop];
      return typeof value === 'function' ? value.bind(get()) : value;
    },
    set(_t, prop, value): boolean {
      const target = get() as unknown as Record<PropertyKey, unknown>;
      target[prop] = value;
      return true;
    },
    has(_t, prop): boolean {
      return prop in (get() as unknown as Record<PropertyKey, unknown>);
    },
  });
}
