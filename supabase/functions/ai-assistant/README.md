# ai-assistant Edge Function (V41)

## Structure

- `index.ts` — chargeur gzip (importe c0…c5)
- `c0.ts` … `c5.ts` — payload base64 gzip de la source monolithe
- `tools.ts` — stub (logique dans le payload)

## Déploiement

Via Supabase MCP / CLI avec tous les fichiers `index` + `c0`…`c5`.

## Outils (V41)

**Lecture :** search, list_establishments, list_classes, list_students (âge/DOB),
get_student, list_teachers, get_teacher, list_periods, list_subjects,
get_student_grades, get_class_statistics, get_complex_overview,
list_student_documents, list_student_enrollments, list_fee_plans,
get_student_finance, list_audit_logs, list_invitations,
list_teacher_payments, list_teacher_sessions, list_tuition_payments

**Écriture** (confirmed=true obligatoire) :
create/update/archive/unarchive student, transfer_student,
upsert_grade, delete_grade, open/close_period,
create/update class, add/remove_class_subject,
create/update establishment, create/update/archive teacher,
record_tuition_payment, record_teacher_payment
