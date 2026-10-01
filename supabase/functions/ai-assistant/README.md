# AI Assistant — Les Élites de Gao (v82)

Edge Function autonome pour l'admin scolaire.

## Déploiement
- `index.ts` + `c0.ts`…`c7.ts` : loader gzip (code compressé)
- Source lisible : `AI_ASSISTANT_V82_MINI.ts`

## Capacités
**Lecture** : list_capabilities, list_establishments, list_classes, list_students, find_student, rank_students, list_teachers, student_payments, list_fee_plans, global_stats

**Écriture** (confirmation « oui » → confirmed=true) : create/update/archive/transfer student, record_tuition_payment

## Règles
- Accès à TOUTES les données RLS du compte admin
- Jamais inventer de données
- Toujours appeler list_capabilities si doute
