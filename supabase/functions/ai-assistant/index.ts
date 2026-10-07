/**
 * ai-assistant Edge Function — source de vérité = déploiement Supabase Dashboard.
 *
 * PROTOCOLE (v160 / 2026-10-07) :
 * - Lecture → outil immédiat
 * - Écriture → Plan → un seul « oui » → confirmed=true
 * - Token HMAC = userId|tool|exp|nonce (PAS les paramètres métier)
 * - isAffirmative : regarde la 1re ligne seulement (le client ajoute [INSTRUCTION:…] >80 car.)
 * - pendingByUser + allowAffirmThisRequest (cold start)
 * - renew_class = même logique que ⋮ → Renouveler
 *
 * Déployer le monolithe : artifacts/DEPLOY_AI_ASSISTANT_v151.ts
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

export {};
