# ai-assistant (Lot1–Lot4 + protocole confirmation)

Edge Function Gemini — Les Élites de Gao.

> **Source de vérité en production** : le code collé dans le Dashboard Supabase (pas ce dossier `index.ts` stub).
> Ne pas déployer automatiquement depuis GitHub sans revue : risque d’écraser la version live.

## Correctif protocole (2026-10-06)

Fichier prêt à coller : `PROTOCOL-FIXED.ts` (dans ce dossier).

### Problème corrigé
Boucle « Confirmez-vous ? » après un « oui » : le `confirm_token` était perdu entre deux requêtes HTTP.

### Solution
- Map `pendingByUser` : mémorise tool + args + token après `CONFIRMATION_REQUIRED`
- Détection d’affirmation (`oui`, `je confirme`, `vas-y`, `ok`…)
- Exécution directe de l’action au message de confirmation
- SYSTEM : plan → une seule confirmation → exécution → résumé

### Déploiement manuel (recommandé)
1. Ouvrir `PROTOCOL-FIXED.ts` sur GitHub
2. Copier tout le contenu
3. Supabase → Edge Functions → `ai-assistant` → coller → Deploy
4. Activer **Verify JWT**

## Outils (47)

### Lecture
list_capabilities, get_complex_overview, list_students, get_student, search,
list_classes, list_teachers, get_class_statistics, rank_students, list_audit_logs,
list_periods, get_student_grades, check_grades_completeness, get_teacher_schedule,
list_student_documents, list_subjects, list_establishments, get_student_finance,
list_tuition_payments, list_teacher_payments, list_fee_plans, list_student_enrollments,
list_invitations

### Écriture (HMAC confirm_token)
upsert_grade, delete_grade, open_period, close_period,
create_class, update_class, archive_class, unarchive_class,
add_class_subject, remove_class_subject,
create_teacher, update_teacher, archive_teacher, delete_teacher_complete,
add_teacher_session, delete_teacher_session,
create_student, update_student, archive_student, unarchive_student, transfer_student,
generate_class_bulletins,
record_tuition_payment, record_teacher_payment

## Secrets
- GEMINI_API_KEY (requis)
- CONFIRM_SECRET (optionnel)
