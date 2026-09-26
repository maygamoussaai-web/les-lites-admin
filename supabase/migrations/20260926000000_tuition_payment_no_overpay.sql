-- Protection absolue : un paiement ne peut pas dépasser le reste dû de la période (enrollment).
-- Appliqué en base, y compris hors UI / sync offline.

create or replace function public.enforce_tuition_payment_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
  v_paid numeric;
  v_remaining numeric;
begin
  if new.enrollment_id is null then
    return new;
  end if;

  select coalesce(total_amount, 0)
    into v_total
  from public.student_enrollments
  where id = new.enrollment_id;

  if not found then
    raise exception 'Période de scolarité introuvable pour ce paiement';
  end if;

  select coalesce(sum(amount), 0)
    into v_paid
  from public.tuition_payments
  where enrollment_id = new.enrollment_id
    and (tg_op = 'INSERT' or id is distinct from new.id);

  v_remaining := greatest(v_total - v_paid, 0);

  if new.amount is null or new.amount <= 0 then
    raise exception 'Le montant du paiement doit être strictement positif';
  end if;

  if new.amount > v_remaining + 0.0001 then
    raise exception
      'Paiement refusé : dépassement du reste dû (reste %, montant %)',
      v_remaining,
      new.amount;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_tuition_payment_no_overpay on public.tuition_payments;

create trigger trg_tuition_payment_no_overpay
  before insert or update of amount, enrollment_id
  on public.tuition_payments
  for each row
  execute function public.enforce_tuition_payment_cap();
