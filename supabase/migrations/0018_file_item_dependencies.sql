-- 0018_file_item_dependencies.sql
--
-- Files to receive (0016), one file at a time. A task waited on whole file
-- groups; now it waits on the files themselves ("DXF" and "DWG" of "Chirag"),
-- so work that needs one drawing can start the day that drawing is in.
-- `tasks.file_item_ids` replaces `tasks.file_group_ids`. A task that waited on a
-- group now waits on every file that group has, so nothing it waits on changes.
-- A group keeps its `received_on` for show; it no longer releases anything.
--
-- When a file comes in, each task waiting on it and on nothing else starts that
-- working day, due `duration_days` working days later, and its assignee is
-- told. Unticking it puts them back to waiting.
--
-- Deleting a file - or a group, which takes its files - goes through
-- delete_file_item / delete_file_group, which ask for a start and a due date
-- for every task the deletion leaves waiting on nothing, set them, and delete,
-- in one go. They are for whoever manages the project's files
-- (can_manage_task_groups), who may not be able to edit those tasks otherwise.
--
-- Also: the 3D Artists' Team Leader may edit a 3D project's description
-- (set_project_description), as global managers and its leader may.
--
-- Mirrors lib/files.ts, markWaiting in lib/dependencies.ts and
-- canEditProjectDescription in lib/permissions.ts.

alter table tasks add column file_item_ids uuid[] not null default '{}';

-- Carry each task's groups over as their files, without logging, notifying or
-- re-projecting anything: it waits on exactly what it did. A task that waited
-- on a group with no files in it was waiting on nothing that could arrive; it
-- now waits on nothing and keeps the dates it had.
alter table tasks disable trigger user;
update tasks t
   set file_item_ids = coalesce((
         select array_agg(f.id order by g.created_at, g.id, f.created_at, f.id)
           from file_items f
           join file_groups g on g.id = f.group_id
          where f.group_id = any (t.file_group_ids)
       ), '{}')
 where t.file_group_ids <> '{}'::uuid[];
alter table tasks enable trigger user;

-- Everything that named the groups goes.
drop trigger if exists tasks_guard_file_groups on tasks;
drop trigger if exists tasks_schedule_dependent_insert on tasks;
drop trigger if exists file_groups_drop_task_links on file_groups;
drop trigger if exists file_groups_follow on file_groups;
drop function if exists guard_task_file_groups();
drop function if exists drop_file_group_links();
drop function if exists follow_file_group();

/* ------------------------------------------------- waiting on the files */

-- Waiting: on a task not yet approved, or on a file not yet received.
create or replace function task_is_waiting(p_task_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
           select 1
             from task_dependencies d
             join tasks p on p.id = d.depends_on_task_id
            where d.task_id = p_task_id and p.status <> 'Approved'
         )
      or exists (
           select 1
             from tasks t
             join file_items f on f.id = any (t.file_item_ids)
            where t.id = p_task_id and not f.received
         );
$function$;

create or replace function task_waiting_now(p_task_id uuid)
 returns boolean
 language plpgsql
 volatile security definer
 set search_path to 'public'
as $function$
begin
  return exists (
           select 1
             from task_dependencies d
             join tasks p on p.id = d.depends_on_task_id
            where d.task_id = p_task_id and p.status <> 'Approved'
         )
      or exists (
           select 1
             from tasks t
             join file_items f on f.id = any (t.file_item_ids)
            where t.id = p_task_id and not f.received
         );
end;
$function$;

-- As 0017, with files in place of file groups. A file not received counts as
-- "due" on the project's start date, or today once that has passed.
create or replace function schedule_dependent_task()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_links  integer;
  v_latest date;
  v_from   date;
begin
  if tg_op = 'UPDATE' then
    select count(*), max(p.due_date) filter (where p.status <> 'Approved')
      into v_links, v_latest
      from task_dependencies d
      join tasks p on p.id = d.depends_on_task_id
     where d.task_id = new.id;
  else
    v_links := 0;
  end if;

  if v_links = 0 and cardinality(new.file_item_ids) = 0 then
    return new;
  end if;

  if new.project_id is null or new.kind <> 'standard' then
    raise exception 'Only a standard task in a project can wait on anything.'
      using errcode = '22023';
  end if;
  if new.duration_days is null then
    raise exception 'A task that waits needs its days to complete.'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from file_items f
     where f.id = any (new.file_item_ids) and not f.received
  ) then
    select greatest(pr.start_date, ist_today()) into v_from
      from projects pr where pr.id = new.project_id;
    -- greatest() skips nulls, so either alone will do.
    v_latest := greatest(v_latest, v_from);
  end if;

  if v_latest is not null then
    -- Projected: as if the last thing still open is settled on its date.
    new.start_date := snap_to_working_day(v_latest);
    new.due_date   := add_working_days(new.start_date, new.duration_days);
  elsif tg_op = 'UPDATE' then
    -- Nested so OLD is never read on insert.
    if new.duration_days is distinct from old.duration_days then
      -- Under way: a new length moves the due date, never the start.
      new.due_date := add_working_days(new.start_date, new.duration_days);
    end if;
  end if;
  -- Otherwise the task is released and its dates are its own, hand edits included.

  return new;
end;
$function$;

create trigger tasks_schedule_dependent_insert before insert on tasks
  for each row when (new.file_item_ids <> '{}'::uuid[])
  execute function schedule_dependent_task();

-- A task waits only on its own project's files, each named once.
create or replace function guard_task_file_items()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if exists (
    select 1 from unnest(new.file_item_ids) x
     where not exists (
       select 1 from file_items f where f.id = x and f.project_id = new.project_id)
  ) then
    raise exception 'A task waits on files of its own project.' using errcode = '22023';
  end if;
  if cardinality(new.file_item_ids)
     <> (select count(distinct x) from unnest(new.file_item_ids) x) then
    raise exception 'A task names each file once.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

create trigger tasks_guard_file_items before insert or update of file_item_ids, project_id on tasks
  for each row when (new.file_item_ids <> '{}'::uuid[])
  execute function guard_task_file_items();

-- A file deleted some other way still leaves every task that waited on it.
create or replace function drop_file_item_links()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update tasks set file_item_ids = array_remove(file_item_ids, old.id)
   where file_item_ids @> array[old.id];
  return null;
end;
$function$;

create trigger file_items_drop_task_links after delete on file_items
  for each row execute function drop_file_item_links();

-- Names the files when a task cannot be timed or submitted for want of them.
create or replace function guard_waiting_task()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_titles text;
begin
  select string_agg('"' || f.name || '"', ', ' order by g.created_at, g.id, f.created_at, f.id)
    into v_titles
    from tasks t
    join file_items f on f.id = any (t.file_item_ids)
    join file_groups g on g.id = f.group_id
   where t.id = new.task_id and not f.received;
  if v_titles is not null then
    raise exception 'This task starts once % received.',
      v_titles || case when v_titles like '%", "%' then ' are' else ' is' end
      using errcode = '22023';
  end if;

  select string_agg('"' || p.title || '"', ', ' order by p.created_at, p.id)
    into v_titles
    from task_dependencies d
    join tasks p on p.id = d.depends_on_task_id
   where d.task_id = new.task_id and p.status <> 'Approved';
  if v_titles is not null then
    raise exception 'This task starts once % approved.',
      v_titles || case when v_titles like '%", "%' then ' are' else ' is' end
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

/* ------------------------------------------------- releasing the tasks */

-- A file came in: each task waiting on it and on nothing else starts today's
-- working day. A file going back to not received re-projects its tasks. Each
-- release fires follow_task_dependency, so the chain follows.
create or replace function follow_file_item()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_start date := snap_to_working_day(ist_today());
  v_due   date;
  r       record;
begin
  for r in
    select t.id, t.title, t.assignee_id, t.duration_days
      from tasks t
     where t.project_id = new.project_id and new.id = any (t.file_item_ids)
     order by t.created_at, t.id
  loop
    if not new.received or task_waiting_now(r.id) then
      update tasks set start_date = start_date where id = r.id;
      continue;
    end if;

    v_due := add_working_days(v_start, r.duration_days);
    update tasks set start_date = v_start, due_date = v_due where id = r.id;
    if r.assignee_id is not null and not is_blueprint_project(new.project_id) then
      perform notify(
        array[r.assignee_id], 'task_assigned', 'Task ready to start',
        '"' || new.name || '" is in, so "' || r.title || '" can start. Due '
          || to_char(v_due, 'FMDD Mon YYYY') || '.',
        task_href(r.id, new.project_id)
      );
    end if;
  end loop;
  return null;
end;
$function$;

create trigger file_items_follow after update of received on file_items
  for each row when (old.received is distinct from new.received)
  execute function follow_file_item();

/* ---------------------------------------------------- deleting files */

-- Takes `p_item_ids` out of every task waiting on any of them. A task that is
-- then waiting on nothing, and not approved, takes the dates given for it in
-- `p_dates` - {"<task id>": {"start": "2026-11-26", "due": "2026-12-03"}} - and
-- there must be some: whoever deletes the files says when that work happens.
-- A task still waiting on something else keeps its projection.
create or replace function release_file_dependants(p_item_ids uuid[], p_dates jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r       record;
  v_was   boolean;
  v_entry jsonb;
  v_start date;
  v_due   date;
begin
  for r in
    select t.id, t.title, t.status, t.assignee_id, t.project_id
      from tasks t
     where t.file_item_ids && p_item_ids
     order by t.created_at, t.id
  loop
    v_was := task_waiting_now(r.id);
    update tasks
       set file_item_ids = array(
             select x from unnest(file_item_ids) with ordinality u(x, n)
              where x <> all (p_item_ids) order by n)
     where id = r.id;

    continue when r.status = 'Approved' or task_waiting_now(r.id);

    v_entry := coalesce(p_dates, '{}'::jsonb) -> r.id::text;
    v_start := null;
    v_due   := null;
    begin
      v_start := (v_entry ->> 'start')::date;
      v_due   := (v_entry ->> 'due')::date;
    exception when others then
      v_start := null;
      v_due   := null;
    end;
    if v_start is null or v_due is null then
      raise exception 'Give "%" a start and a due date before deleting the files it waits on.', r.title
        using errcode = '22023';
    end if;
    if v_due < v_start then
      raise exception 'The due date of "%" must be on or after its start date.', r.title
        using errcode = '22023';
    end if;

    update tasks set start_date = v_start, due_date = v_due where id = r.id;
    if v_was and r.assignee_id is not null and not is_blueprint_project(r.project_id) then
      perform notify(
        array[r.assignee_id], 'task_assigned', 'Task ready to start',
        'The files "' || r.title || '" waited on are no longer needed, so it can start '
          || to_char(v_start, 'FMDD Mon YYYY') || '. Due '
          || to_char(v_due, 'FMDD Mon YYYY') || '.',
        task_href(r.id, r.project_id)
      );
    end if;
  end loop;
end;
$function$;

create or replace function delete_file_item(p_item_id uuid, p_dates jsonb default '{}'::jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_project uuid;
begin
  select project_id into v_project from file_items where id = p_item_id;
  if not found then
    return;
  end if;
  if not can_manage_task_groups(v_project) then
    raise exception 'You can''t change this project''s files.' using errcode = '42501';
  end if;
  perform release_file_dependants(array[p_item_id], p_dates);
  delete from file_items where id = p_item_id;
end;
$function$;

create or replace function delete_file_group(p_group_id uuid, p_dates jsonb default '{}'::jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_project uuid;
begin
  select project_id into v_project from file_groups where id = p_group_id;
  if not found then
    return;
  end if;
  if not can_manage_task_groups(v_project) then
    raise exception 'You can''t change this project''s files.' using errcode = '42501';
  end if;
  perform release_file_dependants(
    array(select id from file_items where group_id = p_group_id), p_dates);
  delete from file_groups where id = p_group_id;
end;
$function$;

alter table tasks drop column file_group_ids;

/* ------------------------------------------------ project description */

-- Who may edit a project's description: whoever may edit the project, and for
-- a 3D project the 3D Artists' Team Leader too, who cannot update projects
-- directly. Mirrors canEditProjectDescription.
create or replace function can_edit_project_description(p_project_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select is_global_manager()
      or leads_project(p_project_id)
      or (is_3d_team_leader() and is_3d_project(p_project_id));
$function$;

create or replace function set_project_description(p_project_id uuid, p_description text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not can_edit_project_description(p_project_id) then
    raise exception 'You can''t edit this project''s description.' using errcode = '42501';
  end if;
  update projects set description = coalesce(p_description, '') where id = p_project_id;
end;
$function$;

/* ------------------------------------------------------------- security */

-- release_file_dependants checks nothing itself: only the two above call it.
revoke all on function release_file_dependants(uuid[], jsonb) from public, anon, authenticated;
revoke all on function delete_file_item(uuid, jsonb) from public, anon;
revoke all on function delete_file_group(uuid, jsonb) from public, anon;
revoke all on function set_project_description(uuid, text) from public, anon;
revoke all on function can_edit_project_description(uuid) from public, anon;
grant execute on function delete_file_item(uuid, jsonb) to authenticated;
grant execute on function delete_file_group(uuid, jsonb) to authenticated;
grant execute on function set_project_description(uuid, text) to authenticated;
grant execute on function can_edit_project_description(uuid) to authenticated;
