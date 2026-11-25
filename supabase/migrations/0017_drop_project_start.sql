-- 0017_drop_project_start.sql
--
-- Takes Start project (0015) out again. Files to receive (0016) does the job of
-- holding work back until it can begin, so a task no longer waits on its project
-- starting. Tasks that were waiting on it are released where their projected
-- dates stand; the projects keep whatever status they have.
--
-- task_is_waiting, task_waiting_now, schedule_dependent_task and
-- guard_waiting_task are as 0016 without the project start. follow_task_dependency
-- and follow_task_dependency_link already ask through task_waiting_now.

drop trigger if exists projects_follow_start on projects;
drop trigger if exists projects_guard_start on projects;
drop function if exists follow_project_start();
drop function if exists guard_project_start();
drop function if exists start_project(uuid);
drop function if exists can_start_project(uuid);

-- Its WHEN clause names the column about to go.
drop trigger if exists tasks_schedule_dependent_insert on tasks;

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
             join file_groups g on g.id = any (t.file_group_ids)
            where t.id = p_task_id and g.received_on is null
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
             join file_groups g on g.id = any (t.file_group_ids)
            where t.id = p_task_id and g.received_on is null
         );
end;
$function$;

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

  if v_links = 0 and cardinality(new.file_group_ids) = 0 then
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
    select 1 from file_groups g
     where g.id = any (new.file_group_ids) and g.received_on is null
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

create or replace function guard_waiting_task()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_titles text;
begin
  select string_agg('"' || g.name || '"', ', ' order by g.created_at, g.id)
    into v_titles
    from tasks t
    join file_groups g on g.id = any (t.file_group_ids)
   where t.id = new.task_id and g.received_on is null;
  if v_titles is not null then
    raise exception 'This task starts once the files in % are received.', v_titles
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

alter table tasks drop column if exists waits_on_project_start;
alter table projects drop column if exists started_on, drop column if exists started_by;

create trigger tasks_schedule_dependent_insert before insert on tasks
  for each row when (new.file_group_ids <> '{}'::uuid[])
  execute function schedule_dependent_task();
