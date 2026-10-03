-- =============================================================================
-- An OBC is allotted service by service, not all at once.
-- Run after 0018_content_authors.sql.
--
-- Converting used to mean "this whole quote becomes one project". In practice a
-- quote covers several strands that start at different times and land with
-- different teams: three of its lines become a campaign project, one becomes a
-- second project a month later, and one is small enough to be a single
-- individual task. So each quoted line now records where it went.
--
-- A line goes to a project or to an individual task, never both. Both columns
-- are null until someone raises the work, and go back to null if that project
-- or task is deleted - which frees the line to be allotted again.
-- =============================================================================

alter table obc_items
  add column if not exists project_id uuid references projects (id) on delete set null,
  add column if not exists task_id    uuid references tasks (id)    on delete set null;

-- One or the other, never both.
alter table obc_items
  drop constraint if exists obc_items_one_allotment;
alter table obc_items
  add constraint obc_items_one_allotment
  check (project_id is null or task_id is null);

create index if not exists obc_items_project_idx on obc_items (project_id);
create index if not exists obc_items_task_idx    on obc_items (task_id);

-- Every OBC converted under the old rule had its whole quote turned into the
-- one project `obcs.project_id` names, so that is what its lines were for.
update obc_items i
   set project_id = o.project_id
  from obcs o
 where o.id = i.obc_id
   and o.project_id is not null
   and i.project_id is null
   and i.task_id is null;

-- ------------------------------------------------------------- guard ------

-- "A Business Executive raises the OBC; only a manager turns it into work"
-- (0014). That rule lived on obcs.status, which is no longer where the
-- decision is made - allotting a line is. Guard the columns themselves.
create or replace function guard_obc_item_allotment()
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

drop trigger if exists obc_items_guard_allotment on obc_items;
create trigger obc_items_guard_allotment
  before insert or update on obc_items
  for each row execute function guard_obc_item_allotment();

-- --------------------------------------------------- status follows suit --

-- An OBC reads as Converted ("Allotted" on screen) only while every one of its
-- lines has somewhere to be. Raising work sets that explicitly - the caller is
-- a manager, so it passes guard_obc_conversion. Losing an allotment is the
-- case that needs automating: deleting a project blanks its lines by foreign
-- key, and whoever deleted it may not be a manager, so only the downgrade
-- happens here.
create or replace function relax_obc_on_unallotment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_obc uuid := coalesce(new.obc_id, old.obc_id);
begin
  if exists (
    select 1 from obc_items
     where obc_id = v_obc and project_id is null and task_id is null
  ) then
    update obcs
       set status = 'Submitted'
     where id = v_obc and status = 'Converted';
  end if;
  return null;
end;
$$;

drop trigger if exists obc_items_relax_status on obc_items;
create trigger obc_items_relax_status
  after insert or update or delete on obc_items
  for each row execute function relax_obc_on_unallotment();

comment on column obc_items.project_id is 'The project raised for this quoted line, if one was.';
comment on column obc_items.task_id is 'The individual task raised for this quoted line, if one was.';
