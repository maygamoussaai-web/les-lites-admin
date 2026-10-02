# AI Assistant — Les Élites de Gao (plan de base)

Edge Function autonome : **Gemini** (`GEMINI_API_KEY` dans Secrets Supabase) + **43 outils**.

## Secrets requis
- `GEMINI_API_KEY` (obligatoire)
- Optionnel : `GEMINI_MODEL` (défaut `gemini-3.5-flash-lite`)

## Déploiement
```bash
supabase functions deploy ai-assistant --project-ref <REF>
```

## Client
`src/lib/ai-assistant.ts` → `supabase.functions.invoke("ai-assistant")`  
**Aucun** appel à la gateway Lovable / LOVABLE_API_KEY / gpt-6-astra.

## Règles
- RLS de l'utilisateur connecté (JWT)
- Écritures : confirmation « oui » puis `confirmed=true`
- Réponses FR, concises, professionnelles
