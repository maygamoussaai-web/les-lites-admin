import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { sha256Hex } from "./invitations";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const DG_EMAIL = "directeurgeneral@gmail.com";

/**
 * Crée le compte Auth du Directeur Général si — et seulement si — aucun DG n'existe.
 * Conservé pour une réinitialisation d'urgence future ; non exposé dans l'UI.
 */
export const initDirectorGeneral = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ password: z.string().min(6) }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("admin_profiles")
      .select("id")
      .eq("role", "director_general")
      .limit(1);
    if (existingError) throw new Error(existingError.message);
    if (existing && existing.length > 0) {
      return { created: false, email: DG_EMAIL };
    }

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: DG_EMAIL,
      password: data.password,
      email_confirm: true,
    });
    if (error || !created.user) throw new Error(error?.message ?? "Création du compte impossible");

    const { error: profileError } = await supabaseAdmin.from("admin_profiles").insert({
      id: created.user.id,
      first_name: "Awdou Moussa",
      last_name: "MAYGA",
      role: "director_general",
      is_active: true,
    });
    if (profileError) throw new Error(profileError.message);

    return { created: true, email: DG_EMAIL };
  });

/**
 * Retourne le nom et la photo du Directeur Général pour l'écran de connexion (public, sans donnée sensible).
 */
export const getDirectorGeneralAccount = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("admin_profiles")
    .select("first_name, last_name, avatar_url")
    .eq("role", "director_general")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? { first_name: "Awdou Moussa", last_name: "MAYGA", avatar_url: null as string | null };
});

/**
 * Liste les comptes actifs du personnel administratif pour l'écran de connexion
 * (uniquement nom, établissement, photo — aucune donnée sensible).
 */
export const listStaffAccounts = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("admin_profiles")
    .select("id, first_name, last_name, avatar_url, establishment_id, establishments(name)")
    .eq("role", "administrative_staff")
    .eq("is_active", true)
    .order("last_name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    first_name: row.first_name as string,
    last_name: row.last_name as string,
    avatar_url: row.avatar_url as string | null,
    establishment_name: (row as unknown as { establishments: { name: string } | null }).establishments?.name ?? null,
  }));
});

/**
 * Résout l'e-mail d'un compte de personnel administratif actif à partir de son identifiant de profil,
 * pour permettre une connexion par simple sélection + mot de passe (sans ressaisir l'e-mail).
 */
export const getStaffEmail = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ profile_id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile, error } = await supabaseAdmin
      .from("admin_profiles")
      .select("id, role, is_active")
      .eq("id", data.profile_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!profile || profile.role !== "administrative_staff" || !profile.is_active) {
      throw new Error("Ce compte est introuvable ou a été désactivé.");
    }
    const { data: userRes, error: userError } = await supabaseAdmin.auth.admin.getUserById(data.profile_id);
    if (userError || !userRes.user?.email) throw new Error("Impossible de retrouver ce compte.");
    return { email: userRes.user.email };
  });

/**
 * Retourne le nom de l'établissement assigné par une invitation, pour affichage
 * en lecture seule sur la page d'activation (l'établissement n'est jamais modifiable par l'invité).
 */
export const getInvitationInfo = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ token: z.string().min(10) }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const tokenHash = await sha256Hex(data.token);
    const { data: invitation, error } = await supabaseAdmin
      .from("invitations")
      .select("establishment_id, expires_at, accepted_at, establishments(name)")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!invitation) throw new Error("Invitation introuvable ou déjà utilisée.");
    if (invitation.accepted_at) throw new Error("Cette invitation a déjà été utilisée.");
    if (new Date(invitation.expires_at).getTime() < Date.now())
      throw new Error("Cette invitation a expiré. Demandez-en une nouvelle au Directeur Général.");
    return {
      establishment_name:
        (invitation as unknown as { establishments: { name: string } | null }).establishments?.name ?? "—",
    };
  });

/**
 * Active un compte de personnel administratif à partir d'un lien d'invitation signé.
 */
export const acceptInvitation = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        token: z.string().min(10),
        email: z.string().email(),
        password: z.string().min(8),
        first_name: z.string().min(1),
        last_name: z.string().min(1),
        phone: z.string().optional().nullable(),
        avatar_url: z.string().url().optional().nullable(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const tokenHash = await sha256Hex(data.token);

    const { data: invitation, error } = await supabaseAdmin
      .from("invitations")
      .select("id, establishment_id, expires_at, accepted_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!invitation) throw new Error("Invitation introuvable ou déjà utilisée.");
    if (invitation.accepted_at) throw new Error("Cette invitation a déjà été utilisée.");
    if (new Date(invitation.expires_at).getTime() < Date.now())
      throw new Error("Cette invitation a expiré. Demandez-en une nouvelle au Directeur Général.");

    const { data: created, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
    });
    if (userError || !created.user) throw new Error(userError?.message ?? "Création du compte impossible");

    const { error: profileError } = await supabaseAdmin.from("admin_profiles").insert({
      id: created.user.id,
      first_name: data.first_name,
      last_name: data.last_name,
      phone: data.phone || null,
      avatar_url: data.avatar_url || null,
      role: "administrative_staff",
      establishment_id: invitation.establishment_id,
      is_active: true,
    });
    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      throw new Error(profileError.message);
    }

    await supabaseAdmin
      .from("invitations")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", invitation.id);

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: created.user.id,
      action: "invitation_accepted",
      entity_type: "admin_profiles",
      entity_id: created.user.id,
      establishment_id: invitation.establishment_id,
      metadata: {},
    });

    return { ok: true as const };
  });

/**
 * Supprime définitivement un compte de personnel administratif (auth + profil).
 * Réservé au Directeur Général — vérifié côté serveur via la session de l'appelant.
 */
export const deleteStaffAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ profile_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: callerProfile, error: callerError } = await context.supabase
      .from("admin_profiles")
      .select("role")
      .eq("id", context.userId)
      .maybeSingle();
    if (callerError) throw new Error(callerError.message);
    if (!callerProfile || callerProfile.role !== "director_general") {
      throw new Error("Seul le Directeur Général peut supprimer un compte du personnel.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target, error: targetError } = await supabaseAdmin
      .from("admin_profiles")
      .select("role")
      .eq("id", data.profile_id)
      .maybeSingle();
    if (targetError) throw new Error(targetError.message);
    if (!target || target.role !== "administrative_staff") {
      throw new Error("Ce compte ne peut pas être supprimé.");
    }

    await supabaseAdmin.from("admin_profiles").delete().eq("id", data.profile_id);
    await supabaseAdmin.auth.admin.deleteUser(data.profile_id);
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "admin_deleted",
      entity_type: "admin_profiles",
      entity_id: data.profile_id,
      metadata: {},
    });

    return { ok: true as const };
  });