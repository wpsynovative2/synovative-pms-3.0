-- =============================================================================
-- A repeating project is a blueprint, not a project. Run after the baseline
-- (0001-0008), or after supabase/archive/0028 on a database built from it.
--
-- Until now the project you set a repeat on was itself occurrence #1: it went
-- live the moment it was saved, its tasks were assigned and notified at once,
-- and the date you picked only applied from the second copy on.
--
-- Now:
--   * A project (or individual task) that carries a repeat rule is a
--     *blueprint*. It lives on the Recurrence page only - no notifications, no
--     timers, no content slots, no overdue reminders - and the app hides it
--     everywhere else.
--   * Every occurrence, the first included, is a real project created on its
--     own date, named "<name> – <Month> <Year>" (or with [Month] / [Year]
--     filled in where the name carries them), with its tasks, content tasks,
--     members, services and company / client / property.
--   * A blueprint whose first date is today is created at once: the app calls
--     run_due_recurrences() after saving one.
-- =============================================================================

-- ------------------------------------------ series that already exist ----

-- Used once below, then dropped.
create or replace function convert_live_series()
returns void language plpgsql set search_path = public as $fn$
declare
  s record;
  t record;
  v_bp uuid;
begin
  for s in
    select * from projects where recurrence is not null and recurrence_anchor < ist_today()
  loop
    insert into projects (
      name, color, client_name, start_date, deadline, description, status, priority,
      leader_id, created_by, company_id, client_id, property_id,
      recurrence, recurrence_cursor, recurrence_paused
    ) values (
      s.name, s.color, s.client_name, s.start_date, s.deadline, s.description, s.status,
      s.priority, s.leader_id, s.created_by, s.company_id, s.client_id, s.property_id,
      s.recurrence, s.recurrence_cursor, s.recurrence_paused
    ) returning id into v_bp;

    insert into project_services (project_id, service)
      select v_bp, service from project_services where project_id = s.id;
    insert into project_members (project_id, profile_id)
      select v_bp, profile_id from project_members where project_id = s.id;
    for t in select * from tasks where project_id = s.id order by created_at, id loop
      insert into tasks (
        project_id, title, description, department, assignee_id, priority, start_date,
        due_date, estimated_hours, tags, kind, content_count, created_by, created_at
      ) values (
        v_bp, t.title, t.description, t.department, t.assignee_id, t.priority, t.start_date,
        t.due_date, t.estimated_hours, t.tags, t.kind, t.content_count, t.created_by,
        clock_timestamp()
      );
    end loop;

    update projects set series_source_id = v_bp where series_source_id = s.id;
    update projects
       set recurrence = null, series_source_id = v_bp, series_index = 1,
           series_date = s.recurrence_anchor
     where id = s.id;
  end loop;

  for s in
    select * from tasks
     where recurrence is not null and project_id is null and recurrence_anchor < ist_today()
  loop
    insert into tasks (
      project_id, title, description, department, assignee_id, priority, start_date,
      due_date, estimated_hours, tags, created_by, recurrence, recurrence_cursor,
      recurrence_paused
    ) values (
      null, s.title, s.description, s.department, s.assignee_id, s.priority, s.start_date,
      s.due_date, s.estimated_hours, s.tags, s.created_by, s.recurrence, s.recurrence_cursor,
      s.recurrence_paused
    ) returning id into v_bp;

    update tasks set series_source_id = v_bp where series_source_id = s.id;
    update tasks
       set recurrence = null, series_source_id = v_bp, series_index = 1,
           series_date = s.recurrence_anchor
     where id = s.id;
  end loop;
end
$fn$;

-- Runs once, the first time this file is applied: afterwards every series is
-- already a blueprint, and a blueprint whose first date has passed must not be
-- mistaken for a source that went live.
do $conv$
begin
  if exists (select 1 from pg_proc where proname = 'occurrence_name') then
    return;
  end if;

  -- A source whose first date has not come yet simply becomes the blueprint:
  -- its first copy is made on that date.
  update projects p
     set recurrence_cursor = p.recurrence_anchor - 1
   where p.recurrence is not null
     and p.recurrence_anchor >= ist_today()
     and p.recurrence_cursor >= p.recurrence_anchor;

  update tasks x
     set recurrence_cursor = x.recurrence_anchor - 1
   where x.recurrence is not null and x.project_id is null
     and x.recurrence_anchor >= ist_today()
     and x.recurrence_cursor >= x.recurrence_anchor;

  -- A source that has already been live - people may have worked on it -
  -- stays a real project as occurrence #1, and a fresh blueprint is cloned
  -- from it to carry the rule from here on.
  perform convert_live_series();
end
$conv$;

drop function convert_live_series();

-- Is this project a blueprint? Copies never carry a rule, so the rule is the mark.
create or replace function is_blueprint_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from projects where id = p_project_id and recurrence is not null);
$$;

-- Is this task part of a blueprint - an individual one, or on a blueprint project?
create or replace function is_blueprint_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tasks t
     where t.id = p_task_id
       and (t.recurrence is not null or is_blueprint_project(t.project_id))
  );
$$;

-- "<name> – November 2026", or the name with [Month] and [Year] filled in.
create or replace function occurrence_name(p_name text, p_day date)
returns text language sql immutable as $$
  select case
    when p_name ~* '\[(month|year)\]' then
      btrim(regexp_replace(regexp_replace(p_name,
        '\[month\]', to_char(p_day, 'FMMonth'), 'gi'),
        '\[year\]', to_char(p_day, 'YYYY'), 'gi'))
    else btrim(p_name) || ' – ' || to_char(p_day, 'FMMonth YYYY')
  end;
$$;

-- --------------------------------------------------- the generator's start --

-- The first occurrence is now a copy like the rest, so a new series starts the
-- day before its first date. A start already in the past never backfills: it
-- picks up from today. The cursor stays the generator's own - a user edit can
-- neither rewind it nor set it.
create or replace function guard_recurrence()
returns trigger language plpgsql set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.recurrence is not null)
     or (tg_op = 'UPDATE' and new.recurrence is distinct from old.recurrence)
     or (tg_op = 'UPDATE' and new.recurrence_paused is distinct from old.recurrence_paused) then
    -- auth.uid() is null for the pg_cron job, which is allowed through.
    if auth.uid() is not null and not is_global_manager() then
      raise exception 'Only Super Admin, Admin or Manager can change a repeat rule.'
        using errcode = '42501';
    end if;
  end if;

  if new.recurrence is null then
    new.recurrence_anchor := null;
    new.recurrence_cursor := null;
    new.recurrence_paused := false;
    return new;
  end if;

  new.recurrence_anchor := new.start_date;

  if tg_op = 'UPDATE' and old.recurrence is not null then
    if auth.uid() is not null then
      new.recurrence_cursor := old.recurrence_cursor;
    end if;
    -- Moving the first date of a series that has produced nothing yet moves
    -- where it starts, earlier included.
    if new.start_date is distinct from old.start_date
       and not exists (
         select 1 from projects where tg_table_name = 'projects' and series_source_id = new.id
         union all
         select 1 from tasks where tg_table_name = 'tasks' and series_source_id = new.id) then
      new.recurrence_cursor :=
        case when new.start_date >= ist_today() then new.start_date - 1 else ist_today() - 1 end;
    end if;
  elsif auth.uid() is not null or new.recurrence_cursor is null then
    new.recurrence_cursor :=
      case when new.start_date >= ist_today() then new.start_date - 1 else ist_today() - 1 end;
  end if;
  return new;
end;
$$;

-- ------------------------------------------------ blueprints stay quiet ----

create or replace function notify_task_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_project text;
begin
  -- Nothing to send for a task that has not been handed to anyone yet.
  if auth.uid() is null or new.assignee_id is null or new.assignee_id = auth.uid() then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then
    return new;
  end if;
  -- A blueprint's tasks are a plan; the assignee hears when a copy is made.
  if new.recurrence is not null or is_blueprint_project(new.project_id) then
    return new;
  end if;

  select name into v_project from projects where id = new.project_id;
  perform notify(
    array[new.assignee_id], 'task_assigned',
    case when tg_op = 'INSERT' then 'New task assigned' else 'Task assigned to you' end,
    '"' || new.title || '"' || coalesce(' in ' || v_project, '') || '.',
    task_href(new.id, new.project_id)
  );
  return new;
end;
$$;

create or replace function notify_due_and_overdue()
returns integer language plpgsql security definer set search_path = public as $$
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
$$;

create or replace function start_timer(p_task_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  select assignee_id into v_owner from tasks where id = p_task_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'Only the assignee can start this timer';
  end if;
  if is_blueprint_task(p_task_id) then
    raise exception 'This task belongs to a repeating blueprint. Work on the copy made for its date.'
      using errcode = '22023';
  end if;

  -- §11.3.1 — one timer per user.
  update time_sessions
     set ended_at = now(), end_reason = 'Switched'
   where profile_id = auth.uid() and ended_at is null;

  insert into time_sessions (task_id, profile_id) values (p_task_id, auth.uid());
  update tasks set status = 'In Progress' where id = p_task_id;
end;
$$;

-- A blueprint's content task gets its slots on each copy, not on the plan.
create or replace function sync_content_slots(p_task_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t tasks%rowtype;
  n integer;
begin
  select * into t from tasks where id = p_task_id;
  if not found or t.project_id is null then
    return;
  end if;

  if t.kind <> 'content' or is_blueprint_project(t.project_id) then
    -- No slots here: empty ones go, written ones become ordinary pieces.
    delete from content_bank c
     where c.task_id = t.id and c.slot is not null and content_is_empty(c);
    update content_bank set slot = null where task_id = t.id and slot is not null;
    return;
  end if;

  -- Lowering the target: empty slots past it go, written ones become extras.
  delete from content_bank c
   where c.task_id = t.id and c.slot > t.content_count and content_is_empty(c);
  update content_bank set slot = null
   where task_id = t.id and slot > t.content_count;

  -- Raising it, or a new task: create whatever is missing.
  for n in 1 .. t.content_count loop
    if not exists (select 1 from content_bank where task_id = t.id and slot = n) then
      insert into content_bank
        (project_id, task_id, slot, title, type, billing_type, created_by)
      values
        (t.project_id, t.id, n, content_slot_title(t.title, n),
         'Static Design', 'Count', t.assignee_id);
    end if;
  end loop;

  -- Empty slots are the assignee's to fill.
  update content_bank c
     set created_by = t.assignee_id
   where c.task_id = t.id and c.slot is not null and content_is_empty(c)
     and c.created_by is distinct from t.assignee_id;
end;
$$;

-- --------------------------------------------------------- the generator --

create or replace function generate_recurring_occurrences()
returns integer language plpgsql security definer set search_path = public as $$
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
          v_name     := occurrence_name(src.name, v_day);

          insert into projects (
            name, color, client_name, start_date, deadline, description, status,
            priority, leader_id, created_by, company_id, client_id, property_id,
            series_source_id, series_index, series_date
          ) values (
            v_name, src.color, src.client_name, v_start, v_deadline, src.description,
            case when src.status in ('Completed', 'Cancelled', 'Archived')
                 then 'Planning'::project_status else src.status end,
            src.priority, src.leader_id, src.created_by,
            src.company_id, src.client_id, src.property_id,
            src.id, v_index, v_day
          ) returning id into v_new;

          insert into project_services (project_id, service)
            select v_new, service from project_services where project_id = src.id;
          insert into project_members (project_id, profile_id)
            select v_new, profile_id from project_members where project_id = src.id;

          -- Same tasks and assignees, fresh state, creation order kept (§9.2).
          -- A content task keeps its kind and count; its slots are laid out
          -- by the tasks trigger (0026).
          for t in
            select * from tasks where project_id = src.id order by created_at, id
          loop
            v_tstart := least(greatest(snap_to_working_day(t.start_date + v_shift), v_start), v_deadline);
            v_due    := least(greatest(snap_to_working_day(t.due_date + v_shift), v_tstart), v_deadline);

            insert into tasks (
              project_id, title, description, department, assignee_id, priority,
              start_date, due_date, estimated_hours, tags, kind, content_count,
              created_by, created_at
            ) values (
              v_new, t.title, t.description, t.department, t.assignee_id, t.priority,
              v_tstart, v_due, t.estimated_hours, t.tags, t.kind, t.content_count,
              t.created_by, clock_timestamp()
            ) returning id into v_task;

            if v_notify and t.assignee_id is not null then
              insert into notifications (profile_id, type, title, body, href)
              values (
                t.assignee_id, 'task_assigned', 'New task assigned',
                '"' || t.title || '" in ' || v_name || '.',
                task_href(v_task, v_new)
              );
            end if;
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
$$;

-- Create whatever is due now, without waiting for 00:05. The app calls this
-- after a blueprint is saved, so one whose first date is today appears at once.
create or replace function run_due_recurrences()
returns integer language plpgsql security definer set search_path = public as $$
begin
  if not is_global_manager() then
    raise exception 'Only Super Admin, Admin or Manager can run repeats.' using errcode = '42501';
  end if;
  return generate_recurring_occurrences();
end;
$$;

-- Blueprints carry no content slots.
do $$
declare
  v_id uuid;
begin
  for v_id in
    select t.id from tasks t join projects p on p.id = t.project_id
     where p.recurrence is not null and t.kind = 'content'
  loop
    perform sync_content_slots(v_id);
  end loop;
end
$$;

notify pgrst, 'reload schema';
