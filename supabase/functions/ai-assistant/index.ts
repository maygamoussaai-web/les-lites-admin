/**
 * ai-assistant Edge Function — source de vérité = déploiement Supabase Dashboard.
 *
 * PROTOCOLE (v152 / 2026-10-07) :
 * - Lecture → outil immédiat
 * - Écriture → Plan → un seul « oui » → confirmed=true
 * - Token HMAC = userId|tool|exp|nonce (PAS les paramètres métier)
 *   → évite l'échec quand Gemini ajoute generation_name etc. entre les appels
 * - pendingByUser + allowAffirmThisRequest (cold start)
 * - renew_class = même logique que ⋮ → Renouveler
 *
 * Déployer le monolithe : artifacts/DEPLOY_AI_ASSISTANT_v151.ts
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

export {};
