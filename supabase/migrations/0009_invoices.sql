-- =============================================================================
-- 0009 — Invoices, read from Zoho Books
--
-- Zoho Books is the system of record for invoices. The PMS keeps a read-only
-- copy of the ones Accounts & Finance pull in, so each can be tied to the one
-- project it bills for. Nothing here is edited by hand: an invoice row is
-- written only by the /api/zoho/invoices routes (as the signed-in user, so RLS
-- still applies) from what Books returns, and the one thing a person changes
-- is which project it belongs to.
--
-- Rows stay until someone deletes them. A sync only ever adds what is new, and
-- a refetch rewrites one invoice from Books, keeping its project.
--
-- Who:
--   can_view_invoices()   Super Admin, Admin, Accounts & Finance, Business
--                         Development Executives
--   can_manage_invoices() Super Admin, Accounts & Finance: sync, fetch,
--                         refetch, link to a project, delete
-- Mirrors canViewInvoices / canManageInvoices in lib/permissions.ts.
-- =============================================================================

create or replace function can_view_invoices()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(auth_role() in ('super_admin', 'admin'), false)
      or is_finance()
      or is_business_exec();
$function$;

create or replace function can_manage_invoices()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(auth_role() = 'super_admin', false) or is_finance();
$function$;

create table invoices (
  id               uuid          not null default gen_random_uuid(),
  -- Books' own record id, the long number in an invoice's URL. Not the
  -- printed invoice number, which can be changed in Books.
  zoho_invoice_id  text          not null,
  invoice_number   text          not null,
  -- Books' status code as it was at the last fetch: sent, overdue,
  -- partially_paid, paid, void, pending_approval, approved, ...
  status           text          not null default '',
  customer_name    text          not null default '',
  salesperson_name text          not null default '',
  invoice_date     date,
  due_date         date,
  currency_code    text          not null default 'INR',
  total            numeric(14,2) not null default 0,
  balance          numeric(14,2) not null default 0,
  -- The invoice exactly as Books returned it. The screen reads it through
  -- readInvoice() in lib/invoices.ts, so a field mapped wrongly is fixed in
  -- code without fetching everything again.
  details          jsonb         not null default '{}'::jsonb,
  project_id       uuid,
  fetched_at       timestamptz   not null default now(),
  fetched_by       uuid,
  created_by       uuid          default auth.uid(),
  created_at       timestamptz   not null default now(),
  constraint invoices_pkey primary key (id),
  constraint invoices_zoho_invoice_id_key unique (zoho_invoice_id),
  constraint invoices_project_id_fkey foreign key (project_id) references projects (id) on delete set null,
  constraint invoices_fetched_by_fkey foreign key (fetched_by) references profiles (id) on delete set null,
  constraint invoices_created_by_fkey foreign key (created_by) references profiles (id) on delete set null
);
create index invoices_project_idx on invoices (project_id);
create index invoices_date_idx on invoices (invoice_date desc);

alter table invoices enable row level security;

create policy invoices_read on invoices for select to authenticated
  using ((select can_view_invoices()));
create policy invoices_write on invoices for all to authenticated
  using ((select can_manage_invoices()))
  with check ((select can_manage_invoices()));

revoke all on invoices from anon;

/*
 * The projects an invoice can be tied to, and the names to show for those
 * already tied. Finance and Business Development hold tasks on few projects,
 * so projects_read shows them almost none; this hands the invoice screens the
 * name of every real project (blueprints are plans, not billable work) and
 * nothing else about them.
 */
create or replace function invoice_projects()
 returns table(id uuid, name text, client_name text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p.id, p.name, p.client_name
    from projects p
   where can_view_invoices() and p.recurrence is null
   order by p.name;
$function$;

revoke all on function invoice_projects() from public;
grant execute on function can_view_invoices() to authenticated;
grant execute on function can_manage_invoices() to authenticated;
grant execute on function invoice_projects() to authenticated;
