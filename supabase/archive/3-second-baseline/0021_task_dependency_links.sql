-- A task can wait on several tasks (Archi-3d.md §5). It starts the day the last
-- of them is approved and is due `duration_days` working days later; until then
-- its dates are projected from the latest due date among those still open.
--
-- tasks.depends_on_task_id could hold one link, so each link becomes a row here
-- and the column goes: keeping both would mean every check reads both. Waiting on
-- one task behaves exactly as it did in 0014, for every project.
--
-- A link is written after the tasks it joins, so nothing here has to cope with a
-- link to a row inserted later in the same statement, as 0014 did.
--
-- Mirrors markWaiting / dependentDates in lib/dependencies.ts.

create table task_dependencies (
  task_id            uuid        not null,
  depends_on_task_id uuid        not null,
  created_at         timestamptz not null default now(),
  constraint task_dependencies_pkey primary key (task_id, depends_on_task_id),
  constraint task_dependencies_not_self check (task_id <> depends_on_task_id),
  constraint task_dependencies_task_id_fkey
    foreign key (task_id) references tasks (id) on delete cascade,
  -- Deleting the task waited on removes the link. With no links left, the task
  -- is released holding its projected dates, as in 0014.
  constraint task_dependencies_depends_on_task_id_fkey
    foreign key (depends_on_task_id) references tasks (id) on delete cascade
);

create index task_dependencies_depends_on_task_id_idx
  on task_dependencies (depends_on_task_id);

-- Copied before any trigger below exists, so no task's dates move.
insert into task_dependencies (task_id, depends_on_task_id)
  select id, depends_on_task_id from tasks where depends_on_task_id is not null;

drop trigger tasks_schedule_dependent on tasks;
alter table tasks drop constraint task_dependency_complete;
alter table tasks drop column depends_on_task_id;

-- Is the task still waiting on one that has not been approved?
create or replace function task_is_waiting(p_task_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1
      from task_dependencies d
      join tasks p on p.id = d.depends_on_task_id
     where d.task_id = p_task_id and p.status <> 'Approved'
  );
$function$;

-- Keeps a dependent task's dates in step. Security definer so the tasks waited
-- on are read whatever the editor's own visibility.
create or replace function schedule_dependent_task()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_links  integer;
  v_latest date;
begin
  select count(*), max(p.due_date) filter (where p.status <> 'Approved')
    into v_links, v_latest
    from task_dependencies d
    join tasks p on p.id = d.depends_on_task_id
   where d.task_id = new.id;

  if v_links = 0 then
    return new;
  end if;

  if new.project_id is null or new.kind <> 'standard' then
    raise exception 'Only a standard task in a project can wait on another task.'
      using errcode = '22023';
  end if;
  if new.duration_days is null then
    raise exception 'A task that waits on another needs its days to complete.'
      using errcode = '22023';
  end if;

  if v_latest is not null then
    -- Projected: as if the last one still open is approved on its due date.
    new.start_date := snap_to_working_day(v_latest);
    new.due_date   := add_working_days(new.start_date, new.duration_days);
  elsif new.duration_days is distinct from old.duration_days then
    -- Under way: a new length moves the due date, never the start.
    new.due_date := add_working_days(new.start_date, new.duration_days);
  end if;
  -- Otherwise the task is released and its dates are its own, hand edits included.

  return new;
end;
$function$;

create trigger tasks_schedule_dependent before update on tasks
  for each row execute function schedule_dependent_task();

-- Approving the last task a dependant waits on releases it and tells its
-- assignee. Approving any other only moves its projection, as does any other
-- change to a status or due date. Each dependant's own update fires this again,
-- so the change runs down the whole chain.
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
      select t.id, t.title, t.assignee_id, t.duration_days
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

-- A waiting task cannot be timed or submitted. Guarded on the rows rather than
-- in start_timer / submit_task so every path is covered.
create or replace function guard_waiting_task()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_titles text;
begin
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

-- A link joins two standard tasks of one project, and never makes a loop.
create or replace function guard_task_dependency()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_task tasks%rowtype;
  v_pred tasks%rowtype;
begin
  select * into v_task from tasks where id = new.task_id;
  select * into v_pred from tasks where id = new.depends_on_task_id;

  if v_task.project_id is null or v_task.kind <> 'standard' then
    raise exception 'Only a standard task in a project can wait on another task.'
      using errcode = '22023';
  end if;
  if v_pred.kind <> 'standard' then
    raise exception 'A task can only wait on a standard task.' using errcode = '22023';
  end if;
  if v_pred.project_id is distinct from v_task.project_id then
    raise exception 'A task can only wait on another task in the same project.'
      using errcode = '22023';
  end if;
  if v_task.duration_days is null then
    raise exception 'A task that waits on another needs its days to complete.'
      using errcode = '22023';
  end if;

  -- Everything the new predecessor waits on, however far up. `union` drops
  -- repeats, so tasks that share a predecessor do not walk it twice.
  if exists (
    with recursive up (id) as (
      select new.depends_on_task_id
      union
      select d.depends_on_task_id
        from task_dependencies d
        join up on d.task_id = up.id
    )
    select 1 from up where id = new.task_id
  ) then
    raise exception 'These tasks would be waiting on each other.' using errcode = '22023';
  end if;

  return new;
end;
$function$;

create trigger task_dependencies_guard before insert on task_dependencies
  for each row execute function guard_task_dependency();

-- Puts a task's dates right when its links change. Waiting on work that is
-- already approved means it can start today, unless it has begun.
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
  ) then
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

create trigger task_dependencies_follow after insert or delete on task_dependencies
  for each row execute function follow_task_dependency_link();

alter table task_dependencies enable row level security;

-- A link reads with its task, and changes with the right to edit it.
create policy task_dependencies_read on task_dependencies for select to authenticated
  using (((select is_global_manager()) or (task_id = any ((select my_task_ids())::uuid[]))));
create policy task_dependencies_insert on task_dependencies for insert to authenticated
  with check (can_edit_task(task_id));
create policy task_dependencies_delete on task_dependencies for delete to authenticated
  using (can_edit_task(task_id));

-- generate_recurring_occurrences as in 0019, plus: a copy's tasks take their
-- links from task_dependencies.
create or replace function generate_recurring_occurrences()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_today    date := ist_today();
  v_created  integer := 0;
  src        record;
  t          record;
  v_type     text;
  v_until    date;
  v_count    integer;
  v_day      date;
  v_index    integer;
  v_start    date;
  v_shift    integer;
  v_deadline date;
  v_due      date;
  v_tstart   date;
  v_new      uuid;
  v_task     uuid;
  v_name     text;
  -- Blueprint task id -> the id of its copy in this occurrence.
  v_copies   jsonb;
  -- A user who saves a blueprint due today runs this themselves; the
  -- assignment trigger then tells the assignees, so only the cron run (no
  -- signed-in user) writes its own notifications.
  v_notify   boolean := auth.uid() is null;
begin
  -- ----------------------------------------------------------- projects --
  for src in
    select * from projects
     where recurrence is not null and not recurrence_paused and recurrence_cursor < v_today
     for update
  loop
    v_type  := src.recurrence -> 'ends' ->> 'type';
    v_until := case when v_type = 'on' then (src.recurrence -> 'ends' ->> 'date')::date end;
    v_count := case when v_type = 'after' then (src.recurrence -> 'ends' ->> 'count')::integer end;
    v_index := 0;
    v_day   := src.recurrence_anchor;

    while v_day <= v_today loop
      exit when v_type = 'on' and v_day > v_until;
      if recurrence_matches(src.recurrence, src.recurrence_anchor, v_day) then
        v_index := v_index + 1;
        exit when v_type = 'after' and v_index > v_count;

        if v_day > src.recurrence_cursor and not exists (
             select 1 from projects p
              where p.series_source_id = src.id and p.series_date = v_day) then
          v_start    := snap_to_working_day(v_day);
          v_shift    := v_start - src.start_date;
          v_deadline := greatest(src.deadline + v_shift, v_start);
          -- An "upcoming month" blueprint names each copy for the month after (0029).
          v_name     := occurrence_name(src.name, title_day(src.title_month, v_day));

          insert into projects (
            name, color, client_name, start_date, deadline, description, status,
            priority, leader_id, created_by, company_id, client_id, property_id,
            series_source_id, series_index, series_date, step_by_step
          ) values (
            v_name, src.color, src.client_name, v_start, v_deadline, src.description,
            case when src.status in ('Completed', 'Cancelled', 'Archived')
                 then 'Planning'::project_status else src.status end,
            src.priority, src.leader_id, src.created_by,
            src.company_id, src.client_id, src.property_id,
            src.id, v_index, v_day, src.step_by_step
          ) returning id into v_new;

          insert into project_services (project_id, service)
            select v_new, service from project_services where project_id = src.id;
          insert into project_members (project_id, profile_id)
            select v_new, profile_id from project_members where project_id = src.id;

          -- Same tasks and assignees, fresh state, creation order kept (§9.2).
          -- A content task keeps its kind and count; its slots are laid out
          -- by the tasks trigger (0026).
          v_copies := '{}'::jsonb;
          for t in
            select * from tasks where project_id = src.id order by created_at, id
          loop
            v_tstart := least(greatest(snap_to_working_day(t.start_date + v_shift), v_start), v_deadline);
            v_due    := least(greatest(snap_to_working_day(t.due_date + v_shift), v_tstart), v_deadline);

            insert into tasks (
              project_id, title, description, department, assignee_id, priority,
              start_date, due_date, estimated_hours, tags, kind, content_count,
              content_types, created_by, created_at, duration_days
            ) values (
              v_new, t.title, t.description, t.department, t.assignee_id, t.priority,
              v_tstart, v_due, t.estimated_hours, t.tags, t.kind, t.content_count,
              t.content_types, t.created_by, clock_timestamp(), t.duration_days
            ) returning id into v_task;

            v_copies := v_copies || jsonb_build_object(t.id::text, v_task::text);

            if v_notify and t.assignee_id is not null then
              insert into notifications (profile_id, type, title, body, href)
              values (
                t.assignee_id, 'task_assigned', 'New task assigned',
                '"' || t.title || '" in ' || v_name || '.',
                task_href(v_task, v_new)
              );
            end if;
          end loop;

          -- Once every task of the occurrence exists, and in creation order,
          -- so a chain is projected from its head down.
          for t in
            select d.task_id, d.depends_on_task_id
              from task_dependencies d
              join tasks x on x.id = d.task_id
             where x.project_id = src.id
             order by x.created_at, x.id, d.created_at
          loop
            insert into task_dependencies (task_id, depends_on_task_id)
            values (
              (v_copies ->> t.task_id::text)::uuid,
              (v_copies ->> t.depends_on_task_id::text)::uuid
            );
          end loop;

          v_created := v_created + 1;
        end if;
      end if;
      v_day := v_day + 1;
    end loop;

    update projects set recurrence_cursor = v_today where id = src.id;
  end loop;

  -- --------------------------------------------------- individual tasks --
  for src in
    select * from tasks
     where recurrence is not null and project_id is null
       and not recurrence_paused and recurrence_cursor < v_today
     for update
  loop
    v_type  := src.recurrence -> 'ends' ->> 'type';
    v_until := case when v_type = 'on' then (src.recurrence -> 'ends' ->> 'date')::date end;
    v_count := case when v_type = 'after' then (src.recurrence -> 'ends' ->> 'count')::integer end;
    v_index := 0;
    v_day   := src.recurrence_anchor;

    while v_day <= v_today loop
      exit when v_type = 'on' and v_day > v_until;
      if recurrence_matches(src.recurrence, src.recurrence_anchor, v_day) then
        v_index := v_index + 1;
        exit when v_type = 'after' and v_index > v_count;

        if v_day > src.recurrence_cursor and not exists (
             select 1 from tasks x
              where x.series_source_id = src.id and x.series_date = v_day) then
          v_start := snap_to_working_day(v_day);
          v_shift := v_start - src.start_date;
          v_due   := greatest(snap_to_working_day(src.due_date + v_shift), v_start);
          v_name  := occurrence_name(src.title, v_day);

          insert into tasks (
            project_id, title, description, department, assignee_id, priority,
            start_date, due_date, estimated_hours, tags, created_by, created_at,
            series_source_id, series_index, series_date,
            company_id, property_id, client_ids
          ) values (
            null, v_name, src.description, src.department, src.assignee_id, src.priority,
            v_start, v_due, src.estimated_hours, src.tags, src.created_by, clock_timestamp(),
            src.id, v_index, v_day,
            src.company_id, src.property_id, src.client_ids
          ) returning id into v_task;

          if v_notify and src.assignee_id is not null then
            insert into notifications (profile_id, type, title, body, href)
            values (
              src.assignee_id, 'task_assigned', 'New task assigned',
              '"' || v_name || '", due ' || to_char(v_due, 'FMDD Mon YYYY') || '.',
              task_href(v_task, null)
            );
          end if;
          v_created := v_created + 1;
        end if;
      end if;
      v_day := v_day + 1;
    end loop;

    update tasks set recurrence_cursor = v_today where id = src.id;
  end loop;

  return v_created;
end;
$function$;

notify pgrst, 'reload schema';
