-- =============================================================================
-- 0011 — Payment follow-ups on invoices
--
-- Accounts & Finance chase unpaid invoices by phone. Each call is logged
-- against its invoice (invoice_calls: who was spoken to, what they said, any
-- payment promised), and each invoice carries at most one next call: when,
-- what it is about, and who is to make it (invoices.next_call_*).
--
-- Logging a call replaces the schedule with whatever next call it sets, or
-- clears it — the store writes both in one commit. A schedule can also be set
-- without a call (the first chase of a new invoice).
--
-- The next_call_* columns are the PMS's own: the Zoho import route's upsert
-- names only Books' columns, so a sync or refetch never touches them.
--
-- Who: the same people as the invoices themselves (0009) — can_manage_invoices()
-- logs and schedules, can_view_invoices() reads. A call can be deleted by
-- whoever logged it, or a Super Admin. Mirrors canLogInvoiceCalls /
-- canDeleteInvoiceCall in lib/permissions.ts.
--
-- Each morning at 09:30 IST everyone with a call due today or missed gets one
-- notification listing how many (notify_invoice_follow_ups). Invoices already
-- settled (no balance, or paid / void) are left out, here and on screen.
-- =============================================================================

alter table invoices
  add column next_call_on   date,
  add column next_call_note text not null default '',
  add column next_call_by   uuid,
  add constraint invoices_next_call_by_fkey foreign key (next_call_by) references profiles (id) on delete set null;

create index invoices_next_call_idx on invoices (next_call_on) where next_call_on is not null;

create table invoice_calls (
  id              uuid          not null default gen_random_uuid(),
  invoice_id      uuid          not null,
  called_on       date          not null default ist_today(),
  -- Who picked up: a name, a designation, "accounts desk".
  contact         text          not null default '',
  outcome         text          not null,
  notes           text          not null default '',
  -- What the customer committed to, when they did.
  promised_on     date,
  promised_amount numeric(14,2),
  created_by      uuid          default auth.uid(),
  created_at      timestamptz   not null default now(),
  constraint invoice_calls_pkey primary key (id),
  constraint invoice_calls_invoice_fkey foreign key (invoice_id) references invoices (id) on delete cascade,
  constraint invoice_calls_created_by_fkey foreign key (created_by) references profiles (id) on delete set null,
  constraint invoice_calls_outcome_check check (outcome = any (array[
    'Promised to pay', 'Part payment promised', 'Says already paid', 'Needs documents',
    'Disputed', 'Call back later', 'No answer', 'Other'
  ])),
  constraint invoice_calls_promised_amount_check check (promised_amount is null or promised_amount >= 0),
  constraint invoice_calls_contact_check check (length(contact) <= 160),
  constraint invoice_calls_notes_check check (length(notes) <= 4000)
);
create index invoice_calls_invoice_idx on invoice_calls (invoice_id, called_on desc);

alter table invoice_calls enable row level security;

create policy invoice_calls_read on invoice_calls for select to authenticated
  using ((select can_view_invoices()));
create policy invoice_calls_insert on invoice_calls for insert to authenticated
  with check ((select can_manage_invoices()) and created_by = (select auth.uid()));
create policy invoice_calls_update on invoice_calls for update to authenticated
  using ((select can_manage_invoices()) and (created_by = (select auth.uid()) or (select is_super_admin())))
  with check ((select can_manage_invoices()));
create policy invoice_calls_delete on invoice_calls for delete to authenticated
  using ((select can_manage_invoices()) and (created_by = (select auth.uid()) or (select is_super_admin())));

revoke all on invoice_calls from anon;

/*
 * One notification a day per caller: how many follow-up calls are theirs
 * today, and how many they have missed. Repeats each morning until the call
 * is logged or moved, which is the point of a reminder.
 */
create or replace function notify_invoice_follow_ups()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_count integer;
begin
  with due as (
    select i.next_call_by as profile_id,
           count(*) filter (where i.next_call_on = ist_today()) as today,
           count(*) filter (where i.next_call_on < ist_today()) as missed
      from invoices i
      join profiles p on p.id = i.next_call_by and p.active
     where i.next_call_on <= ist_today()
       and i.balance > 0
       and i.status not in ('paid', 'void', 'draft')
     group by i.next_call_by
  ),
  inserted as (
    insert into notifications (profile_id, type, title, body, href)
    select d.profile_id,
           'invoice_follow_up',
           case
             when d.today > 0 then d.today || ' payment follow-up call' || case when d.today = 1 then '' else 's' end || ' today'
             else d.missed || ' missed payment follow-up call' || case when d.missed = 1 then '' else 's' end
           end,
           case
             when d.today > 0 and d.missed > 0
               then 'Plus ' || d.missed || ' missed from earlier days. Log each call, or move it to a new date.'
             else 'Log each call, or move it to a new date.'
           end,
           '/invoices?tab=follow-ups'
      from due d
     where not exists (
       select 1 from notifications n
        where n.profile_id = d.profile_id
          and n.type = 'invoice_follow_up'
          and (n.created_at at time zone 'Asia/Kolkata')::date = ist_today()
     )
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end;
$function$;

revoke all on function notify_invoice_follow_ups() from public, anon, authenticated;

select cron.schedule(
  'invoice-follow-ups-0930-ist',
  '0 4 * * *',
  $job$ select notify_invoice_follow_ups(); $job$
);

notify pgrst, 'reload schema';
