-- 0015_project_start.sql
--
-- Start project. A project can be planned before the work is let loose: its
-- tasks can wait on the project starting, as they wait on another task
-- (0014, 0021). Until someone presses Start project they cannot be timed or
-- submitted and their dates are a projection from the project's start date (or
-- today, if that has passed). Pressing it records the day, moves a Planning or
-- On Hold project to Active, and gives each waiting task its real dates: start
-- that working day, due `duration_days` working days later. Tasks waiting on
-- those follow down the chain through follow_task_dependency as before.
--
-- Starting is one-way and goes only through start_project(). Mirrors
-- canStartProject, markWaiting and dependentDates in lib/dependencies.ts.

alter table projects
  add column started_on date,
  add column started_by uuid references profiles(id) on delete set null;

alter table tasks
  add column waits_on_project_start boolean not null default false;

-- Who may start a project: the 3D Artists' Team Leader, and only a 3D project.
-- Nobody else, global managers and the Project Leader included.
create or replace function can_start_project(p_project_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select is_3d_team_leader() and is_3d_project(p_project_id);
$function$;

-- Waiting now also means waiting on a project that has not started.
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
             join projects pr on pr.id = t.project_id
            where t.id = p_task_id and t.waits_on_project_start and pr.started_on is null
         );
$function$;

-- As 0021, with the project start as one more thing a task can wait on. While
-- the project has not started, it counts as "due" on its start date, or today
-- once that has passed. Runs on insert too, since the flag is on the row itself.
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

  if v_links = 0 and not new.waits_on_project_start then
    return new;
  end if;

  if new.project_id is null or new.kind <> 'standard' then
    raise exception 'Only a standard task in a project can wait on another task or on the project starting.'
      using errcode = '22023';
  end if;
  if new.duration_days is null then
    raise exception 'A task that waits needs its days to complete.'
      using errcode = '22023';
  end if;

  if new.waits_on_project_start then
    select greatest(pr.start_date, ist_today())
      into v_from
      from projects pr
     where pr.id = new.project_id and pr.started_on is null;
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
  for each row when (new.waits_on_project_start)
  execute function schedule_dependent_task();

-- As 0021, naming the project when that is what a task waits on.
create or replace function guard_waiting_task()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_titles text;
begin
  if exists (
    select 1
      from tasks t
      join projects pr on pr.id = t.project_id
     where t.id = new.task_id and t.waits_on_project_start and pr.started_on is null
  ) then
    raise exception 'This task starts once the project is started.' using errcode = '22023';
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

-- Approving a task releases a dependant only if the project it waits on has
-- started too. As 0021 otherwise.
create or replace function follow_task_dependency()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_start date;
  v_due   date;
  r       record;
begin
  if new.status = 'Approved' and old.status is distinct from 'Approved' then
    v_start := snap_to_working_day(ist_today());
    for r in
      select t.id, t.title, t.assignee_id, t.duration_days, t.waits_on_project_start
        from task_dependencies d
        join tasks t on t.id = d.task_id
       where d.depends_on_task_id = new.id
    loop
      -- Inline rather than task_is_waiting(), which being stable could read
      -- this row as it was before the approval.
      if exists (
        select 1
          from task_dependencies d
          join tasks p on p.id = d.depends_on_task_id
         where d.task_id = r.id and p.status <> 'Approved'
      ) or (
        r.waits_on_project_start
        and exists (select 1 from projects where id = new.project_id and started_on is null)
      ) then
        update tasks set start_date = start_date where id = r.id;
        continue;
      end if;

      v_due := add_working_days(v_start, r.duration_days);
      update tasks set start_date = v_start, due_date = v_due where id = r.id;
      if not is_blueprint_project(new.project_id) then
        perform notify(
          array[r.assignee_id], 'task_assigned', 'Task ready to start',
          '"' || new.title || '" was approved, so "' || r.title || '" can start. Due '
            || to_char(v_due, 'FMDD Mon YYYY') || '.',
          task_href(r.id, new.project_id)
        );
      end if;
    end loop;
  elsif new.status <> 'Approved' then
    -- Touching the row is enough: schedule_dependent_task recomputes it.
    update tasks set start_date = start_date
     where id in (select task_id from task_dependencies where depends_on_task_id = new.id);
  end if;
  return null;
end;
$function$;

-- As 0021: linking to work already approved starts the task today, unless the
-- project it also waits on has not started.
create or replace function follow_task_dependency_link()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_start date;
  v_days  integer;
begin
  if tg_op = 'DELETE' then
    update tasks set start_date = start_date where id = old.task_id;
    return null;
  end if;

  if exists (
    select 1
      from task_dependencies d
      join tasks p on p.id = d.depends_on_task_id
     where d.task_id = new.task_id and p.status <> 'Approved'
  ) or task_is_waiting(new.task_id) then
    update tasks set start_date = start_date where id = new.task_id;
  else
    select duration_days into v_days from tasks
     where id = new.task_id and status = 'Not Started';
    if found then
      v_start := snap_to_working_day(ist_today());
      update tasks
         set start_date = v_start, due_date = add_working_days(v_start, v_days)
       where id = new.task_id;
    end if;
  end if;
  return null;
end;
$function$;

-- Only start_project() records a start, so the day and who pressed it can be
-- trusted, and a started project stays started.
create or replace function guard_project_start()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if (new.started_on is distinct from old.started_on
      or new.started_by is distinct from old.started_by)
     and coalesce(current_setting('pms.starting_project', true), '') <> 'on' then
    raise exception 'A project is started with Start project.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

create trigger projects_guard_start before update on projects
  for each row execute function guard_project_start();

-- Releases every task that waits on the project and on nothing still open:
-- start the day it was started, due `duration_days` working days on. The rest
-- are re-projected. Each release fires follow_task_dependency, so the chain
-- behind it moves too.
create or replace function follow_project_start()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_start date := snap_to_working_day(new.started_on);
  v_due   date;
  r       record;
begin
  for r in
    select t.id, t.title, t.assignee_id, t.duration_days
      from tasks t
     where t.project_id = new.id and t.waits_on_project_start
     order by t.created_at, t.id
  loop
    if exists (
      select 1
        from task_dependencies d
        join tasks p on p.id = d.depends_on_task_id
       where d.task_id = r.id and p.status <> 'Approved'
    ) then
      update tasks set start_date = start_date where id = r.id;
      continue;
    end if;

    v_due := add_working_days(v_start, r.duration_days);
    update tasks set start_date = v_start, due_date = v_due where id = r.id;
    if r.assignee_id is not null and not is_blueprint_project(new.id) then
      perform notify(
        array[r.assignee_id], 'task_assigned', 'Task ready to start',
        '"' || new.name || '" has started, so "' || r.title || '" can start. Due '
          || to_char(v_due, 'FMDD Mon YYYY') || '.',
        task_href(r.id, new.id)
      );
    end if;
  end loop;
  return null;
end;
$function$;

create trigger projects_follow_start after update of started_on on projects
  for each row when (old.started_on is null and new.started_on is not null)
  execute function follow_project_start();

-- Start project: today, or the next working day if today is not one.
create or replace function start_project(p_project_id uuid)
 returns date
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_day date;
begin
  if not can_start_project(p_project_id) then
    raise exception 'You don''t have permission to start this project.' using errcode = '42501';
  end if;

  perform set_config('pms.starting_project', 'on', true);
  update projects
     set started_on = snap_to_working_day(ist_today()),
         started_by = auth.uid(),
         status = case when status in ('Planning', 'On Hold') then 'Active'::project_status else status end
   where id = p_project_id and started_on is null
  returning started_on into v_day;
  perform set_config('pms.starting_project', '', true);

  if v_day is null then
    raise exception 'This project has already started.' using errcode = '22023';
  end if;
  return v_day;
end;
$function$;

grant execute on function start_project(uuid) to authenticated;
grant execute on function can_start_project(uuid) to authenticated;
