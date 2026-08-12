import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { sha256Hex } from "./invitations";

export const DG_EMAIL = "direction@leselitesdegao.ml";

/**
 * Crée le compte Auth du Directeur Général si — et seulement si — aucun DG n'existe.
 * Le mot de passe n'est jamais stocké ni renvoyé : il est confié à Supabase Auth.
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
