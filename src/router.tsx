import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { QUERY_PERSIST_MAX_AGE } from "./lib/query-persist";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Aligné sur QUERY_PERSIST_MAX_AGE : le cache reste utilisable en
        // mémoire au moins aussi longtemps que ce qui est persisté en local,
        // pour un fonctionnement hors ligne cohérent.
        gcTime: QUERY_PERSIST_MAX_AGE,
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });

  return router;
};
