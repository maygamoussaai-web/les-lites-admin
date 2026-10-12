import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type AdminProfile = Tables<"admin_profiles">;

export function useSessionUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { user, loading };
}

export function useAdminProfile() {
  const { user, loading } = useSessionUser();
  const query = useQuery({
    queryKey: ["admin_profile", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    networkMode: "offlineFirst",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_profiles")
        .select("*")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as AdminProfile | null;
    },
  });

  const establishmentsQuery = useQuery({
    queryKey: ["admin_profile_establishments", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    networkMode: "offlineFirst",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_profile_establishments")
        .select("establishment_id")
        .eq("profile_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.establishment_id);
    },
  });

  return {
    user,
    loading: loading || (!!user && query.isLoading),
    profile: query.data ?? null,
    isDG: query.data?.role === "director_general",
    establishmentIds: establishmentsQuery.data ?? [],
    establishmentIdsLoading: establishmentsQuery.isPending,
    refetch: query.refetch,
  };
}

/**
 * Statut réseau fiable : ne se base PAS uniquement sur navigator.onLine
 * (souvent faux sur mobile / 4G). On sonde réellement le projet Supabase.
 * - online → repasse immédiatement en ligne
 * - offline navigateur → on vérifie par un ping avant d'afficher « Hors ligne »
 * - 2 échecs de ping consécutifs → hors ligne
 */
export function useOnlineStatus() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    let fails = 0;
    let timer: number | undefined;

    const base =
      (import.meta as { env?: { VITE_SUPABASE_URL?: string } }).env?.VITE_SUPABASE_URL ?? "";

    const probe = async (): Promise<boolean> => {
      if (!base) return navigator.onLine !== false;
      try {
        const ctrl = new AbortController();
        const to = window.setTimeout(() => ctrl.abort(), 4500);
        const res = await fetch(`${base}/auth/v1/health`, {
          method: "GET",
          signal: ctrl.signal,
          cache: "no-store",
        });
        window.clearTimeout(to);
        return res.status > 0;
      } catch {
        try {
          const ctrl2 = new AbortController();
          const to2 = window.setTimeout(() => ctrl2.abort(), 3000);
          await fetch(`${base}/rest/v1/`, {
            method: "HEAD",
            signal: ctrl2.signal,
            cache: "no-store",
            headers: { Accept: "application/json" },
          });
          window.clearTimeout(to2);
          return true;
        } catch {
          return false;
        }
      }
    };

    const check = async () => {
      const ok = await probe();
      if (cancelled) return;
      if (ok) {
        fails = 0;
        setOnline(true);
      } else {
        fails += 1;
        if (fails >= 2) setOnline(false);
      }
    };

    void check();
    timer = window.setInterval(() => void check(), 20_000);

    const onOnline = () => {
      fails = 0;
      setOnline(true);
      void check();
    };
    const onOffline = () => {
      void check();
    };
    const onVis = () => {
      if (document.visibilityState === "visible") void check();
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return online;
}
