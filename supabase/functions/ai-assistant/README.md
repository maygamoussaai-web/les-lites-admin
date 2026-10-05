# Edge Function `ai-assistant` (feature/gemini-assistant)

Assistant admin Les Élites de Gao — **43 outils**, Gemini Function Calling, confirmation HMAC sécurisée.

## Architecture
Frontend → `supabase.functions.invoke("ai-assistant")` → Edge → Gemini API → exécuteurs (JWT + has_establishment_access)

## Sécurité
- Auth JWT + admin_profiles.is_active
- Accès établissement via has_establishment_access (resolvers)
- WRITE: confirm_token HMAC (user + tool + establishment_id hint + params + nonce)
  - expire 10 min, one-shot
  - confirmed=true sans token valide → refusé
- Secret serveur: CONFIRM_SECRET (recommandé) ou SUPABASE_ANON_KEY
- Audit: chaque WRITE → audit_logs (échec audit = échec opération)

## 43 outils
Déclarés dans TOOLS et exécutés dans runTool.
Non supportés (schéma): schedule, create/revoke invitation.

## Bulletins
Lecture student_report_cards. generate_class_bulletins oriente vers le moteur UI (aucun recalcul Gemini).

## Modèle
GEMINI_MODEL puis gemini-2.0-flash-lite → gemini-2.0-flash

## Deploy
```bash
supabase secrets set GEMINI_API_KEY=...
supabase secrets set CONFIRM_SECRET=$(openssl rand -hex 32)
supabase functions deploy ai-assistant
```

## Contrat client (inchangé)
`{ message, history }` → `{ ok, data: { reply } }` | `{ ok: false, error }`
Message ≤ 2000 caractères.
