-- Create a repeat now (asked for on 20 Nov 2026): a button on each blueprint in
-- Recurrence makes its project or task today instead of waiting for its date,
-- after asking what happens to the upcoming date:
--
-- * Skip the upcoming date (p_skip_next). The copy made now IS that occurrence,
--   brought forward: it takes the upcoming date as its series_date, its number
--   and its name ("- Dec 2026"), so the 00:05 run finds it already made and
--   creates nothing on that date. The date after it is the next one.
-- * Keep the upcoming date. The copy made now is an extra one, named for today
--   and numbered as the latest repeat so far; the upcoming date still creates
--   its own as usual.
--
-- Either way the copy starts today (or the next working day) and everything
-- else - deadline, tasks, assignees, content tasks, dependencies - is laid out
-- exactly as a scheduled copy, because both now go through the same two
-- functions: make_project_occurrence and make_task_occurrence, taken out of
-- generate_recurring_occurrences (0044), which is redefined to use them and
-- otherwise behaves as before.
--
-- Paused blueprints can be created now too; pausing still skips their dates.
-- Super Admin, Admin and Manager only, like the rest of Recurrence
-- (canSetRecurrence). Called by createOccurrenceNow in lib/store.tsx.

-- One copy of a repeating project: the project, its services, members, tasks
-- and their dependencies. p_day is the date the rule produced (series_date),
-- p_start the day the copy starts.
create or replace function make_project_occurrence(
  p_source_id uuid, p_day date, p_index integer, p_start date, p_name text, p_notify boolean)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  src        projects%rowtype;
  t          record;
  v_shift    integer;
  v_deadline date;
  v_due      date;
  v_tstart   date;
  v_new      uuid;
  v_task     uuid;
  -- Blueprint task id -> the id of its copy in this occurrence.
  v_copies   jsonb := '{}'::jsonb;
begin
  select * into src from projects where id = p_source_id;
  v_shift    := p_start - src.start_date;
  v_deadline := greatest(src.deadline + v_shift, p_start);

  insert into projects (
    name, color, client_name, start_date, deadline, description, status,
    priority, leader_id, created_by, company_id, client_id, property_id,
    series_source_id, series_index, series_date, step_by_step
  ) values (
    p_name, src.color, src.client_name, p_start, v_deadline, src.description,
    case when src.status in ('Completed', 'Cancelled', 'Archived')
         then 'Planning'::project_status else src.status end,
    src.priority, src.leader_id, src.created_by,
    src.company_id, src.client_id, src.property_id,
    src.id, p_index, p_day, src.step_by_step
  ) returning id into v_new;

  insert into project_services (project_id, service)
    select v_new, service from project_services where project_id = src.id;
  insert into project_members (project_id, profile_id)
    select v_new, profile_id from project_members where project_id = src.id;

  -- Same tasks and assignees, fresh state, creation order kept (§9.2). A
  -- content task keeps its kind, count, types and placements; its slots are
  -- laid out by the tasks trigger (0026).
  for t in
    select * from tasks where project_id = src.id order by created_at, id
  loop
    v_tstart := least(greatest(snap_to_working_day(t.start_date + v_shift), p_start), v_deadline);
    v_due    := least(greatest(snap_to_working_day(t.due_date + v_shift), v_tstart), v_deadline);

    insert into tasks (
      project_id, title, description, department, assignee_id, priority,
      start_date, due_date, estimated_hours, tags, kind, content_count,
      content_types, content_placements, created_by, created_at, duration_days
    ) values (
      v_new, t.title, t.description, t.department, t.assignee_id, t.priority,
      v_tstart, v_due, t.estimated_hours, t.tags, t.kind, t.content_count,
      t.content_types, t.content_placements, t.created_by, clock_timestamp(), t.duration_days
    ) returning id into v_task;

    v_copies := v_copies || jsonb_build_object(t.id::text, v_task::text);

    if p_notify and t.assignee_id is not null then
      insert into notifications (profile_id, type, title, body, href)
      values (
        t.assignee_id, 'task_assigned', 'New task assigned',
        '"' || t.title || '" in ' || p_name || '.',
        task_href(v_task, v_new)
      );
    end if;
  end loop;

  -- Once every task exists, and in creation order, so a chain is projected
  -- from its head down.
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

  return v_new;
end;
$function$;

-- One copy of a repeating individual task.
create or replace function make_task_occurrence(
  p_source_id uuid, p_day date, p_index integer, p_start date, p_name text, p_notify boolean)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  src    tasks%rowtype;
  v_due  date;
  v_task uuid;
begin
  select * into src from tasks where id = p_source_id;
  v_due := greatest(snap_to_working_day(src.due_date + (p_start - src.start_date)), p_start);

  insert into tasks (
    project_id, title, description, department, assignee_id, priority,
    start_date, due_date, estimated_hours, tags, created_by, created_at,
    series_source_id, series_index, series_date,
    company_id, property_id, client_ids
  ) values (
    null, p_name, src.description, src.department, src.assignee_id, src.priority,
    p_start, v_due, src.estimated_hours, src.tags, src.created_by, clock_timestamp(),
    src.id, p_index, p_day,
    src.company_id, src.property_id, src.client_ids
  ) returning id into v_task;

  if p_notify and src.assignee_id is not null then
    insert into notifications (profile_id, type, title, body, href)
    values (
      src.assignee_id, 'task_assigned', 'New task assigned',
      '"' || p_name || '", due ' || to_char(v_due, 'FMDD Mon YYYY') || '.',
      task_href(v_task, null)
    );
  end if;
  return v_task;
end;
$function$;

-- generate_recurring_occurrences as in 0044, making each copy through the two
-- functions above.
create or replace function generate_recurring_occurrences()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_today   date := ist_today();
  v_created integer := 0;
  src       record;
  v_type    text;
  v_until   date;
  v_count   integer;
  v_day     date;
  v_index   integer;
  -- A user who saves a blueprint due today runs this themselves; the
  -- assignment trigger then tells the assignees, so only the cron run (no
  -- signed-in user) writes its own notifications.
  v_notify  boolean := auth.uid() is null;
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
          -- An "upcoming month" blueprint names each copy for the month after (0029).
          perform make_project_occurrence(
            src.id, v_day, v_index, snap_to_working_day(v_day),
            occurrence_name(src.name, title_day(src.title_month, v_day), src.property_id),
            v_notify);
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
          perform make_task_occurrence(
            src.id, v_day, v_index, snap_to_working_day(v_day),
            occurrence_name(src.title, v_day, src.property_id),
            v_notify);
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

-- Where a blueprint stands on p_after: how many of its dates have come
-- (last_index), and its next date after p_after that has no copy yet - one
-- already brought forward is passed over - with that date's number.
create or replace function recurrence_position(
  p_kind text, p_source_id uuid, p_rule jsonb, p_anchor date, p_after date,
  out last_index integer, out next_day date, out next_index integer)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_type  text := p_rule -> 'ends' ->> 'type';
  v_until date := case when v_type = 'on' then (p_rule -> 'ends' ->> 'date')::date end;
  v_count integer := case when v_type = 'after' then (p_rule -> 'ends' ->> 'count')::integer end;
  v_day   date := p_anchor;
  v_index integer := 0;
begin
  last_index := 0;
  -- Ten years ahead is as far as anyone plans.
  while v_day <= p_after + 3660 loop
    exit when v_type = 'on' and v_day > v_until;
    if recurrence_matches(p_rule, p_anchor, v_day) then
      v_index := v_index + 1;
      exit when v_type = 'after' and v_index > v_count;
      if v_day <= p_after then
        last_index := v_index;
      elsif not (case p_kind
                   when 'project' then exists (select 1 from projects p
                                               where p.series_source_id = p_source_id
                                                 and p.series_date = v_day)
                   else exists (select 1 from tasks x
                                 where x.series_source_id = p_source_id
                                   and x.series_date = v_day)
                 end) then
        next_day   := v_day;
        next_index := v_index;
        return;
      end if;
    end if;
    v_day := v_day + 1;
  end loop;
end;
$function$;

create or replace function create_occurrence_now(p_kind text, p_source_id uuid, p_skip_next boolean)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_today date;
  v_rule  jsonb;
  v_anch  date;
  v_cur   date;
  v_name  text;
  v_month text;
  v_prop  uuid;
  v_pos   record;
  v_day   date;
  v_index integer;
begin
  if not is_global_manager() then
    raise exception 'Only Super Admin, Admin or Manager can create a repeat now.' using errcode = '42501';
  end if;
  if p_kind not in ('project', 'task') then
    raise exception 'Unknown kind of repeat.' using errcode = '22023';
  end if;

  -- Whatever is already due first, so "upcoming" means after today.
  perform generate_recurring_occurrences();
  v_today := ist_today();

  if p_kind = 'project' then
    select recurrence, recurrence_anchor, recurrence_cursor, name, title_month, property_id
      into v_rule, v_anch, v_cur, v_name, v_month, v_prop
      from projects where id = p_source_id and recurrence is not null
       for update;
  else
    select recurrence, recurrence_anchor, recurrence_cursor, title, null, property_id
      into v_rule, v_anch, v_cur, v_name, v_month, v_prop
      from tasks where id = p_source_id and recurrence is not null and project_id is null
       for update;
  end if;
  if not found then
    raise exception 'That repeat no longer exists.' using errcode = 'P0002';
  end if;

  select * into v_pos
    from recurrence_position(p_kind, p_source_id, v_rule, v_anch, greatest(v_cur, v_today));

  if p_skip_next then
    if v_pos.next_day is null then
      raise exception 'This repeat has no upcoming date left to bring forward.' using errcode = '22023';
    end if;
    v_day   := v_pos.next_day;
    v_index := v_pos.next_index;
  else
    v_day   := v_today;
    v_index := greatest(v_pos.last_index, 1);
  end if;

  if p_kind = 'project' then
    return make_project_occurrence(
      p_source_id, v_day, v_index, snap_to_working_day(v_today),
      occurrence_name(v_name, title_day(v_month, v_day), v_prop), false);
  end if;
  return make_task_occurrence(
    p_source_id, v_day, v_index, snap_to_working_day(v_today),
    occurrence_name(v_name, v_day, v_prop), false);
end;
$function$;

-- The building blocks are not called from the app.
revoke all on function make_project_occurrence(uuid, date, integer, date, text, boolean)
  from public, anon, authenticated;
revoke all on function make_task_occurrence(uuid, date, integer, date, text, boolean)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
