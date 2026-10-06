# ai-assistant (Lot1–Lot4)

Edge Function Gemini — Les Élites de Gao.

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

## Déploiement
Coller `ai-assistant-LOT4-READY.ts` dans le Dashboard Edge Function puis Deploy.
Activer **verify_jwt = ON**.
