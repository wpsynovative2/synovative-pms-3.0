-- =============================================================================
-- 0012 — An invoice bills for any number of projects and individual tasks
--
-- 0009 tied each invoice to at most one project (invoices.project_id). Billing
-- does not line up that neatly: one invoice can cover several projects, or a
-- piece of individual work, and one project is usually billed over several
-- invoices. invoice_links replaces the column — one row per invoice and the
-- project, or the individual task, it bills for. Existing links are carried
-- across, then the column goes, so there is one place that says what an
-- invoice is for.
--
-- An individual task is one with no project (§10). Blueprints are plans, not
-- billable work, and are never offered.
--
-- Who: as the invoices (0009) — can_view_invoices() reads, can_manage_invoices()
-- links and unlinks. Deleting the project, task or invoice deletes the link.
-- Mirrors InvoiceLink and setInvoiceLinks in lib/store.tsx.
-- =============================================================================

create table invoice_links (
  id          uuid        not null default gen_random_uuid(),
  invoice_id  uuid        not null,
  project_id  uuid,
  task_id     uuid,
  created_by  uuid        default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint invoice_links_pkey primary key (id),
  constraint invoice_links_invoice_fkey foreign key (invoice_id) references invoices (id) on delete cascade,
  constraint invoice_links_project_fkey foreign key (project_id) references projects (id) on delete cascade,
  constraint invoice_links_task_fkey foreign key (task_id) references tasks (id) on delete cascade,
  constraint invoice_links_created_by_fkey foreign key (created_by) references profiles (id) on delete set null,
  -- Each row names exactly one thing.
  constraint invoice_links_one_target check ((project_id is null) <> (task_id is null)),
  constraint invoice_links_project_key unique (invoice_id, project_id),
  constraint invoice_links_task_key unique (invoice_id, task_id)
);
create index invoice_links_project_idx on invoice_links (project_id) where project_id is not null;
create index invoice_links_task_idx on invoice_links (task_id) where task_id is not null;

/*
 * Only an individual task may be linked as a task: a project task is billed
 * through its project.
 */
create or replace function guard_invoice_link_task()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.task_id is not null and exists (
    select 1 from tasks t where t.id = new.task_id and t.project_id is not null
  ) then
    raise exception 'Only an individual task can be linked to an invoice; link its project instead.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

create trigger invoice_links_guard_task
  before insert or update of task_id on invoice_links
  for each row execute function guard_invoice_link_task();

insert into invoice_links (invoice_id, project_id, created_by, created_at)
select id, project_id, created_by, created_at from invoices where project_id is not null;

drop index if exists invoices_project_idx;
alter table invoices drop column project_id;

alter table invoice_links enable row level security;

create policy invoice_links_read on invoice_links for select to authenticated
  using ((select can_view_invoices()));
create policy invoice_links_write on invoice_links for all to authenticated
  using ((select can_manage_invoices()))
  with check ((select can_manage_invoices()));

revoke all on invoice_links from anon;

/*
 * Individual tasks an invoice can be tied to, named for Finance and Business
 * Development, who see few of them (as invoice_projects() does for projects).
 */
create or replace function invoice_tasks()
 returns table(id uuid, title text, status text, due_date date, assignee_name text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select t.id, t.title, t.status::text, t.due_date, coalesce(p.full_name, '')
    from tasks t
    left join profiles p on p.id = t.assignee_id
   where can_view_invoices()
     and t.project_id is null
     and t.recurrence is null
   order by t.due_date desc, t.title;
$function$;

revoke all on function invoice_tasks() from public;
grant execute on function invoice_tasks() to authenticated;

notify pgrst, 'reload schema';
