import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

/**
 * Stockage de repli utilisé pendant le rendu serveur (SSR) où `window`
 * n'existe pas. Il n'est jamais réellement lu : côté serveur, aucune
 * interaction utilisateur ne se produit, et `_authenticated` (qui concentre
 * tout l'usage de données) est en `ssr: false`. On l'utilise uniquement pour
 * que la création du persister ne plante jamais côté serveur.
 */
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } satisfies Storage;
}

export const queryPersister = createSyncStoragePersister({
  storage: typeof window !== "undefined" ? window.localStorage : createMemoryStorage(),
  key: "eg-query-cache",
  throttleTime: 1000,
});

/** Durée de conservation du cache persistant : une semaine. */
export const QUERY_PERSIST_MAX_AGE = 1000 * 60 * 60 * 24 * 7;
