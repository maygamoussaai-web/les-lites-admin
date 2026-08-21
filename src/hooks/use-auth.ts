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

  // Établissements auxquels ce compte a accès (peut en avoir plusieurs).
  const establishmentsQuery = useQuery({
    queryKey: ["admin_profile_establishments", user?.id],
    enabled: !!user?.id,
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
    // isPending (et non isLoading) : reste vrai tant qu'aucune donnée n'est
    // arrivée, y compris pendant l'instant initial où la requête est encore
    // désactivée en attendant l'utilisateur — isLoading, lui, vaut faussement
    // "false" à ce moment précis, ce qui causait l'accès refusé prématuré.
    establishmentIdsLoading: establishmentsQuery.isPending,
    refetch: query.refetch,
  };
}

export function useOnlineStatus() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}