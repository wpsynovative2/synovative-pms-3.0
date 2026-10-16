-- =============================================================================
-- The estimate and the work are two different lists.
-- Run after 0019_obc_service_allotment.sql.
--
-- An estimate is written for the client, in the client's units: three lines
-- that say what they are buying. Delivering it takes ten or twelve services on
-- our side. Allotting work off the estimate's lines therefore never fitted -
-- one line is not one project, and it is not one task either.
--
-- So an OBC now carries both:
--   * obc_items    - the estimate, pulled from Zoho. Reference. Never allotted.
--   * obc_services - what we will actually deliver, written by the Business
--                    Development Executive by hand. This is the list a manager
--                    raises projects and individual tasks from.
--
-- The allotment columns move from the estimate's lines to the delivery
-- services, along with the two triggers that look after them.
-- =============================================================================

create table if not exists obc_services (
  id          uuid primary key default uuid_generate_v4(),
  obc_id      uuid not null references obcs (id) on delete cascade,
  position    integer not null default 0,
  service     text not null check (length(btrim(service)) between 1 and 160),
  quantity    numeric(10, 2) not null default 1 check (quantity >= 0),
  -- What this piece of work has to contain. Plain text, like the estimate's.
  description text not null default '',
  project_id  uuid references projects (id) on delete set null,
  task_id     uuid references tasks (id)    on delete set null,
  created_at  timestamptz not null default now(),
  -- A service goes to a project or to an individual task, never both.
  constraint obc_services_one_allotment check (project_id is null or task_id is null)
);

create index if not exists obc_services_obc_idx     on obc_services (obc_id, position);
create index if not exists obc_services_project_idx on obc_services (project_id);
create index if not exists obc_services_task_idx    on obc_services (task_id);

-- Until now the estimate's lines *were* the work, so that is what every
-- existing OBC's delivery list should start as - allotments and all. Guarded so
-- re-running the file cannot double the rows.
insert into obc_services (obc_id, position, service, quantity, description, project_id, task_id)
select i.obc_id,
       i.position,
       i.service,
       i.quantity,
       btrim(concat_ws(
         E'\n\n',
         nullif(btrim(i.description), ''),
         nullif(btrim(i.brief_description), '')
       )),
       i.project_id,
       i.task_id
  from obc_items i
 where not exists (select 1 from obc_services s where s.obc_id = i.obc_id);

-- ------------------------------------------------- the guards, moved over --

drop trigger if exists obc_items_guard_allotment on obc_items;
drop trigger if exists obc_items_relax_status    on obc_items;

alter table obc_items
  drop column if exists project_id,
  drop column if exists task_id;

-- "A Business Executive raises the OBC; only a manager turns it into work"
-- (0014). The Executive owns this list - they write it - but not where any of
-- it is sent.
create or replace function guard_obc_service_allotment()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if (new.project_id is not null or new.task_id is not null)
       and not is_global_manager() then
      raise exception 'Only a Super Admin, Admin or Manager can raise work from an OBC.'
        using errcode = '42501';
    end if;
  elsif new.project_id is distinct from old.project_id
     or new.task_id    is distinct from old.task_id then
    if not is_global_manager() then
      raise exception 'Only a Super Admin, Admin or Manager can raise work from an OBC.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists obc_services_guard_allotment on obc_services;
create trigger obc_services_guard_allotment
  before insert or update on obc_services
  for each row execute function guard_obc_service_allotment();

-- An OBC reads as Converted ("Allotted" on screen) only while every delivery
-- service has somewhere to be. Raising work sets that explicitly - the caller
-- is a manager, so it passes guard_obc_conversion. Losing an allotment is what
-- needs automating: deleting a project blanks its services by foreign key, and
-- whoever deleted it may not be a manager, so only the downgrade happens here.
create or replace function relax_obc_on_unallotment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_obc uuid := coalesce(new.obc_id, old.obc_id);
begin
  if not exists (select 1 from obc_services where obc_id = v_obc)
     or exists (
       select 1 from obc_services
        where obc_id = v_obc and project_id is null and task_id is null
     ) then
    update obcs
       set status = 'Submitted'
     where id = v_obc and status = 'Converted';
  end if;
  return null;
end;
$$;

drop trigger if exists obc_services_relax_status on obc_services;
create trigger obc_services_relax_status
  after insert or update or delete on obc_services
  for each row execute function relax_obc_on_unallotment();

-- ------------------------------------------------------------------ RLS ----

alter table obc_services enable row level security;

-- Same reach as the estimate's lines: every active member reads them, the
-- sales side writes them, and the trigger above decides who may allot.
-- Postgres has no CREATE POLICY ... IF NOT EXISTS, and the rest of this file
-- is re-runnable, so drop first rather than let a second run fail here.
drop policy if exists obc_services_read on obc_services;
create policy obc_services_read on obc_services
  for select to authenticated using (is_active_member());

drop policy if exists obc_services_write on obc_services;
create policy obc_services_write on obc_services
  for all to authenticated
  using (can_manage_crm()) with check (can_manage_crm());

comment on table obc_services is
  'What the agency will actually deliver for an OBC, written by hand. The estimate in obc_items is what the client bought; this is the list work is raised from.';
