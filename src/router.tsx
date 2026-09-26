import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Cache mémoire 7 jours (hors-ligne) ; fraîcheur 45s puis refetch focus/mount.
        gcTime: 1000 * 60 * 60 * 24 * 7,
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
