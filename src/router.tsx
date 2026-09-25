import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { QUERY_PERSIST_MAX_AGE } from "./lib/query-persist";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Cache mémoire long (gcTime) pour le hors-ligne, mais données
        // considérées fraîches seulement 45s — puis refetch au focus / montage.
        gcTime: QUERY_PERSIST_MAX_AGE,
        staleTime: 45_000,
        refetchOnWindowFocus: true,
        refetchOnMount: true,
        refetchOnReconnect: true,
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    // Un survol/intent répété sur le même lien ne redéclenche pas une requête
    // si les données ont moins de 30s — réduit les appels réseau redondants
    // sans nuire à la fraîcheur perçue par l'utilisateur.
    defaultPreloadStaleTime: 30_000,
  });

  return router;
};
