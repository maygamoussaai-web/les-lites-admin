import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { QUERY_PERSIST_MAX_AGE } from "./lib/query-persist";

function isBrowserOnline() {
  return typeof navigator === "undefined" || navigator.onLine;
}

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Cache memoire = duree du cache disque (1 semaine) pour lecture hors ligne.
        gcTime: QUERY_PERSIST_MAX_AGE,
        // Donnees considerees fraiches 90s : moins de refetch silencieux, UI plus fluide.
        staleTime: 90_000,
        // Hors ligne : sert le cache persiste sans attendre le reseau.
        networkMode: "offlineFirst",
        refetchOnWindowFocus: false,
        // Au retour en ligne, revalider une fois les ecrans montes.
        refetchOnReconnect: true,
        // Pas de retry inutile sans reseau (latence / erreurs fantomes).
        retry: (failureCount) => {
          if (!isBrowserOnline()) return false;
          return failureCount < 1;
        },
      },
      mutations: {
        networkMode: "offlineFirst",
        retry: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    // Preload au survol seulement si les donnees ont plus de 45s.
    defaultPreloadStaleTime: 45_000,
  });

  return router;
};
