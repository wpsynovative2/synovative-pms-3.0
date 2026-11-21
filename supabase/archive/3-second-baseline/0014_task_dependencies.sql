-- Task dependencies and step-by-step (SBS) projects.
--
-- A standard project task can wait on another task in the same project: it
-- starts on the day that task is approved and is due `duration_days` working
-- days later (start on the 2nd, 4 days -> due on the 6th, Sundays and holidays
-- skipped). An SBS project chains its standard tasks this way, each on the one
-- before it; the client lays the chain out, so SBS is only a flag here.
-- Content tasks and individual tasks never wait.
--
-- Until the task it waits on is approved, a dependent task carries projected
-- dates, starting on that task's due date, and they move whenever that due
-- date does. It cannot be timed or submitted in that state, and it is never
-- overdue. Approval replaces the projection with real dates and tells the
-- assignee. Real dates may pass the project deadline; the app flags that
-- rather than squeezing the work.
--
-- Mirrors waitingOn / dependentDates in lib/dependencies.ts.

alter table projects add column step_by_step boolean not null default false;

alter table tasks
  add column depends_on_task_id uuid,
  add column duration_days      integer;

-- Deleting the task waited on releases the dependant with its projected dates.
alter table tasks add constraint tasks_depends_on_task_id_fkey
  foreign key (depends_on_task_id) references tasks (id) on delete set null;
alter table tasks add constraint task_dependency_complete check (
  depends_on_task_id is null
  or (duration_days is not null and depends_on_task_id <> id)
);
alter table tasks add constraint tasks_duration_days_check check (
  duration_days is null or duration_days >= 0
);
create index tasks_depends_on_task_id_idx on tasks (depends_on_task_id);

-- `n` working days on from the first working day at or after d. Same as
-- addWorkingDays() in lib/calendar.ts, without its "no past dates" rule.
create or replace function add_working_days(d date, n integer)
 returns date
 language plpgsql
 stable
as $function$
declare
  v_day date := snap_to_working_day(d);
begin
  for i in 1..greatest(coalesce(n, 0), 0) loop
    v_day := snap_to_working_day(v_day + 1);
  end loop;
  return v_day;
end;
$function$;

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
      from tasks t
      join tasks p on p.id = t.depends_on_task_id
     where t.id = p_task_id and p.status <> 'Approved'
  );
$function$;

-- Validates a dependency and works out the dependant's dates. Security
-- definer so the task waited on is read whatever the editor's own visibility.
create or replace function schedule_dependent_task()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_pred   tasks%rowtype;
  v_cursor uuid;
begin
  if new.project_id is null or new.kind <> 'standard' then
    raise exception 'Only a standard task in a project can wait on another task.'
      using errcode = '22023';
  end if;

  select * into v_pred from tasks where id = new.depends_on_task_id;
  -- Inserted later in the same statement; the client orders a chain so this
  -- does not happen, and a bad id is refused by the foreign key.
  if not found then
    return new;
  end if;

  if v_pred.project_id is distinct from new.project_id then
    raise exception 'A task can only wait on another task in the same project.'
      using errcode = '22023';
  end if;

  v_cursor := v_pred.id;
  for i in 1..1000 loop
    exit when v_cursor is null;
    if v_cursor = new.id then
      raise exception 'These tasks would be waiting on each other.' using errcode = '22023';
    end if;
    select depends_on_task_id into v_cursor from tasks where id = v_cursor;
  end loop;

  if v_pred.status <> 'Approved' then
    -- Projected: as if the task waited on is approved on its due date.
    new.start_date := snap_to_working_day(v_pred.due_date);
    new.due_date   := add_working_days(new.start_date, new.duration_days);
  elsif tg_op = 'INSERT' or new.depends_on_task_id is distinct from old.depends_on_task_id then
    -- Waiting on work that is already approved: it can start today.
    new.start_date := snap_to_working_day(ist_today());
    new.due_date   := add_working_days(new.start_date, new.duration_days);
  elsif new.duration_days is distinct from old.duration_days then
    -- Under way: a new length moves the due date, never the start.
    new.due_date := add_working_days(new.start_date, new.duration_days);
  end if;
  -- Otherwise the task is released and its dates are its own, hand edits included.

  return new;
end;
$function$;

create trigger tasks_schedule_dependent before insert or update on tasks
  for each row when (new.depends_on_task_id is not null)
  execute function schedule_dependent_task();

-- Approval releases the tasks waiting on this one; any other change to its
-- status or due date moves their projection. Each dependant's own update fires
-- this again, so the change runs down the whole chain.
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
      select id, title, assignee_id, duration_days from tasks where depends_on_task_id = new.id
    loop
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
    update tasks set start_date = start_date where depends_on_task_id = new.id;
  end if;
  return null;
end;
$function$;

create trigger tasks_follow_dependency after update on tasks
  for each row
  when (new.status is distinct from old.status or new.due_date is distinct from old.due_date)
  execute function follow_task_dependency();

-- A waiting task cannot be timed or submitted. Guarded on the rows rather than
-- in start_timer / submit_task so every path is covered.
create or replace function guard_waiting_task()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_title text;
begin
  select p.title into v_title
    from tasks t
    join tasks p on p.id = t.depends_on_task_id
   where t.id = new.task_id and p.status <> 'Approved';
  if found then
    raise exception 'This task starts once "%" is approved.', v_title using errcode = '22023';
  end if;
  return new;
end;
$function$;

create trigger time_sessions_guard_waiting before insert on time_sessions
  for each row execute function guard_waiting_task();
create trigger submissions_guard_waiting before insert on submissions
  for each row execute function guard_waiting_task();

-- task_is_overdue as in the baseline, plus: a waiting task is never late.
create or replace function task_is_overdue(p_task_id uuid, p_status task_status, p_due_date date)
 returns boolean
 language sql
 stable
 set search_path to 'public'
as $function$
  select case
    when p_status in ('Approved', 'Waiting for Client Response') then false
    when p_due_date >= current_date then false
    when task_is_waiting(p_task_id) then false
    when p_status = 'Submitted' and (
      select max(s.submitted_at) from submissions s where s.task_id = p_task_id
    )::date <= p_due_date then false
    else true
  end;
$function$;

-- notify_due_and_overdue as in the baseline, plus: no "due tomorrow" for a
-- task that is still waiting (overdue already follows task_is_overdue).
create or replace function notify_due_and_overdue()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_count integer := 0;
begin
  -- Due tomorrow
  insert into notifications (profile_id, type, title, body, href)
  select t.assignee_id, 'due_soon', 'Task due tomorrow',
         '"' || t.title || '" is due tomorrow.',
         task_href(t.id, t.project_id)
    from tasks t
   where t.assignee_id is not null
     and t.recurrence is null
     and not is_blueprint_project(t.project_id)
     and t.status not in ('Approved', 'Waiting for Client Response')
     and t.due_date = current_date + 1
     and not task_is_waiting(t.id)
     and not exists (
       select 1 from notifications n
        where n.profile_id = t.assignee_id
          and n.type = 'due_soon'
          and n.href = task_href(t.id, t.project_id)
          and n.created_at >= current_date
     );

  -- Overdue
  insert into notifications (profile_id, type, title, body, href)
  select t.assignee_id, 'overdue', 'Task overdue',
         '"' || t.title || '" passed its due date on ' ||
         to_char(t.due_date, 'DD Mon') || '.',
         task_href(t.id, t.project_id)
    from tasks t
   where t.assignee_id is not null
     and t.recurrence is null
     and not is_blueprint_project(t.project_id)
     and task_is_overdue(t.id, t.status, t.due_date)
     and not exists (
       select 1 from notifications n
        where n.profile_id = t.assignee_id
          and n.type = 'overdue'
          and n.href = task_href(t.id, t.project_id)
          and n.created_at >= current_date
     );

  return v_count;
end;
$function$;

-- generate_recurring_occurrences as in the baseline, plus: a copy keeps the
-- blueprint's SBS flag, and its tasks wait on the copies of the tasks the
-- blueprint's tasks wait on. Dependencies are wired once every task of the
-- occurrence exists, which also replaces their shifted dates with projections.
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

          -- In creation order, so a chain is projected from its head down.
          for t in
            select id, depends_on_task_id from tasks
             where project_id = src.id and depends_on_task_id is not null
             order by created_at, id
          loop
            update tasks
               set depends_on_task_id = (v_copies ->> t.depends_on_task_id::text)::uuid
             where id = (v_copies ->> t.id::text)::uuid;
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
            series_source_id, series_index, series_date
          ) values (
            null, v_name, src.description, src.department, src.assignee_id, src.priority,
            v_start, v_due, src.estimated_hours, src.tags, src.created_by, clock_timestamp(),
            src.id, v_index, v_day
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
