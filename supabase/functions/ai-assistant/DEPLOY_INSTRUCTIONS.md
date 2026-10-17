# Deploy ai-assistant (LOT5)

Le fichier `index.ts` monolithe (~159 Ko) contient :
- 71 outils + `diagnose_school_system` (72)
- Confirmation HMAC **stateless** (payload base64url + signature)
- Audits consolidés bulk / generate_class_bulletins
- Notes vides → null (jamais 0 par défaut)
- MODELS : gemini-2.0-flash → flash-lite → 1.5-flash

## Déploiement

```bash
supabase functions deploy ai-assistant --project-ref gxsdbmbynplatmxrpkkj --no-verify-jwt
```

Ou Dashboard Supabase → Edge Functions → ai-assistant → Deploy.

Le fichier source à déployer est le monolithe `index.ts` de ce dossier (après le commit suivant).
