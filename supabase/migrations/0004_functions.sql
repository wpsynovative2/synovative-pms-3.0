-- =============================================================================
-- Synovative PMS — baseline 4/8: functions
--
-- Permission predicates (the SQL half of lib/permissions.ts), workflow steps -
-- timer, submit, review, allot - and trigger functions. Bodies are checked when
-- called rather than when created, so the order here is the order they were
-- introduced, not a dependency order.
-- =============================================================================

set check_function_bodies = off;

create or replace function is_working_day(d date)
 returns boolean
 language sql
 stable
as $function$
  select
    case
      when exists (select 1 from working_overrides w where w.override_date = d) then true
      when extract(dow from d) = 0 then false                       -- Sunday (Saturdays work)
      when exists (select 1 from holidays h where h.holiday_date = d) then false
      else true
    end;
$function$;

-- One round trip for the project detail header (§7.2).
create or replace function project_overview(p_project_id uuid)
 returns table(project_id uuid, total_tasks bigint, approved_tasks bigint, progress_pct numeric, overdue_tasks bigint, seconds_logged numeric, estimated_hours numeric, approved_spend numeric, pending_spend numeric, rejected_spend numeric)
 language sql
 stable
as $function$
  select
    s.project_id, s.total_tasks, s.approved_tasks, s.progress_pct,
    s.overdue_tasks, s.seconds_logged, s.estimated_hours,
    coalesce(e.approved_total, 0),
    coalesce(e.pending_total, 0),
    coalesce(e.rejected_total, 0)
  from project_stats s
  left join project_expense_totals e on e.project_id = s.project_id
  where s.project_id = p_project_id;
$function$;

create or replace function auth_role()
 returns app_role
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select role from profiles where id = auth.uid() and active;
$function$;

create or replace function is_super_admin()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select auth_role() = 'super_admin';
$function$;

create or replace function is_global_manager()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select auth_role() in ('super_admin', 'admin', 'manager');
$function$;

create or replace function is_hr_admin()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select auth_role() in ('super_admin', 'hr_admin');
$function$;

create or replace function is_team_leader()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select auth_role() = 'team_leader';
$function$;

create or replace function my_departments()
 returns text[]
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(array_agg(department), '{}')
  from profile_departments where profile_id = auth.uid();
$function$;

-- Expense approval comes from the department, not the role (§4.1).
create or replace function is_finance()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from profile_departments
    where profile_id = auth.uid() and department = 'Accounts & Finance'
  );
$function$;

create or replace function leads_project(p_project_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from projects where id = p_project_id and leader_id = auth.uid()
  );
$function$;

-- Global managers see everything. Everyone else sees a project they lead or
-- hold a task in; a Team Leader also sees any project their department is
-- working on, so they can follow work they allotted to their team.
create or replace function can_see_project(p_project_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    is_global_manager()
    or exists (select 1 from projects p
               where p.id = p_project_id and p.leader_id = auth.uid())
    or exists (select 1 from tasks t
               where t.project_id = p_project_id and t.assignee_id = auth.uid())
    or (is_team_leader() and exists (
          select 1 from tasks t
           where t.project_id = p_project_id
             and t.department = any (my_departments())));
$function$;

create or replace function can_see_task(p_task_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from tasks t
    where t.id = p_task_id
      and (
        is_global_manager()
        or t.assignee_id = auth.uid()
        or t.created_by  = auth.uid()
        or (t.project_id is not null and can_see_project(t.project_id))
      )
  );
$function$;

-- Project tasks: managers or the project's leader. Individual tasks: managers
-- only. A Team Leader reviews the tasks they allotted themselves, wherever
-- those sit -- seeing a department's project does not make them its reviewer.
create or replace function can_review_task(p_task_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from tasks t
    where t.id = p_task_id
      and (
        is_global_manager()
        or (is_team_leader() and t.created_by = auth.uid())
        or (t.project_id is not null and leads_project(t.project_id))
      )
  );
$function$;

-- §4.2 — full task edit rights (title, dates, assignee, estimate…).
create or replace function can_edit_task(p_task_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from tasks t
    where t.id = p_task_id
      and (
        is_global_manager()
        or (t.project_id is not null and leads_project(t.project_id))
        or (is_team_leader() and t.created_by = auth.uid())
      )
  );
$function$;

-- Callers now pass arrays that may hold a NULL (an unassigned task, a project
-- with no leader). Skip those rather than violating notifications.profile_id.
create or replace function notify(p_profile_ids uuid[], p_type notification_type, p_title text, p_body text, p_href text)
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  insert into notifications (profile_id, type, title, body, href)
  select distinct id, p_type, p_title, p_body, p_href
    from unnest(p_profile_ids) as id
   where id is not null;
$function$;

create or replace function start_timer(p_task_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_owner uuid;
begin
  select assignee_id into v_owner from tasks where id = p_task_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'Only the assignee can start this timer';
  end if;

  -- §11.3.1 — one timer per user.
  update time_sessions
     set ended_at = now(), end_reason = 'Switched'
   where profile_id = auth.uid() and ended_at is null;

  insert into time_sessions (task_id, profile_id) values (p_task_id, auth.uid());
  update tasks set status = 'In Progress' where id = p_task_id;
end;
$function$;

create or replace function pause_timer(p_task_id uuid, p_reason session_end_reason default 'End of day'::session_end_reason, p_note text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update time_sessions
     set ended_at = now(), end_reason = p_reason, end_note = p_note
   where task_id = p_task_id and profile_id = auth.uid() and ended_at is null;
end;
$function$;

create or replace function submit_task(p_task_id uuid, p_output output_location, p_drive_link text, p_description text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_task       tasks%rowtype;
  v_submission uuid;
  v_reviewers  uuid[];
  v_allotter   uuid[];
  v_name       text;
begin
  select * into v_task from tasks where id = p_task_id;
  -- Null-safe on purpose: an unassigned task belongs to nobody, and `<>`
  -- against NULL is NULL, which would let anyone through.
  if v_task.assignee_id is null or v_task.assignee_id <> auth.uid() then
    raise exception 'Only the assignee can submit this task';
  end if;

  update time_sessions
     set ended_at = now(), end_reason = 'Submitted'
   where task_id = p_task_id and profile_id = auth.uid() and ended_at is null;

  insert into submissions (task_id, by_profile_id, output_location, drive_link, description)
  values (p_task_id, auth.uid(), p_output, p_drive_link, p_description)
  returning id into v_submission;

  update tasks set status = 'Submitted' where id = p_task_id;

  -- Project Leader for project tasks; managers for individual tasks.
  if v_task.project_id is null then
    select array_agg(id) into v_reviewers
      from profiles where active and role in ('super_admin', 'admin', 'manager');
  else
    select array[leader_id] into v_reviewers from projects where id = v_task.project_id;
    -- A project with no leader still needs someone to look at the work.
    if v_reviewers[1] is null then
      select array_agg(id) into v_reviewers
        from profiles where active and role in ('super_admin', 'admin', 'manager');
    end if;
  end if;

  -- Whoever allotted the task reviews it too when they are a Team Leader.
  select array_agg(p.id) into v_allotter
    from profiles p where p.id = v_task.created_by and p.role = 'team_leader';

  select full_name into v_name from profiles where id = auth.uid();
  perform notify(
    coalesce(v_reviewers, '{}') || coalesce(v_allotter, '{}'), 'task_submitted',
    'Task submitted for review',
    v_name || ' submitted "' || v_task.title || '".',
    task_href(p_task_id, v_task.project_id)
  );

  return v_submission;
end;
$function$;

-- review_task from 0002, minus its own reassignment notification (the
-- assignment trigger above now sends it) and with links that open the task.
create or replace function review_task(p_task_id uuid, p_decision review_decision, p_remarks text, p_source review_source default null::review_source, p_new_assignee uuid default null::uuid, p_new_due_date date default null::date)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_task      tasks%rowtype;
  v_review    uuid;
  v_last_sub  uuid;
begin
  if not can_review_task(p_task_id) then
    raise exception 'You are not a reviewer for this task';
  end if;

  select * into v_task from tasks where id = p_task_id;

  -- Rejecting hands the work back to someone; with assignees optional there
  -- may be nobody to hand it to.
  if p_decision = 'Rejected'
     and coalesce(p_new_assignee, v_task.assignee_id) is null then
    raise exception 'Choose who should pick this task up before rejecting it';
  end if;

  select id into v_last_sub
    from submissions where task_id = p_task_id
    order by submitted_at desc limit 1;

  insert into reviews (
    task_id, submission_id, by_profile_id, decision, source, remarks,
    new_assignee_id, new_due_date
  ) values (
    p_task_id, v_last_sub, auth.uid(), p_decision, p_source, p_remarks,
    case when p_decision = 'Rejected' then coalesce(p_new_assignee, v_task.assignee_id) end,
    case when p_decision = 'Rejected' then p_new_due_date end
  ) returning id into v_review;

  if p_decision = 'Approved' then
    update tasks set status = 'Approved' where id = p_task_id;
  elsif p_decision = 'Changes Required' then
    update tasks set status = 'Changes Required' where id = p_task_id;
  elsif p_decision = 'Waiting for Client Response' then
    -- The assignee is finished and nothing is owed here. The task stays
    -- reviewable so whoever parked it settles it once the client answers.
    update tasks set status = 'Waiting for Client Response' where id = p_task_id;
  else
    update tasks
       set status      = 'Not Started',
           assignee_id = coalesce(p_new_assignee, v_task.assignee_id),
           due_date    = coalesce(p_new_due_date, v_task.due_date)
     where id = p_task_id;
  end if;

  perform notify(
    array[v_task.assignee_id], 'review_decision',
    'Review: ' || p_decision,
    '"' || v_task.title || '" was marked ' || p_decision || '.',
    task_href(p_task_id, v_task.project_id)
  );

  return v_review;
end;
$function$;

create or replace function review_expense(p_expense_id uuid, p_approved boolean, p_remarks text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_expense expenses%rowtype;
  v_leader  uuid;
begin
  if not is_finance() then
    raise exception 'Only Accounts & Finance can verify expenses';
  end if;

  select * into v_expense from expenses where id = p_expense_id;

  update expenses
     set status          = case when p_approved then 'Approved' else 'Rejected' end,
         finance_remarks = p_remarks,
         reviewed_by     = auth.uid(),
         reviewed_at     = now()
   where id = p_expense_id;

  select leader_id into v_leader from projects where id = v_expense.project_id;
  perform notify(
    array[v_leader], 'expense_reviewed',
    'Expense ' || case when p_approved then 'approved' else 'rejected' end,
    '₹' || v_expense.amount::text || ' — ' || v_expense.description || '.',
    '/expenses?expense=' || p_expense_id
  );
end;
$function$;

create or replace function auto_stop_timers()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_stopped integer;
begin
  with closed as (
    update time_sessions s
       set ended_at   = now(),
           end_reason = 'Auto-stopped'
     where s.ended_at is null
    returning s.task_id, s.profile_id
  )
  insert into notifications (profile_id, type, title, body, href)
  select
    c.profile_id,
    'timer_autostop',
    'Timer auto-stopped at 11:59 PM',
    'Your timer on "' || t.title || '" was stopped automatically.',
    '/tasks?task=' || c.task_id
  from closed c
  join tasks t on t.id = c.task_id;

  get diagnostics v_stopped = row_count;
  return v_stopped;
end;
$function$;

-- The daily 9:00 AM IST sweep: skip tasks nobody holds, and use the same
-- definition of "late" the app shows.
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

-- Next working day at or after d (§5.4), with no "past date" rule, so work
-- caught up late keeps its real date.
create or replace function snap_to_working_day(d date)
 returns date
 language plpgsql
 stable
as $function$
declare
  v_day date := d;
begin
  for i in 1..400 loop
    if is_working_day(v_day) then
      return v_day;
    end if;
    v_day := v_day + 1;
  end loop;
  return v_day;
end;
$function$;

-- Does the rule fire on d? Same logic as matchesRule() in lib/recurrence.ts.
-- Weeks start on Monday (date_trunc 'week' is ISO).
create or replace function recurrence_matches(rule jsonb, anchor date, d date)
 returns boolean
 language plpgsql
 immutable
as $function$
declare
  n      integer := greatest(1, coalesce((rule ->> 'interval')::integer, 1));
  mode   text    := coalesce(rule ->> 'monthlyMode', 'monthday');
  months integer;
  days   integer[];
begin
  if d < anchor then return false; end if;
  if d = anchor then return true; end if;

  case rule ->> 'freq'
    when 'daily' then
      return (d - anchor) % n = 0;

    when 'weekly' then
      if jsonb_typeof(rule -> 'weekdays') = 'array'
         and jsonb_array_length(rule -> 'weekdays') > 0 then
        select array_agg(value::integer) into days
          from jsonb_array_elements_text(rule -> 'weekdays');
      else
        days := array[extract(dow from anchor)::integer];
      end if;
      if not (extract(dow from d)::integer = any (days)) then
        return false;
      end if;
      return ((date_trunc('week', d::timestamp)::date
               - date_trunc('week', anchor::timestamp)::date) / 7) % n = 0;

    when 'monthly' then
      months := (extract(year from d)::integer - extract(year from anchor)::integer) * 12
              + (extract(month from d)::integer - extract(month from anchor)::integer);
      if months % n <> 0 then return false; end if;
      if mode = 'monthday' then
        return extract(day from d) = extract(day from anchor);
      end if;
      if extract(dow from d) <> extract(dow from anchor) then return false; end if;
      if mode = 'nthWeekday' then
        return (extract(day from d)::integer - 1) / 7
             = (extract(day from anchor)::integer - 1) / 7;
      end if;
      -- lastWeekday: a week later is already next month.
      return extract(month from d + 7) <> extract(month from d);

    when 'yearly' then
      return (extract(year from d)::integer - extract(year from anchor)::integer) % n = 0
         and extract(month from d) = extract(month from anchor)
         and extract(day from d)   = extract(day from anchor);

    else
      return false;
  end case;
end;
$function$;

-- Setting a repeat rule is Super Admin / Admin / Manager only, and so is
-- pausing one: both decide whether work appears for the whole team.
create or replace function guard_recurrence()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
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
    -- Nothing left to pause once the rule is gone.
    new.recurrence_paused := false;
    return new;
  end if;

  new.recurrence_anchor := new.start_date;
  -- The cursor belongs to the generator: a user edit can never rewind it and
  -- make old occurrences come back.
  if tg_op = 'UPDATE' and auth.uid() is not null and old.recurrence is not null then
    new.recurrence_cursor := old.recurrence_cursor;
  end if;
  if new.recurrence_cursor is null then
    new.recurrence_cursor :=
      case when new.start_date >= ist_today() then new.start_date else ist_today() - 1 end;
  end if;
  return new;
end;
$function$;

-- Materialise every occurrence that has come due, up to today (IST).
-- Occurrences that snap onto the same working day (a daily rule over a weekend)
-- produce a single copy. Returns the number of projects + tasks created.
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
begin
  -- ----------------------------------------------------------- projects --
  for src in
    select * from projects
     where recurrence is not null and recurrence_cursor < v_today
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

        if v_day > src.recurrence_cursor then
          v_start := snap_to_working_day(v_day);
          if v_start <> src.start_date and not exists (
               select 1 from projects p
                where p.series_source_id = src.id and p.start_date = v_start) then
            v_shift    := v_start - src.start_date;
            v_deadline := src.deadline + v_shift;
            v_name     := src.name || ' · ' || to_char(v_start, 'FMDD Mon YYYY');

            insert into projects (
              name, color, client_name, start_date, deadline, description, status,
              priority, leader_id, created_by, series_source_id, series_index, series_date
            ) values (
              v_name, src.color, src.client_name, v_start, v_deadline, src.description,
              case when src.status in ('Completed', 'Cancelled', 'Archived')
                   then 'Planning'::project_status else src.status end,
              src.priority, src.leader_id, src.created_by, src.id, v_index, v_day
            ) returning id into v_new;

            insert into project_services (project_id, service)
              select v_new, service from project_services where project_id = src.id;
            insert into project_members (project_id, profile_id)
              select v_new, profile_id from project_members where project_id = src.id;

            -- Same tasks, same assignees, fresh state; creation order kept (§9.2).
            for t in
              select * from tasks where project_id = src.id order by created_at
            loop
              v_tstart := least(greatest(snap_to_working_day(t.start_date + v_shift), v_start), v_deadline);
              v_due    := least(greatest(snap_to_working_day(t.due_date + v_shift), v_tstart), v_deadline);

              insert into tasks (
                project_id, title, description, department, assignee_id, priority,
                start_date, due_date, estimated_hours, tags, created_by, created_at
              ) values (
                v_new, t.title, t.description, t.department, t.assignee_id, t.priority,
                v_tstart, v_due, t.estimated_hours, t.tags, t.created_by, clock_timestamp()
              ) returning id into v_task;

              insert into notifications (profile_id, type, title, body, href)
              values (
                t.assignee_id, 'task_assigned', 'New task assigned',
                '"' || t.title || '" in ' || v_name || '.',
                '/projects/' || v_new || '?task=' || v_task
              );
              v_created := v_created + 1;
            end loop;

            v_created := v_created + 1;
          end if;
        end if;
      end if;
      v_day := v_day + 1;
    end loop;

    update projects set recurrence_cursor = v_today where id = src.id;
  end loop;

  -- --------------------------------------------------- individual tasks --
  for src in
    select * from tasks
     where recurrence is not null and project_id is null and recurrence_cursor < v_today
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

        if v_day > src.recurrence_cursor then
          v_start := snap_to_working_day(v_day);
          if v_start <> src.start_date and not exists (
               select 1 from tasks x
                where x.series_source_id = src.id and x.start_date = v_start) then
            v_shift := v_start - src.start_date;
            v_due   := greatest(snap_to_working_day(src.due_date + v_shift), v_start);

            insert into tasks (
              project_id, title, description, department, assignee_id, priority,
              start_date, due_date, estimated_hours, tags, created_by, created_at,
              series_source_id, series_index, series_date
            ) values (
              null, src.title, src.description, src.department, src.assignee_id, src.priority,
              v_start, v_due, src.estimated_hours, src.tags, src.created_by, clock_timestamp(),
              src.id, v_index, v_day
            ) returning id into v_task;

            insert into notifications (profile_id, type, title, body, href)
            values (
              src.assignee_id, 'task_assigned', 'New task assigned',
              '"' || src.title || '" — repeat #' || v_index || ', due '
                || to_char(v_due, 'FMDD Mon YYYY') || '.',
              '/individual-tasks?task=' || v_task
            );
            v_created := v_created + 1;
          end if;
        end if;
      end if;
      v_day := v_day + 1;
    end loop;

    update tasks set recurrence_cursor = v_today where id = src.id;
  end loop;

  return v_created;
end;
$function$;

-- Individual tasks now live on /tasks behind a type filter rather than on their
-- own page, so notifications must land there. Links already written to the
-- notifications table keep pointing at /individual-tasks, which the app still
-- serves as a redirect.
create or replace function task_href(p_task_id uuid, p_project_id uuid)
 returns text
 language sql
 immutable
as $function$
  select case
    when p_project_id is null then '/tasks?type=individual&task=' || p_task_id
    else '/projects/' || p_project_id || '?task=' || p_task_id
  end;
$function$;

-- Capacity drives workload and over-allocation warnings, so it belongs with the
-- people who manage accounts - not with the person whose capacity it is.
create or replace function guard_profile_update()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_actor app_role := auth_role();
  v_manager boolean := v_actor in ('super_admin', 'admin', 'hr_admin');
begin
  if auth.uid() is null then
    return new;
  end if;

  if not v_manager then
    if new.role is distinct from old.role
       or new.active is distinct from old.active
       or new.email is distinct from old.email
       or new.capacity_hours_per_day is distinct from old.capacity_hours_per_day
       or (new.must_change_password and not old.must_change_password) then
      raise exception 'You can only change your own name and password.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.role = 'super_admin' and v_actor <> 'super_admin' then
    raise exception 'Only a Super Admin can change a Super Admin account.'
      using errcode = '42501';
  end if;

  -- An HR Admin manages staff accounts, not the people who manage them.
  if old.role = 'admin' and v_actor not in ('super_admin', 'admin') then
    raise exception 'Only a Super Admin or an Admin can change an Admin account.'
      using errcode = '42501';
  end if;

  if new.role is distinct from old.role
     and (new.role in ('admin', 'super_admin') or old.role in ('admin', 'super_admin'))
     and v_actor <> 'super_admin' then
    raise exception 'Only a Super Admin can grant or remove the Admin role.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

-- Direct inserts go through the server route; keep role grants honest there too.
create or replace function guard_profile_insert()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if auth.uid() is not null
     and new.role in ('admin', 'super_admin')
     and auth_role() <> 'super_admin' then
    raise exception 'Only a Super Admin can grant the Admin role.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

-- §17 "Task assigned or reassigned → new assignee". Covers direct creates and
-- edits as well as rejections that reassign (review_task below no longer sends
-- its own copy). Skipped for the scheduled generator, which writes its own
-- notification, and when someone assigns a task to themselves.
create or replace function notify_task_assignment()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  select name into v_project from projects where id = new.project_id;
  perform notify(
    array[new.assignee_id], 'task_assigned',
    case when tg_op = 'INSERT' then 'New task assigned' else 'Task assigned to you' end,
    '"' || new.title || '"' || coalesce(' in ' || v_project, '') || '.',
    task_href(new.id, new.project_id)
  );
  return new;
end;
$function$;

-- §17 "Remark added by assignee → reviewers".
create or replace function notify_remark()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_task      tasks%rowtype;
  v_reviewers uuid[];
  v_name      text;
begin
  select * into v_task from tasks where id = new.task_id;
  if v_task.assignee_id is distinct from new.by_profile_id then
    return new;
  end if;

  if v_task.project_id is null then
    select array_agg(id) into v_reviewers
      from profiles where active and role in ('super_admin', 'admin', 'manager');
  else
    select array[leader_id] into v_reviewers from projects where id = v_task.project_id;
  end if;

  select full_name into v_name from profiles where id = new.by_profile_id;
  perform notify(
    coalesce(v_reviewers, '{}'), 'remark_added', 'New remark on a task',
    coalesce(v_name, 'The assignee') || ' added a remark on "' || v_task.title || '".',
    task_href(v_task.id, v_task.project_id)
  );
  return new;
end;
$function$;

-- §17 "Expense added → Accounts & Finance".
create or replace function notify_expense_added()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_finance uuid[];
  v_project text;
begin
  select array_agg(distinct p.id) into v_finance
    from profiles p
    join profile_departments d on d.profile_id = p.id
   where p.active and d.department = 'Accounts & Finance';

  select name into v_project from projects where id = new.project_id;
  perform notify(
    coalesce(v_finance, '{}'), 'expense_added', 'New expense to verify',
    '₹' || new.amount::text || ' — ' || new.description
      || coalesce(' (' || v_project || ')', '') || '.',
    '/expenses?expense=' || new.id
  );
  return new;
end;
$function$;

-- 0002 let *any* authenticated login read the directory, vendors, templates
-- and the calendar. Supabase logins are per project, so in a project shared
-- with another app (or for a deactivated account) that is too wide. These
-- reads now require an active PMS profile.
create or replace function is_active_member()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (select 1 from profiles where id = auth.uid() and active);
$function$;

create or replace function touch_operational_link()
 returns trigger
 language plpgsql
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

-- A task is late only while the delay is still ours. Approved work is done;
-- work parked with the client is waiting on them; and work submitted on or
-- before its due date is waiting on a reviewer. Anything else past its due
-- date is genuinely late.
create or replace function task_is_overdue(p_task_id uuid, p_status task_status, p_due_date date)
 returns boolean
 language sql
 stable
 set search_path to 'public'
as $function$
  select case
    when p_status in ('Approved', 'Waiting for Client Response') then false
    when p_due_date >= current_date then false
    when p_status = 'Submitted' and (
      select max(s.submitted_at) from submissions s where s.task_id = p_task_id
    )::date <= p_due_date then false
    else true
  end;
$function$;

-- Walks the cursor of every paused series up to today, so the dates that passed
-- while it was paused are behind the cursor and will never be generated. Runs
-- immediately before the generator each night.
create or replace function skip_paused_recurrences()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_today   date := ist_today();
  v_skipped integer := 0;
  v_rows    integer;
begin
  update projects set recurrence_cursor = v_today
   where recurrence is not null and recurrence_paused and recurrence_cursor < v_today;
  get diagnostics v_rows = row_count;
  v_skipped := v_skipped + v_rows;

  update tasks set recurrence_cursor = v_today
   where recurrence is not null and recurrence_paused and recurrence_cursor < v_today;
  get diagnostics v_rows = row_count;
  v_skipped := v_skipped + v_rows;

  return v_skipped;
end;
$function$;

-- Like is_finance(): the right comes from the department, not the role.
create or replace function is_business_exec()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from profile_departments
    where profile_id = auth.uid()
      and department = 'Business Development Executives'
  );
$function$;

create or replace function is_content_writer()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from profile_departments
    where profile_id = auth.uid()
      and department = 'Content Writers / Copywriters / Brand Strategists'
  );
$function$;

-- Add and edit the master records that feed a project.
create or replace function can_manage_crm()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select is_global_manager() or is_business_exec();
$function$;

-- Deleting is deliberately narrower than editing: these records are referenced
-- by projects that may already be running.
create or replace function can_delete_crm()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select auth_role() in ('super_admin', 'admin');
$function$;

-- Only Super Admin, Admin and Manager convert an OBC, even though a Business
-- Executive may edit everything else about it.
create or replace function guard_obc_conversion()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' and new.status = 'Converted' and old.status is distinct from 'Converted' then
    if auth.uid() is not null and not is_global_manager() then
      raise exception 'Only a Super Admin, Admin or Manager can turn an OBC into a project.'
        using errcode = '42501';
    end if;
    new.converted_at := coalesce(new.converted_at, now());
  end if;
  if tg_op = 'UPDATE' and new.status = 'Submitted' and old.status is distinct from 'Submitted' then
    new.submitted_at := coalesce(new.submitted_at, now());
  end if;
  return new;
end;
$function$;

-- Can this user see the record a comment or a set of minutes hangs off? The
-- master records are readable by every active member; projects and tasks keep
-- the visibility rules they already have.
create or replace function can_see_entity(p_type collab_entity, p_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case p_type
    when 'project' then can_see_project(p_id)
    when 'task'    then can_see_task(p_id)
    else is_active_member()
  end;
$function$;

create or replace function touch_updated_at()
 returns trigger
 language plpgsql
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

-- Tell someone a piece of content has been put in their name. Nothing is sent
-- for content a writer allots to themselves.
create or replace function notify_content_allotment()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_project text;
begin
  if auth.uid() is null or new.allotted_to is null or new.allotted_to = auth.uid() then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.allotted_to is not distinct from old.allotted_to then
    return new;
  end if;

  select name into v_project from projects where id = new.project_id;

  perform notify(
    array[new.allotted_to],
    'content_allotted',
    'Content allotted to you',
    new.type::text || ' for ' || coalesce(v_project, 'a project'),
    '/content-bank?entry=' || new.id
  );
  return new;
end;
$function$;

-- The other author desk. Kept as its own predicate so the two rights stay
-- separately readable, the way is_finance() and is_business_exec() are.
create or replace function is_smm()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from profile_departments
    where profile_id = auth.uid()
      and department = 'Social Media Marketing'
  );
$function$;

-- Who may put words in the Content Bank.
create or replace function can_write_content()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select is_content_writer() or is_smm();
$function$;

-- "A Business Executive raises the OBC; only a manager turns it into work"
-- (0014). That rule lived on obcs.status, which is no longer where the
-- decision is made - allotting a line is. Guard the columns themselves.
create or replace function guard_obc_item_allotment()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
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
$function$;

-- An OBC reads as Converted ("Allotted" on screen) only while every delivery
-- service has somewhere to be. Raising work sets that explicitly - the caller
-- is a manager, so it passes guard_obc_conversion. Losing an allotment is what
-- needs automating: deleting a project blanks its services by foreign key, and
-- whoever deleted it may not be a manager, so only the downgrade happens here.
create or replace function relax_obc_on_unallotment()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
$function$;

-- "A Business Executive raises the OBC; only a manager turns it into work"
-- (0014). The Executive owns this list - they write it - but not where any of
-- it is sent.
create or replace function guard_obc_service_allotment()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
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
$function$;

-- Who may hand a piece on. Kept as one predicate so the two functions below,
-- and lib/permissions.ts canAllotContent, read the same rule.
create or replace function can_manage_content(p_content_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from content_bank c
     where c.id = p_content_id
       and (
         c.created_by = auth.uid()
         or is_global_manager()
         or leads_project(c.project_id)
         or (c.task_id is not null and can_review_task(c.task_id))
       )
  );
$function$;

create or replace function allot_content(p_content_id uuid, p_profile_id uuid, p_task_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_project uuid;
begin
  select project_id into v_project from content_bank where id = p_content_id;
  if v_project is null then
    raise exception 'That content no longer exists.' using errcode = 'P0002';
  end if;
  if not can_allot_content(v_project) then
    raise exception 'Only a manager, the Project Leader or a Team Leader can allot content.'
      using errcode = '42501';
  end if;

  -- Taking a piece back clears both halves together.
  if p_profile_id is null then
    update content_bank set allotted_to = null, allotted_task_id = null where id = p_content_id;
    return;
  end if;

  if not exists (select 1 from profiles where id = p_profile_id and active) then
    raise exception 'That team member is not active.' using errcode = '22023';
  end if;
  if p_task_id is null then
    raise exception 'Pick or create the task this piece is for.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from tasks
     where id = p_task_id and project_id = v_project and assignee_id = p_profile_id
  ) then
    raise exception 'That task is not theirs on this project.' using errcode = '22023';
  end if;

  -- notify_content_allotment (0014) tells the new holder.
  update content_bank
     set allotted_to = p_profile_id, allotted_task_id = p_task_id
   where id = p_content_id;
end;
$function$;

create or replace function set_content_stage(p_content_id uuid, p_stage content_stage)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_project uuid;
  v_allotted uuid;
begin
  select project_id, allotted_to into v_project, v_allotted
    from content_bank where id = p_content_id;
  if v_project is null then
    raise exception 'That content no longer exists.' using errcode = 'P0002';
  end if;
  if not (
    can_manage_content(p_content_id)
    or v_allotted = auth.uid()
    or (can_write_content() and can_see_project(v_project))
  ) then
    raise exception 'You cannot change where this content has got to.' using errcode = '42501';
  end if;

  update content_bank set stage = p_stage where id = p_content_id;
end;
$function$;

-- Who may hand a piece on. Mirrors lib/permissions.ts canAllotContent.
create or replace function can_allot_content(p_project_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select is_global_manager() or leads_project(p_project_id) or is_team_leader();
$function$;

-- The writer's own insert and update policies (0014, 0018) would otherwise
-- still let them set allotted_to on their piece directly. Allotment changes
-- are refused unless the caller may allot - allot_content() passes this,
-- because auth.uid() inside it is still the caller.
create or replace function guard_content_allotment()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    return new;
  end if;
  -- Deleting the allotted task blanks the link by foreign key, and whoever
  -- deleted the task need not be someone who may allot.
  if tg_op = 'UPDATE'
     and new.allotted_to is not distinct from old.allotted_to
     and new.allotted_task_id is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if (new.allotted_to is not null or new.allotted_task_id is not null)
       and not can_allot_content(new.project_id) then
      raise exception 'Only a manager, the Project Leader or a Team Leader can allot content.'
        using errcode = '42501';
    end if;
  elsif (new.allotted_to is distinct from old.allotted_to
         or new.allotted_task_id is distinct from old.allotted_task_id)
        and not can_allot_content(new.project_id) then
    raise exception 'Only a manager, the Project Leader or a Team Leader can allot content.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

-- Has anything been written in this piece? Mirrors isContentEmpty in
-- lib/types.ts: rich text counts as empty once its tags are stripped.
create or replace function content_is_empty(c content_bank)
 returns boolean
 language sql
 immutable
as $function$
  select btrim(regexp_replace(coalesce(c.on_pic, ''), '<[^>]*>|&nbsp;', '', 'g')) = ''
     and btrim(regexp_replace(coalesce(c.description, ''), '<[^>]*>|&nbsp;', '', 'g')) = ''
     and btrim(coalesce(c.caption, '')) = ''
     and coalesce(array_length(c.reference_links, 1), 0) = 0;
$function$;

create or replace function content_slot_title(p_task_title text, p_slot integer)
 returns text
 language sql
 immutable
as $function$
  select left(btrim(p_task_title), 180) || ' Count ' || p_slot;
$function$;

-- Bring one task's slots in line with its kind, target, assignee and title.
create or replace function sync_content_slots(p_task_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  t tasks%rowtype;
  n integer;
begin
  select * into t from tasks where id = p_task_id;
  if not found or t.project_id is null then
    return;
  end if;

  if t.kind <> 'content' then
    -- No longer a batch: empty slots go, written ones become ordinary pieces.
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
$function$;

create or replace function tasks_sync_content_slots()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' then
    if new.kind is not distinct from old.kind
       and new.content_count is not distinct from old.content_count
       and new.assignee_id is not distinct from old.assignee_id
       and new.title is not distinct from old.title then
      return null;
    end if;
    -- Slots still wearing the generated name follow a renamed task.
    if new.title is distinct from old.title then
      update content_bank
         set title = content_slot_title(new.title, slot)
       where task_id = new.id and slot is not null
         and title = content_slot_title(old.title, slot);
    end if;
  end if;
  perform sync_content_slots(new.id);
  return null;
end;
$function$;

-- A deleted task takes its empty slots with it; written pieces stay in the
-- library, as they always did (task_id is set null by the foreign key).
create or replace function tasks_drop_empty_slots()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  delete from content_bank c
   where c.task_id = old.id and c.slot is not null and content_is_empty(c);
  return old;
end;
$function$;

-- A slot is part of what the task asked for; it is cleared, not deleted.
-- The functions above remove slots themselves and are let through.
create or replace function guard_content_slot_delete()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if old.slot is not null and pg_trigger_depth() = 1 and auth.uid() is not null then
    raise exception 'This piece is one the task asked for. Clear it instead of deleting it.'
      using errcode = '42501';
  end if;
  return old;
end;
$function$;

set check_function_bodies = on;
