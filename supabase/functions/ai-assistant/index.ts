/**
 * ai-assistant Edge Function — source de vérité = déploiement Supabase Dashboard.
 *
 * PROTOCOLE renew_class (2026-10-08) :
 * - Génération Archives : classe renommée Nom_année, is_active=false (lecture seule)
 * - Élèves désassignés (class_id null) → liste « Sans classe »
 * - Scolarités fermées ; période notes clôturée
 * - Nouvelle classe active vide avec le nom d'origine
 * - Bibliothèque élève : documents de la génération masqués (visibles via Archives)
 *
 * Déployer le monolithe : artifacts/DEPLOY_AI_ASSISTANT_v151.ts
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

export {};
