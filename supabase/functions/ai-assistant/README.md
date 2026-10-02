# Edge Function `ai-assistant`

Assistant admin Les Élites de Gao — **plan de base**.

## Stack
- **Gemini** via secret Supabase `GEMINI_API_KEY` (jamais Lovable / GPT / Astra / AI Gateway).
- Modèles (fallback automatique) : `GEMINI_MODEL` env ou `gemini-2.0-flash-lite` → `gemini-2.0-flash` → `gemini-1.5-flash`.
- **43 outils** lecture + écriture (RLS via JWT admin).

## Déploiement
```bash
supabase secrets set GEMINI_API_KEY=your_key
# optionnel :
# supabase secrets set GEMINI_MODEL=gemini-2.0-flash-lite
supabase functions deploy ai-assistant
```

## Confirmation écriture
1. L'IA décrit l'action et demande « Confirmez par oui ».
2. L'utilisateur répond « oui » (ou ok / d'accord…).
3. Le serveur force `confirmed=true` sur les outils d'écriture — **une seule confirmation**.

## Client
`src/lib/ai-assistant.ts` → `supabase.functions.invoke("ai-assistant")`.
Aucun chemin Lovable actif.
