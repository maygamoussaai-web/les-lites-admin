/**
 * ai-assistant Edge Function — source de vérité = déploiement Supabase Dashboard.
 *
 * PROTOCOLE (v151+) :
 * - Lecture → outil immédiat
 * - Écriture → Plan d'action → un seul « oui » → exécution (confirmed=true)
 * - Bypass cold-start : allowAffirmThisRequest + strengthenAffirmative (client)
 *
 * Déployer le monolithe complet depuis :
 *   artifacts/DEPLOY_AI_ASSISTANT_v151.ts
 *   (ou le même contenu dans ce dépôt après sync)
 *
 * Ne pas laisser ce fichier en stub vide (cause blank screen Lovable).
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Le code live est le monolithe v151 déployé sur Edge (Dashboard).
// Ce fichier GitHub sert de référence protocole ; le déploiement complet
// se fait via Dashboard pour éviter les limites de taille MCP/CI.

export {};
