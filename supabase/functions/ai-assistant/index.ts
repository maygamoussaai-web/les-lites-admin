/**
 * ai-assistant Edge Function — source de vérité = déploiement Supabase Dashboard.
 *
 * PROTOCOLE (v151+ / 2026-10-07) :
 * - Lecture → outil immédiat
 * - Écriture → Plan d'action → un seul « oui » → exécution (confirmed=true)
 * - renew_class : même logique que menu ⋮ → Renouveler (génération, scolarités, période)
 * - Bypass cold-start : allowAffirmThisRequest + strengthenAffirmative (client)
 *
 * Déployer le monolithe complet depuis :
 *   artifacts/DEPLOY_AI_ASSISTANT_v151.ts
 *
 * Ne pas laisser ce fichier en stub vide (cause blank screen Lovable).
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Le code live est le monolithe déployé sur Edge (Dashboard).
// Ce fichier GitHub documente le protocole ; le déploiement complet
// se fait via Dashboard (taille > limite MCP/CI).

export {};
