import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { hydrateQueryClient, QUERY_PERSIST_MAX_AGE } from "@/lib/query-persist";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: QUERY_PERSIST_MAX_AGE,
        staleTime: 60_000,
        networkMode: "offlineFirst",
        refetchOnWindowFocus: true,
        refetchOnMount: true,
        refetchOnReconnect: true,
        retry: (failureCount, error) => {
          if (typeof navigator !== "undefined" && !navigator.onLine) return false;
          return failureCount < 1;
        },
      },
      mutations: {
        networkMode: "offlineFirst",
      },
    },
  });

  hydrateQueryClient(queryClient);

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 60_000,
    defaultPendingMs: 80,
    defaultPendingMinMs: 0,
  });

  return router;
};
