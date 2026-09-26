/**
 * Constantes de durée de cache.
 * Le persister localStorage a été retiré : il n'est plus utilisé par le root
 * (QueryClientProvider seul) et les packages associés créaient des échecs de
 * build Lovable lorsque package.json / bun.lock divergeaient.
 */

/** Durée de conservation du cache en mémoire : une semaine. */
export const QUERY_PERSIST_MAX_AGE = 1000 * 60 * 60 * 24 * 7;
