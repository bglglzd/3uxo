/** Copy legacy preferences once, retaining originals for rollback. */
export function migrateStorage(storage: Storage): void {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  for (const key of keys) {
    if (!key?.startsWith("3uxo.")) continue;
    const next = `auris.${key.slice(5)}`;
    if (storage.getItem(next) === null) {
      const value = storage.getItem(key);
      if (value !== null) storage.setItem(next, value);
    }
  }
}
