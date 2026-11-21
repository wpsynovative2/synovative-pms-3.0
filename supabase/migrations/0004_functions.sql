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
-- hold a task in. A Team Leader also sees any project their department is
-- working on and any they are listed on in project_members; the content desks'
-- Team Leaders see every project with a content task; the 3D Artists' Team
-- Leader and Business Development see every 3D project. my_project_ids()
-- answers the same question for read policies - change both together
-- (ARCHITECTURE.md §11).
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
             and t.department = any (my_departments())))
    or (is_team_leader() and exists (
          select 1 from project_members m
           where m.project_id = p_project_id and m.profile_id = auth.uid()))
    or (sees_every_content_task() and exists (
          select 1 from tasks t
           where t.project_id = p_project_id and t.kind = 'content'))
    or ((is_3d_team_leader() or is_business_exec()) and is_3d_project(p_project_id));
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

create or replace function submit_task(p_task_id uuid, p_output output_location, p_drive_link text, p_description text, p_links text[] default '{}'::text[])
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
  v_unset      text;
begin
  select * into v_task from tasks where id = p_task_id;
  -- Null-safe on purpose: an unassigned task belongs to nobody, and `<>`
  -- against NULL is NULL, which would let anyone through.
  if v_task.assignee_id is null or v_task.assignee_id <> auth.uid() then
    raise exception 'Only the assignee can submit this task';
  end if;

  if v_task.kind = 'content' then
    -- Every piece the task asked for needs a status first; extras do not.
    select string_agg(coalesce(nullif(btrim(title), ''), 'Piece ' || slot), ', ' order by slot)
      into v_unset
      from content_bank
     where task_id = p_task_id and slot is not null and stage is null;
    if v_unset is not null then
      raise exception 'Give every piece a status before submitting. Still not set: %', v_unset
        using errcode = '22023';
    end if;
    -- And every piece with something in it says where it goes (0023).
    select string_agg(coalesce(nullif(btrim(title), ''), 'Piece ' || coalesce(slot::text, '')),
                      ', ' order by slot nulls last, created_at)
      into v_unset
      from content_bank c
     where c.task_id = p_task_id and c.placement is null
       and (c.slot is not null or not content_is_empty(c));
    if v_unset is not null then
      raise exception 'Give every piece a content placement before submitting. Still not set: %', v_unset
        using errcode = '22023';
    end if;
    if p_output <> 'Content Bank' then
      raise exception 'A content task is submitted to the Content Bank.' using errcode = '22023';
    end if;
  elsif p_output = 'Content Bank' then
    raise exception 'Only a content task is submitted to the Content Bank.' using errcode = '22023';
  end if;

  update time_sessions
     set ended_at = now(), end_reason = 'Submitted'
   where task_id = p_task_id and profile_id = auth.uid() and ended_at is null;

  insert into submissions (task_id, by_profile_id, output_location, drive_link, description, links)
  values (p_task_id, auth.uid(), p_output, p_drive_link, coalesce(p_description, ''),
          coalesce(p_links, '{}'))
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
-- definition of "late" the app shows. No "due tomorrow" for a task still
-- waiting on another, and no overdue notice for Approved work.
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
     and t.status <> 'Approved'
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
  n       integer := greatest(1, coalesce((rule ->> 'interval')::integer, 1));
  mode    text    := coalesce(rule ->> 'monthlyMode', 'monthday');
  months  integer;
  days    integer[];
  v_day   integer;
begin
  if d < anchor then return false; end if;

  -- The day a monthly rule was told to fall on, when it names one.
  if rule ->> 'freq' = 'monthly' and mode = 'monthday'
     and jsonb_typeof(rule -> 'monthDay') = 'number' then
    v_day := floor((rule ->> 'monthDay')::numeric)::integer;
    if v_day < 1 or v_day > 31 then
      v_day := null;
    end if;
  end if;

  if d = anchor and v_day is null then return true; end if;

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
      if v_day is not null then
        return extract(day from d)::integer = least(
          v_day,
          extract(day from (date_trunc('month', d::timestamp) + interval '1 month - 1 day'))::integer
        );
      end if;
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
$function$;

-- Materialise every occurrence that has come due, up to today (IST).
-- Occurrences that snap onto the same working day (a daily rule over a weekend)
-- produce a single copy, made by make_project_occurrence() /
-- make_task_occurrence() (shared with create_occurrence_now()). Returns the
-- number of projects + tasks created.
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

-- Late means past the due date (IST) while the delay is still ours. A task
-- waiting on another is never late. Submitted, Waiting for Client Response and
-- Approved are judged by the latest submission's day, so on-time work is not
-- late while reviewed or with the client, and work resubmitted after the due
-- date stays late through approval. Mirrors isOverdue.
create or replace function task_is_overdue(p_task_id uuid, p_status task_status, p_due_date date)
 returns boolean
 language sql
 stable
 set search_path to 'public'
as $function$
  with last_submission as (
    select (max(s.submitted_at) at time zone 'Asia/Kolkata')::date as day
      from submissions s
     where s.task_id = p_task_id
  )
  select case
    when task_is_waiting(p_task_id) then false
    when p_status in ('Submitted', 'Waiting for Client Response', 'Approved')
         and (select day from last_submission) is not null
      then (select day from last_submission) > p_due_date
    when p_status = 'Approved' then false
    else p_due_date < ist_today()
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
  if auth.uid() is null then
    return new;
  end if;
  select name into v_project from projects where id = new.project_id;

  if new.allotted_to is not null and new.allotted_to <> auth.uid()
     and (tg_op = 'INSERT' or new.allotted_to is distinct from old.allotted_to) then
    perform notify(
      array[new.allotted_to],
      'content_allotted',
      'Content allotted to you',
      new.type::text
        || case when is_stm_type(new.type) then ' (static design)' else '' end
        || ' for ' || coalesce(v_project, 'a project'),
      '/content-bank?entry=' || new.id
    );
  end if;

  if new.motion_allotted_to is not null and new.motion_allotted_to <> auth.uid()
     and (tg_op = 'INSERT' or new.motion_allotted_to is distinct from old.motion_allotted_to) then
    perform notify(
      array[new.motion_allotted_to],
      'content_allotted',
      'Reel editing allotted to you',
      new.type::text || ' for ' || coalesce(v_project, 'a project')
        || ' - starts once the static design is done',
      '/content-bank?entry=' || new.id
    );
  end if;
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

create or replace function allot_content(p_content_id uuid, p_profile_id uuid, p_task_id uuid, p_motion_profile_id uuid default null::uuid, p_motion_task_id uuid default null::uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_project uuid;
  v_type    cb_type;
  v_static  date;
  v_reel    date;
begin
  select project_id, type into v_project, v_type from content_bank where id = p_content_id;
  if v_project is null then
    raise exception 'That content no longer exists.' using errcode = 'P0002';
  end if;
  if not can_allot_content(v_project) then
    raise exception 'Only a manager, the Project Leader or a Team Leader can allot content.'
      using errcode = '42501';
  end if;

  -- Taking a piece back clears every part together.
  if p_profile_id is null then
    update content_bank
       set allotted_to = null, allotted_task_id = null,
           motion_allotted_to = null, motion_allotted_task_id = null
     where id = p_content_id;
    return;
  end if;

  if not exists (select 1 from profiles where id = p_profile_id and active) then
    raise exception 'That team member is not active.' using errcode = '22023';
  end if;
  if p_task_id is null then
    raise exception 'Pick or create the task this piece is for.' using errcode = '22023';
  end if;
  select due_date into v_static from tasks
   where id = p_task_id and project_id = v_project and assignee_id = p_profile_id;
  if not found then
    raise exception 'That task is not theirs on this project.' using errcode = '22023';
  end if;

  if not is_stm_type(v_type) then
    update content_bank
       set allotted_to = p_profile_id, allotted_task_id = p_task_id,
           motion_allotted_to = null, motion_allotted_task_id = null
     where id = p_content_id;
    return;
  end if;

  -- Static to Motion: the reel part is allotted in the same breath.
  if p_motion_profile_id is null or p_motion_task_id is null then
    raise exception 'A Static to Motion piece needs the reel editing allotted too.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from profiles where id = p_motion_profile_id and active) then
    raise exception 'The reel editor is not active.' using errcode = '22023';
  end if;
  select start_date into v_reel from tasks
   where id = p_motion_task_id and project_id = v_project and assignee_id = p_motion_profile_id;
  if not found then
    raise exception 'That reel editing task is not theirs on this project.' using errcode = '22023';
  end if;
  if p_motion_task_id = p_task_id then
    raise exception 'The static design and the reel editing need a task each.' using errcode = '22023';
  end if;
  if v_reel < v_static then
    raise exception 'The reel editing waits for the static design: pick a task starting on or after %.',
      to_char(v_static, 'FMDD Mon YYYY') using errcode = '22023';
  end if;

  -- notify_content_allotment tells each new holder.
  update content_bank
     set allotted_to = p_profile_id, allotted_task_id = p_task_id,
         motion_allotted_to = p_motion_profile_id, motion_allotted_task_id = p_motion_task_id
   where id = p_content_id;
end;
$function$;

create or replace function set_content_stage(p_content_id uuid, p_stage content_stage, p_date date default null::date)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_project  uuid;
  v_allotted uuid;
  v_motion   uuid;
  v_for      date;
begin
  select project_id, allotted_to, motion_allotted_to, for_month
    into v_project, v_allotted, v_motion, v_for
    from content_bank where id = p_content_id;
  if v_project is null then
    raise exception 'That content no longer exists.' using errcode = 'P0002';
  end if;
  if not (
    can_manage_content(p_content_id)
    or v_allotted = auth.uid()
    or v_motion = auth.uid()
    or (can_write_content() and can_see_project(v_project))
  ) then
    raise exception 'You cannot change where this content has got to.' using errcode = '42501';
  end if;

  if p_stage = 'Scheduled' and p_date is null then
    raise exception 'Pick the date it is scheduled for.' using errcode = '22023';
  end if;
  if p_stage = 'Carry Forwarded' then
    if p_date is null then
      raise exception 'Pick the month it is carried forward to.' using errcode = '22023';
    end if;
    if date_trunc('month', p_date)::date <= v_for then
      raise exception 'Carry it forward to a month after the one it is for.' using errcode = '22023';
    end if;
  end if;

  update content_bank
     set stage        = p_stage,
         scheduled_on = case when p_stage = 'Scheduled' then p_date end,
         carry_month  = case when p_stage = 'Carry Forwarded'
                             then date_trunc('month', p_date)::date end
   where id = p_content_id;
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
  if tg_op = 'INSERT' then
    if (new.allotted_to is not null or new.allotted_task_id is not null
        or new.motion_allotted_to is not null or new.motion_allotted_task_id is not null)
       and not can_allot_content(new.project_id) then
      raise exception 'Only a manager, the Project Leader or a Team Leader can allot content.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Each part on its own: unchanged, blanked by its task being deleted, or
  -- following its task's new assignee (0014) needs no right to allot.
  if (
       (new.allotted_to is not distinct from old.allotted_to
        and new.allotted_task_id is not distinct from old.allotted_task_id)
    or (new.allotted_to is not distinct from old.allotted_to and new.allotted_task_id is null)
    or (new.allotted_task_id is not null
        and new.allotted_task_id is not distinct from old.allotted_task_id
        and new.allotted_to is not distinct from
            (select assignee_id from tasks where id = new.allotted_task_id))
  ) and (
       (new.motion_allotted_to is not distinct from old.motion_allotted_to
        and new.motion_allotted_task_id is not distinct from old.motion_allotted_task_id)
    or (new.motion_allotted_to is not distinct from old.motion_allotted_to
        and new.motion_allotted_task_id is null)
    or (new.motion_allotted_task_id is not null
        and new.motion_allotted_task_id is not distinct from old.motion_allotted_task_id
        and new.motion_allotted_to is not distinct from
            (select assignee_id from tasks where id = new.motion_allotted_task_id))
  ) then
    return new;
  end if;

  if not can_allot_content(new.project_id) then
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

-- Bring one task's slots in line with its kind, target, assignee and title. A
-- new slot takes its CB type and placement from the task's lists.
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
        (project_id, task_id, slot, title, type, billing_type, created_by, for_month,
         placement)
      values
        (t.project_id, t.id, n, content_slot_title(t.title, n),
         coalesce(t.content_types[n], 'Static Design'), 'Count', t.assignee_id,
         content_month(t.project_id, t.start_date),
         t.content_placements[n]);
    end if;
  end loop;

  -- Empty slots are the assignee's to fill.
  update content_bank c
     set created_by = t.assignee_id
   where c.task_id = t.id and c.slot is not null and content_is_empty(c)
     and c.created_by is distinct from t.assignee_id;
end;
$function$;

-- Keeps a content task's slots in step with the task: a renamed task renames
-- the slots still wearing the generated name, and changed piece types or
-- placements retype or re-place their pieces (a blank placement never clears
-- one). sync_content_slots() does the rest.
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
       and new.content_types is not distinct from old.content_types
       and new.content_placements is not distinct from old.content_placements
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
    if new.content_types is distinct from old.content_types then
      update content_bank c
         set type = new.content_types[c.slot]
       where c.task_id = new.id and c.slot is not null
         and new.content_types[c.slot] is not null
         and new.content_types[c.slot] is distinct from old.content_types[c.slot]
         and c.type is distinct from new.content_types[c.slot];
    end if;
    -- The same for where each piece goes. A slot the task leaves blank keeps
    -- whatever its piece already says.
    if new.content_placements is distinct from old.content_placements then
      update content_bank c
         set placement = new.content_placements[c.slot]
       where c.task_id = new.id and c.slot is not null
         and new.content_placements[c.slot] is not null
         and new.content_placements[c.slot] is distinct from old.content_placements[c.slot]
         and c.placement is distinct from new.content_placements[c.slot];
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

-- Is this project a blueprint? Copies never carry a rule, so the rule is the mark.
create or replace function is_blueprint_project(p_project_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (select 1 from projects where id = p_project_id and recurrence is not null);
$function$;

-- Is this task part of a blueprint - an individual one, or on a blueprint project?
create or replace function is_blueprint_task(p_task_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from tasks t
     where t.id = p_task_id
       and (t.recurrence is not null or is_blueprint_project(t.project_id))
  );
$function$;

-- "<name> – November 2026", or the name with [Month] and [Year] filled in.
create or replace function occurrence_name(p_name text, p_day date)
 returns text
 language sql
 immutable
as $function$
  select case
    when p_name ~* '\[(month|year)\]' then
      btrim(regexp_replace(regexp_replace(p_name,
        '\[month\]', to_char(p_day, 'FMMonth'), 'gi'),
        '\[year\]', to_char(p_day, 'YYYY'), 'gi'))
    else btrim(p_name) || ' – ' || to_char(p_day, 'FMMonth YYYY')
  end;
$function$;

-- "<name> – November 2026", or the name with [Month] and [Year] filled in.
create or replace function occurrence_name(p_name text, p_day date, p_property_id uuid)
 returns text
 language sql
 stable
 set search_path to 'public'
as $function$
  select concat_ws(' | ',
    nullif(btrim((select pr.name from properties pr where pr.id = p_property_id)), ''),
    nullif(
      regexp_replace(
        regexp_replace(
          regexp_replace(coalesce(p_name, ''), '\[(month|year)\]', '', 'gi'),
          '\s{2,}', ' ', 'g'),
        '^[\s,|:–—-]+|[\s,|:–—-]+$', '', 'g'),
      ''),
    to_char(p_day, 'FMMonth YYYY'));
$function$;

-- Create whatever is due now, without waiting for 00:05. The app calls this
-- after a blueprint is saved, so one whose first date is today appears at once.
create or replace function run_due_recurrences()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_global_manager() then
    raise exception 'Only Super Admin, Admin or Manager can run repeats.' using errcode = '42501';
  end if;
  return generate_recurring_occurrences();
end;
$function$;

create or replace function my_project_ids()
 returns uuid[]
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(array_agg(distinct id), '{}') from (
    select p.id from projects p where p.leader_id = auth.uid()
    union
    select t.project_id from tasks t
     where t.assignee_id = auth.uid() and t.project_id is not null
    union
    select t.project_id from tasks t
     where is_team_leader() and t.project_id is not null
       and t.department = any (my_departments())
    union
    select m.project_id from project_members m
     where is_team_leader() and m.profile_id = auth.uid()
    union
    select t.project_id from tasks t
     where sees_every_content_task() and t.project_id is not null
       and t.kind = 'content'
    union
    select p.id from projects p
     where p.is_3d and (is_3d_team_leader() or is_business_exec())
  ) visible;
$function$;

-- Tasks the caller sees without being a global manager. Mirrors can_see_task().
create or replace function my_task_ids()
 returns uuid[]
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(array_agg(t.id), '{}') from tasks t
   where t.assignee_id = auth.uid()
      or t.created_by = auth.uid()
      or t.project_id = any (my_project_ids());
$function$;

-- Reassigning a task moves the part allotted to it (0014), reel part included.
create or replace function follow_task_assignee()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update content_bank
     set allotted_to = new.assignee_id
   where allotted_task_id = new.id
     and allotted_to is distinct from new.assignee_id;
  update content_bank
     set motion_allotted_to = new.assignee_id
   where motion_allotted_task_id = new.id
     and motion_allotted_to is distinct from new.assignee_id;
  return null;
end;
$function$;

create or replace function stamp_content_journey()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  -- Started: Start Writing sets it; failing that, the first thing written.
  if new.started_at is null and not content_is_empty(new) then
    new.started_at := now();
    new.started_by := coalesce(new.started_by, auth.uid());
  end if;

  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    -- No stage before the writer has started.
    if new.stage is not null and new.started_at is null then
      raise exception 'Start writing this piece before setting its status.'
        using errcode = 'check_violation';
    end if;
    -- Ready To Design: the first time only; going on from it keeps the date.
    if new.stage = 'Ready To Design' and new.ready_at is null then
      new.ready_at := now();
    end if;
    -- Completed: on reaching it; stepping back off it clears the date.
    if new.stage in ('Design Completed', 'Scheduled') then
      if new.completed_at is null then
        new.completed_at := now();
      end if;
    elsif new.stage is null or new.stage = 'Ready To Design' then
      new.completed_at := null;
    end if;
  end if;

  -- Allotted: each new holder restarts it; taking the piece back clears it.
  if new.allotted_to is null then
    new.allotted_at := null;
  elsif tg_op = 'INSERT' or new.allotted_to is distinct from old.allotted_to then
    new.allotted_at := now();
  end if;

  return new;
end;
$function$;

create or replace function is_website_dev()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from profile_departments
     where profile_id = auth.uid() and department = 'Website Developers'
  );
$function$;

create or replace function can_view_websites()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select is_global_manager() or is_website_dev() or is_finance() or is_business_exec();
$function$;

create or replace function can_manage_websites()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select is_global_manager() or is_website_dev();
$function$;

create or replace function can_see_website_passwords()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select auth_role() in ('super_admin', 'admin') or is_website_dev();
$function$;

create or replace function can_renew_websites()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select can_manage_websites() or is_finance();
$function$;

-- First renewal: a year after the start, or the next anniversary still ahead
-- for a site that started years ago. Changing the start date moves it, unless
-- the same save also set the renewal date by hand.
create or replace function websites_default_renewal()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v date;
begin
  if new.start_date is not null and (
       (tg_op = 'INSERT' and new.renewal_due is null)
    or (tg_op = 'UPDATE' and new.start_date is distinct from old.start_date
        and new.renewal_due is not distinct from old.renewal_due)
  ) then
    v := (new.start_date + interval '1 year')::date;
    while v < ist_today() loop
      v := (v + interval '1 year')::date;
    end loop;
    new.renewal_due := v;
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

create or replace function reveal_website_password(p_credential_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_password text;
begin
  if not can_see_website_passwords() then
    raise exception 'Only a Super Admin, Admin or Website Developer can see passwords.'
      using errcode = '42501';
  end if;
  select password into v_password from website_credentials where id = p_credential_id;
  if not found then
    raise exception 'That login no longer exists.' using errcode = 'P0002';
  end if;
  insert into website_password_reveals (credential_id, profile_id)
  values (p_credential_id, auth.uid());
  return v_password;
end;
$function$;

-- The renewal is done: record it and move the due date on a year.
create or replace function mark_website_renewed(p_website_id uuid, p_amount numeric default null::numeric, p_note text default ''::text)
 returns date
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  w     websites%rowtype;
  v_from date;
  v_to   date;
begin
  if not can_renew_websites() then
    raise exception 'Only a manager, Website Developer or Accounts & Finance can mark a renewal.'
      using errcode = '42501';
  end if;
  select * into w from websites where id = p_website_id for update;
  if not found then
    raise exception 'That website no longer exists.' using errcode = 'P0002';
  end if;

  v_from := coalesce(w.renewal_due, (w.start_date + interval '1 year')::date, ist_today());
  v_to   := (v_from + interval '1 year')::date;

  insert into website_renewals (website_id, period_from, period_to, amount, note)
  values (p_website_id, v_from, v_to, p_amount, coalesce(p_note, ''));
  update websites set renewal_due = v_to where id = p_website_id;
  return v_to;
end;
$function$;

create or replace function notify_website_renewals()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_count integer;
begin
  with due as (
    select w.*, w.renewal_due - ist_today() as days_left
      from websites w
     where w.status = 'Active'
       and w.renewal_due is not null
       -- Only what Synovative pays for; a client renewing their own needs no chasing.
       and (w.synovative_domain or w.synovative_hosting)
  ),
  picked as (
    select * from due
     where days_left in (30, 15, 7, 1, 0)
        or (days_left < 0 and days_left >= -180 and (-days_left) % 7 = 0)
  ),
  people as (
    select p.id from profiles p
     where p.active
       and (
         p.role in ('super_admin', 'admin')
         or exists (
           select 1 from profile_departments pd
            where pd.profile_id = p.id
              and pd.department in (
                'Website Developers', 'Accounts & Finance', 'Business Development Executives'
              )
         )
       )
  ),
  inserted as (
    insert into notifications (profile_id, type, title, body, href)
    select people.id,
           'website_renewal',
           case
             when s.days_left < 0 then 'Website renewal overdue'
             when s.days_left = 0 then 'Website renewal due today'
             when s.days_left = 1 then 'Website renewal tomorrow'
             else 'Website renewal in ' || s.days_left || ' days'
           end,
           s.name || coalesce(nullif(' (' || s.url || ')', ' ()'), '') ||
           case when s.days_left < 0 then ' was due on ' else ' renews on ' end ||
           to_char(s.renewal_due, 'FMDD Mon YYYY') || ' - ' ||
           case
             when s.synovative_domain and s.synovative_hosting then 'domain and hosting'
             when s.synovative_domain then 'domain'
             else 'hosting'
           end || '.',
           '/websites?site=' || s.id
      from picked s
     cross join people
     where not exists (
       select 1 from notifications n
        where n.profile_id = people.id
          and n.type = 'website_renewal'
          and n.href = '/websites?site=' || s.id
          and n.created_at >= current_date
     )
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end;
$function$;

create or replace function is_stm_type(p_type cb_type)
 returns boolean
 language sql
 immutable
as $function$
  select p_type in ('Static to Motion', 'Festival STM');
$function$;

-- Writing in a piece, or clearing its placement, needs a placement. Moving a
-- piece between tasks or changing its status does not touch this.
create or replace function guard_content_placement()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.placement is not null or content_is_empty(new) then
    return new;
  end if;
  if tg_op = 'INSERT'
     or old.placement is not null
     or new.on_pic is distinct from old.on_pic
     or new.caption is distinct from old.caption
     or new.description is distinct from old.description
     or new.reference_links is distinct from old.reference_links then
    raise exception 'Pick the content placement: SMM or WhatsApp Share.' using errcode = '23502';
  end if;
  return new;
end;
$function$;

create or replace function is_content_team_leader()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select is_team_leader() and is_content_writer();
$function$;

create or replace function in_department(p_profile_id uuid, p_department text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from profile_departments
     where profile_id = p_profile_id and department = p_department
  );
$function$;

create or replace function assign_content_task(p_task_id uuid, p_profile_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  t tasks%rowtype;
begin
  select * into t from tasks where id = p_task_id for update;
  if not found then
    raise exception 'That task no longer exists.' using errcode = 'P0002';
  end if;
  if t.kind <> 'content' then
    raise exception 'Only a content task is shared out this way.' using errcode = '22023';
  end if;
  if not is_content_team_leader() then
    raise exception 'Only a Content Writers Team Leader can assign this.' using errcode = '42501';
  end if;
  if t.assignee_id is not null then
    raise exception 'This content task is already assigned.' using errcode = '22023';
  end if;
  if not exists (select 1 from profiles where id = p_profile_id and active) then
    raise exception 'That team member is not active.' using errcode = '22023';
  end if;
  if not on_content_desk(p_profile_id) then
    raise exception 'Pick someone from the Content Writers or Social Media Marketing team.'
      using errcode = '22023';
  end if;

  -- The slots follow the assignee (tasks_sync_content_slots); they are told
  -- by notify_task_assignment.
  update tasks set assignee_id = p_profile_id where id = p_task_id;
end;
$function$;

create or replace function split_content_task(p_task_id uuid, p_piece_ids uuid[], p_title text, p_assignee_id uuid, p_start_date date, p_due_date date, p_estimated_hours numeric, p_priority priority_level default 'Medium'::priority_level)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  t        tasks%rowtype;
  p        projects%rowtype;
  v_new    uuid;
  v_moved  integer;
  v_slots  integer;
  v_left   integer;
begin
  select * into t from tasks where id = p_task_id for update;
  if not found then
    raise exception 'That task no longer exists.' using errcode = 'P0002';
  end if;
  if t.kind <> 'content' or t.project_id is null then
    raise exception 'Only a content task on a project can be split.' using errcode = '22023';
  end if;
  select * into p from projects where id = t.project_id;

  if not (is_global_manager() or leads_project(t.project_id) or is_content_team_leader()) then
    raise exception 'Only a manager, the Project Leader or a Content Writers Team Leader can split a content task.'
      using errcode = '42501';
  end if;
  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'The new task needs a title.' using errcode = '22023';
  end if;
  if not exists (select 1 from profiles where id = p_assignee_id and active) then
    raise exception 'That team member is not active.' using errcode = '22023';
  end if;
  if not (is_global_manager() or leads_project(t.project_id))
     and not on_content_desk(p_assignee_id) then
    raise exception 'Pick someone from the Content Writers or Social Media Marketing team.'
      using errcode = '22023';
  end if;
  if p_start_date is null or p_due_date is null or p_due_date < p_start_date then
    raise exception 'The due date must be on or after the start date.' using errcode = '22023';
  end if;
  if p_start_date < p.start_date or p_due_date > p.deadline then
    raise exception 'The dates must sit inside the project (% to %).',
      to_char(p.start_date, 'FMDD Mon YYYY'), to_char(p.deadline, 'FMDD Mon YYYY')
      using errcode = '22023';
  end if;

  select count(*), count(*) filter (where slot is not null)
    into v_moved, v_slots
    from content_bank
   where id = any (p_piece_ids) and task_id = p_task_id;
  if v_moved = 0 then
    raise exception 'Pick the pieces to move.' using errcode = '22023';
  end if;
  if v_moved <> coalesce(array_length(p_piece_ids, 1), 0) then
    raise exception 'Some of those pieces are not on this task.' using errcode = '22023';
  end if;
  v_left := t.content_count - v_slots;
  if v_left < 1 then
    raise exception 'Leave at least one piece on the original task - to hand over all of it, reassign it instead.'
      using errcode = '22023';
  end if;

  -- The new task, empty for now: its count is set once the pieces are on it,
  -- so no fresh empty slots get laid out.
  insert into tasks (
    project_id, title, description, department, assignee_id, priority,
    start_date, due_date, estimated_hours, tags, kind, content_count, content_types
  ) values (
    t.project_id, btrim(p_title), '', t.department, p_assignee_id, p_priority,
    p_start_date, p_due_date, coalesce(p_estimated_hours, 0), '{}', 'content', 0, '{}'
  ) returning id into v_new;

  -- Move the pieces. Target pieces are numbered 1.. on the new task in their
  -- old order; extras stay extras. A name still generated from the old task
  -- follows the new one; a name someone typed is kept.
  with moved as (
    select c.id,
           c.slot,
           row_number() over (order by c.slot) as n
      from content_bank c
     where c.id = any (p_piece_ids) and c.task_id = p_task_id and c.slot is not null
  )
  update content_bank c
     set task_id = v_new,
         slot    = m.n,
         title   = case when c.title = content_slot_title(t.title, m.slot)
                        then content_slot_title(btrim(p_title), m.n::integer)
                        else c.title end
    from moved m
   where c.id = m.id;
  update content_bank
     set task_id = v_new
   where id = any (p_piece_ids) and task_id = p_task_id and slot is null;

  -- Close the gaps on the original: renumber what is left 1..n, renaming the
  -- generated names to match. Shifted out of the way first so the unique
  -- (task, slot) index never sees two pieces on one number.
  update content_bank set slot = slot + 100000 where task_id = p_task_id and slot is not null;
  with kept as (
    select id, slot - 100000 as old_slot, row_number() over (order by slot) as n
      from content_bank where task_id = p_task_id and slot is not null
  )
  update content_bank c
     set slot  = k.n,
         title = case when c.title = content_slot_title(t.title, k.old_slot::integer)
                      then content_slot_title(t.title, k.n::integer)
                      else c.title end
    from kept k
   where c.id = k.id;

  -- Counts and per-piece types now match what each task actually holds.
  update tasks
     set content_count = v_left,
         content_types = coalesce((
           select array_agg(type order by slot) from content_bank
            where task_id = p_task_id and slot is not null), '{}')
   where id = p_task_id;
  update tasks
     set content_count = v_slots,
         content_types = coalesce((
           select array_agg(type order by slot) from content_bank
            where task_id = v_new and slot is not null), '{}')
   where id = v_new;

  return v_new;
end;
$function$;

create or replace function sync_project_clients()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    if cardinality(new.client_ids) = 0 and new.series_source_id is not null then
      -- A recurring copy takes its blueprint's contacts.
      select p.client_ids into new.client_ids from projects p where p.id = new.series_source_id;
      new.client_ids := coalesce(new.client_ids, '{}');
    end if;
    if cardinality(new.client_ids) = 0 and new.client_id is not null then
      new.client_ids := array[new.client_id];
    end if;
    new.client_id := new.client_ids[1];
    return new;
  end if;

  if new.client_ids is distinct from old.client_ids then
    new.client_id := new.client_ids[1];
  elsif new.client_id is distinct from old.client_id then
    if new.client_id is null then
      -- The first contact was removed (or deleted); the next one steps up.
      new.client_ids := array_remove(old.client_ids, old.client_id);
      new.client_id := new.client_ids[1];
    else
      -- Something that only knows client_id (an OBC edit) set it outright.
      new.client_ids := array[new.client_id];
    end if;
  end if;
  return new;
end;
$function$;

-- A deleted contact leaves every project it was on, not only those where it
-- was first (the foreign key only covers client_id).
create or replace function drop_deleted_client_from_projects()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update projects set client_ids = array_remove(client_ids, old.id)
   where old.id = any (client_ids);
  return old;
end;
$function$;

create or replace function start_content_piece(p_content_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_assignee uuid;
begin
  select t.assignee_id into v_assignee
    from content_bank c join tasks t on t.id = c.task_id
   where c.id = p_content_id;
  if not found then
    raise exception 'This piece is not on a content task.';
  end if;
  if v_assignee is distinct from auth.uid() then
    raise exception 'Only the writer the task is assigned to can start this piece.'
      using errcode = 'insufficient_privilege';
  end if;

  update content_bank
     set started_at = coalesce(started_at, now()),
         started_by = coalesce(started_by, auth.uid())
   where id = p_content_id;
end;
$function$;

create or replace function on_content_desk(p_profile_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select in_department(p_profile_id, 'Content Writers / Copywriters / Brand Strategists')
      or in_department(p_profile_id, 'Social Media Marketing');
$function$;

create or replace function sees_every_content_task()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select is_team_leader() and on_content_desk(auth.uid());
$function$;

create or replace function title_day(p_title_month text, p_day date)
 returns date
 language sql
 immutable
as $function$
  select case when p_title_month = 'upcoming'
              then (p_day + interval '1 month')::date
              else p_day end;
$function$;

create or replace function content_month(p_project_id uuid, p_day date)
 returns date
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select date_trunc('month', title_day(
           coalesce((select s.title_month from projects p
                       join projects s on s.id = p.series_source_id
                      where p.id = p_project_id), 'current'),
           p_day))::date;
$function$;

-- Phone numbers are left out of the select grant on companies and clients
-- (grants at the end of the RLS file). This hands them out: company phones to
-- global managers and Business Development Executives, a client's numbers to
-- can_see_client_details(). Mirrors canSeeCrmPhones.
create or replace function crm_phone_numbers()
 returns table(kind text, id uuid, phone text, whatsapp text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select 'company', c.id, c.phone, ''::text
    from companies c
   where (is_global_manager() or is_business_exec()) and c.phone <> ''
  union all
  select 'client', k.id, k.mobile, k.whatsapp
    from clients k
   where can_see_client_details() and (k.mobile <> '' or k.whatsapp <> '');
$function$;

-- Where a category goes: 'cabinet' (inside one), 'workstation', or 'either'.
create or replace function inventory_category_place(p_category text)
 returns text
 language sql
 immutable
as $function$
  select case
    when p_category in ('Processor', 'Motherboard', 'RAM', 'Storage', 'GPU', 'Power supply')
      then 'cabinet'
    when p_category = 'Other' then 'either'
    else 'workstation'
  end;
$function$;

create or replace function can_manage_inventory()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(auth_role() in ('super_admin', 'admin'), false);
$function$;

create or replace function can_view_inventory()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select is_global_manager();
$function$;

-- What the caller may see without can_view_inventory(): what is at a
-- workstation allotted to them, and the parts inside its cabinets.
create or replace function my_inventory_item_ids()
 returns uuid[]
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(array_agg(i.id), '{}')
    from inventory_items i
   where i.workstation_id in (select w.id from workstations w where w.assigned_to = auth.uid())
      or i.cabinet_id in (
           select c.id from inventory_items c
             join workstations w on w.id = c.workstation_id
            where w.assigned_to = auth.uid());
$function$;

create or replace function inventory_place_label(p_cabinet_id uuid, p_workstation_id uuid)
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when p_cabinet_id is not null then
      (select c.asset_tag || coalesce(' at ' || w.code, '')
         from inventory_items c left join workstations w on w.id = c.workstation_id
        where c.id = p_cabinet_id)
    when p_workstation_id is not null then
      (select w.code || case when w.name <> '' then ' ' || w.name else '' end
         from workstations w where w.id = p_workstation_id)
  end;
$function$;

-- The note the calling function gave this change, if any.
create or replace function inventory_note()
 returns text
 language sql
 stable
as $function$
  select coalesce(current_setting('inventory.note', true), '');
$function$;

create or replace function inventory_guard_item()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_prefix text;
  v_n      integer;
  v_place  text := inventory_category_place(new.category);
  v_host   record;
  v_moved  boolean;
begin
  if tg_op = 'INSERT' then
    -- The asset ID: one counter per prefix, taken under its row lock.
    v_prefix := inventory_category_prefix(new.category);
    insert into inventory_counters as c (prefix, last_number) values (v_prefix, 1)
      on conflict (prefix) do update set last_number = c.last_number + 1
      returning last_number into v_n;
    new.asset_tag := 'SYN-' || v_prefix || '-' || lpad(v_n::text, greatest(4, length(v_n::text)), '0');
    v_moved := true;
  else
    if new.asset_tag is distinct from old.asset_tag then
      raise exception 'An asset ID never changes.';
    end if;
    if new.category is distinct from old.category then
      raise exception 'The category of % is fixed. Delete it and add it again under the right category.',
        old.asset_tag;
    end if;
    new.updated_at := now();
    v_moved := new.cabinet_id is distinct from old.cabinet_id
            or new.workstation_id is distinct from old.workstation_id;
  end if;
  new.serial_number := btrim(new.serial_number);

  if new.cabinet_id is not null then
    if v_place = 'workstation' then
      raise exception 'A % goes at a workstation, not inside a cabinet.', lower(new.category);
    end if;
    select category, status, asset_tag into v_host from inventory_items where id = new.cabinet_id;
    if v_host.category <> 'Cabinet' then
      raise exception 'Parts can only go inside a cabinet, and % is a %.',
        v_host.asset_tag, lower(v_host.category);
    end if;
    if v_moved and v_host.status = 'Retired' then
      raise exception '% is retired; nothing can be installed in it.', v_host.asset_tag;
    end if;
  end if;
  if new.workstation_id is not null and v_place = 'cabinet' then
    raise exception 'A % goes inside a cabinet, not straight at a workstation.', lower(new.category);
  end if;

  -- Status follows placement.
  if new.cabinet_id is not null or new.workstation_id is not null then
    if new.status in ('Under repair', 'Retired') then
      raise exception '% is %. Take it out before changing that, or mark it Spare first.',
        new.asset_tag, lower(new.status);
    end if;
    new.status := 'In use';
  elsif new.status = 'In use' then
    new.status := 'Spare';
  end if;

  if new.category = 'Cabinet' and new.status = 'Retired'
     and tg_op = 'UPDATE' and exists (select 1 from inventory_items where cabinet_id = new.id) then
    raise exception 'Take the parts out of % before retiring it.', new.asset_tag;
  end if;
  return new;
end;
$function$;

create or replace function inventory_guard_workstation()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_n bigint;
begin
  if tg_op = 'INSERT' then
    v_n := nextval('workstation_code_seq');
    new.code := 'WS-' || lpad(v_n::text, greatest(3, length(v_n::text)), '0');
  else
    if new.code is distinct from old.code then
      raise exception 'A workstation code never changes.';
    end if;
    new.updated_at := now();
  end if;
  if new.assigned_to is not null
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    if not exists (select 1 from profiles where id = new.assigned_to and active) then
      raise exception 'A workstation can only be allotted to an active member.';
    end if;
  end if;
  if tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to then
    new.assigned_at := case when new.assigned_to is null then null else now() end;
  end if;
  new.name := btrim(new.name);
  return new;
end;
$function$;

create or replace function inventory_log_item()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_from    text;
  v_to      text;
  v_changed text[] := '{}';
begin
  if tg_op = 'INSERT' then
    insert into inventory_events (actor, item_id, kind, subject, to_label, note)
    values (auth.uid(), new.id, 'added', new.asset_tag,
            coalesce(inventory_place_label(new.cabinet_id, new.workstation_id), new.status),
            inventory_note());
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into inventory_events (actor, item_id, kind, subject, from_label, note)
    values (auth.uid(), null, 'deleted', old.asset_tag,
            coalesce(inventory_place_label(old.cabinet_id, old.workstation_id), old.status),
            old.category || coalesce(' ' || nullif(btrim(old.brand || ' ' || old.model), ''), ''));
    return old;
  end if;

  if new.cabinet_id is distinct from old.cabinet_id
     or new.workstation_id is distinct from old.workstation_id then
    v_from := coalesce(inventory_place_label(old.cabinet_id, old.workstation_id), old.status);
    v_to   := coalesce(inventory_place_label(new.cabinet_id, new.workstation_id), new.status);
    -- Filed under the desk it came from or went to, so a desk's history shows
    -- parts that have left it - unless that desk is the one being deleted.
    insert into inventory_events (actor, item_id, workstation_id, kind, subject, from_label, to_label, note)
    values (auth.uid(), new.id,
            (select w.id from workstations w
              where w.id = coalesce(
                new.workstation_id,
                (select c.workstation_id from inventory_items c where c.id = new.cabinet_id),
                old.workstation_id,
                (select c.workstation_id from inventory_items c where c.id = old.cabinet_id))),
            case when new.cabinet_id is not null then 'installed'
                 when new.workstation_id is not null then 'placed'
                 else 'removed' end,
            new.asset_tag, v_from, v_to, inventory_note());
  elsif new.status is distinct from old.status then
    insert into inventory_events (actor, item_id, kind, subject, from_label, to_label, note)
    values (auth.uid(), new.id, 'status', new.asset_tag, old.status, new.status, inventory_note());
  end if;

  if new.brand is distinct from old.brand then v_changed := v_changed || 'brand'::text; end if;
  if new.model is distinct from old.model then v_changed := v_changed || 'model'::text; end if;
  if new.serial_number is distinct from old.serial_number then v_changed := v_changed || 'serial number'::text; end if;
  if new.specs is distinct from old.specs then v_changed := v_changed || 'specs'::text; end if;
  if new.purchase_date is distinct from old.purchase_date then v_changed := v_changed || 'purchase date'::text; end if;
  if new.price is distinct from old.price then v_changed := v_changed || 'price'::text; end if;
  if new.vendor_id is distinct from old.vendor_id then v_changed := v_changed || 'vendor'::text; end if;
  if new.warranty_until is distinct from old.warranty_until then v_changed := v_changed || 'warranty'::text; end if;
  if new.notes is distinct from old.notes then v_changed := v_changed || 'notes'::text; end if;
  if cardinality(v_changed) > 0 then
    insert into inventory_events (actor, item_id, kind, subject, note)
    values (auth.uid(), new.id, 'edited', new.asset_tag, 'Changed ' || array_to_string(v_changed, ', '));
  end if;
  return new;
end;
$function$;

create or replace function inventory_log_workstation()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_old text;
  v_new text;
begin
  if tg_op = 'INSERT' then
    insert into inventory_events (actor, workstation_id, kind, subject, note)
    values (auth.uid(), new.id, 'added', new.code, new.name);
  elsif tg_op = 'DELETE' then
    insert into inventory_events (actor, workstation_id, kind, subject, note)
    values (auth.uid(), null, 'deleted', old.code, old.name);
    return old;
  end if;

  if (tg_op = 'INSERT' and new.assigned_to is not null)
     or (tg_op = 'UPDATE' and new.assigned_to is distinct from old.assigned_to) then
    v_old := case when tg_op = 'UPDATE' then (select full_name from profiles where id = old.assigned_to) end;
    v_new := (select full_name from profiles where id = new.assigned_to);
    insert into inventory_events (actor, workstation_id, kind, subject, from_label, to_label, note)
    values (auth.uid(), new.id,
            case when new.assigned_to is null then 'unassigned' else 'assigned' end,
            new.code, v_old, v_new, inventory_note());

    -- Tell both people. The one who did it already knows.
    if new.assigned_to is not null and new.assigned_to is distinct from auth.uid() then
      insert into notifications (profile_id, type, title, body, href)
      values (new.assigned_to, 'inventory_assigned', 'Workstation allotted to you',
              new.code || coalesce(' (' || nullif(new.name, '') || ')', '')
                || ' is now yours. See what is in it on your profile.',
              '/profile');
    end if;
    if tg_op = 'UPDATE' and old.assigned_to is not null
       and old.assigned_to is distinct from auth.uid() then
      insert into notifications (profile_id, type, title, body, href)
      values (old.assigned_to, 'inventory_assigned', 'Workstation taken back',
              new.code || coalesce(' (' || nullif(new.name, '') || ')', '')
                || ' is no longer allotted to you.',
              '/profile');
    end if;
  end if;
  return new;
end;
$function$;

create or replace function inventory_check_manager()
 returns void
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not can_manage_inventory() then
    raise exception 'Only a Super Admin or Admin can change the inventory.'
      using errcode = '42501';
  end if;
end;
$function$;

create or replace function inventory_install(p_item_id uuid, p_cabinet_id uuid, p_note text default ''::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform inventory_check_manager();
  perform set_config('inventory.note', coalesce(p_note, ''), true);
  update inventory_items set cabinet_id = p_cabinet_id, workstation_id = null where id = p_item_id;
  if not found then raise exception 'That component no longer exists.'; end if;
end;
$function$;

create or replace function inventory_place(p_item_id uuid, p_workstation_id uuid, p_note text default ''::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform inventory_check_manager();
  perform set_config('inventory.note', coalesce(p_note, ''), true);
  update inventory_items set workstation_id = p_workstation_id, cabinet_id = null where id = p_item_id;
  if not found then raise exception 'That component no longer exists.'; end if;
end;
$function$;

-- Take a component out (if it is anywhere) and set what it is now: Spare,
-- Under repair or Retired. Also how an unplaced component changes status.
create or replace function inventory_remove(p_item_id uuid, p_status text default 'Spare'::text, p_note text default ''::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform inventory_check_manager();
  if p_status not in ('Spare', 'Under repair', 'Retired') then
    raise exception 'A component that is taken out is Spare, Under repair or Retired.';
  end if;
  perform set_config('inventory.note', coalesce(p_note, ''), true);
  update inventory_items
     set cabinet_id = null, workstation_id = null, status = p_status
   where id = p_item_id;
  if not found then raise exception 'That component no longer exists.'; end if;
end;
$function$;

create or replace function inventory_assign_workstation(p_workstation_id uuid, p_profile_id uuid, p_note text default ''::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform inventory_check_manager();
  perform set_config('inventory.note', coalesce(p_note, ''), true);
  update workstations set assigned_to = p_profile_id where id = p_workstation_id;
  if not found then raise exception 'That workstation no longer exists.'; end if;
end;
$function$;

create or replace function set_content_delivery_date(p_content_id uuid, p_date date)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_entry content_bank%rowtype;
begin
  select * into v_entry from content_bank where id = p_content_id;
  if not found then
    raise exception 'That piece no longer exists.' using errcode = 'P0002';
  end if;
  if not (
    v_entry.created_by = auth.uid()
    or is_global_manager()
    or leads_project(v_entry.project_id)
    or is_content_team_leader()
  ) then
    raise exception 'Only the writer, the Project Leader, a Content Writers Team Leader or a manager can set the delivery date.'
      using errcode = '42501';
  end if;
  update content_bank set delivery_date = p_date where id = p_content_id;
end;
$function$;

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
 stable security definer
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

create or replace function can_create_project_drive(p_project_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
           select 1 from project_services
            where project_id = p_project_id and service = '3D Walkthrough Animation'
         )
     and (
           is_global_manager()
        or leads_project(p_project_id)
        or (is_team_leader()
            and can_see_project(p_project_id)
            and exists (
              select 1 from profile_departments
               where profile_id = auth.uid() and department = '3D Artists'
            ))
     );
$function$;

-- Records the folders once. A project that already has one keeps it, so a
-- second press cannot point the project somewhere else.
create or replace function set_project_drive_folders(p_project_id uuid, p_folder_id text, p_csf_folder_id text, p_team3d_folder_id text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not can_create_project_drive(p_project_id) then
    raise exception 'You can''t create this project''s Drive folder.' using errcode = '42501';
  end if;
  update projects
     set drive_folder_id        = p_folder_id,
         drive_csf_folder_id    = p_csf_folder_id,
         drive_team3d_folder_id = p_team3d_folder_id
   where id = p_project_id and drive_folder_id = '';
end;
$function$;

create or replace function can_assign_task(p_task_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select can_edit_task(p_task_id)
      or exists (
           select 1 from tasks t
            where t.id = p_task_id
              and t.project_id is not null
              and is_team_leader()
              and can_see_project(t.project_id)
         );
$function$;

create or replace function assign_task(p_task_id uuid, p_assignee uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_task tasks%rowtype;
begin
  if not can_assign_task(p_task_id) then
    raise exception 'You can''t assign this task.' using errcode = '42501';
  end if;

  select * into v_task from tasks where id = p_task_id;
  if v_task.assignee_id is not distinct from p_assignee then
    return;
  end if;
  if v_task.status in ('Submitted', 'Waiting for Client Response', 'Approved') then
    raise exception 'This task is % and can''t be reassigned.', lower(v_task.status::text)
      using errcode = '22023';
  end if;
  if p_assignee is not null and not exists (
       select 1
         from profiles p
         join profile_departments d on d.profile_id = p.id
        where p.id = p_assignee and p.active and d.department = v_task.department
     ) then
    raise exception 'Pick someone from the % department.', v_task.department
      using errcode = '22023';
  end if;

  -- The old assignee's timer stops here; their time stays logged.
  update time_sessions
     set ended_at = now(), end_reason = 'Switched', end_note = 'Task reassigned'
   where task_id = p_task_id and ended_at is null;

  update tasks
     set assignee_id = p_assignee,
         status      = 'Not Started'
   where id = p_task_id;
end;
$function$;

create or replace function record_task_assignment()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    if new.assignee_id is not null then
      insert into task_assignments (task_id, from_profile_id, to_profile_id, by_profile_id)
      values (new.id, null, new.assignee_id, auth.uid());
    end if;
  elsif new.assignee_id is distinct from old.assignee_id then
    insert into task_assignments (task_id, from_profile_id, to_profile_id, by_profile_id)
    values (new.id, old.assignee_id, new.assignee_id, auth.uid());
  end if;
  return null;
end;
$function$;

-- As drop_deleted_client_from_projects: an array has no foreign key.
create or replace function drop_deleted_client_from_tasks()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update tasks set client_ids = array_remove(client_ids, old.id)
   where old.id = any (client_ids);
  return old;
end;
$function$;

create or replace function can_see_clients()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select is_global_manager() or is_business_exec() or is_finance();
$function$;

create or replace function can_see_client_details()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select auth_role() in ('super_admin', 'admin') or is_business_exec() or is_finance();
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

create or replace function assign_group_number()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.parent_id is null then
    update projects
       set next_group_number = next_group_number + 1
     where id = new.project_id and is_3d
    returning next_group_number - 1 into new.number;
    if new.number is null then
      raise exception 'Only a 3D project has task groups.' using errcode = '22023';
    end if;
  else
    update task_groups
       set next_subgroup_number = next_subgroup_number + 1
     where id = new.parent_id and project_id = new.project_id and parent_id is null
    returning next_subgroup_number - 1 into new.number;
    if new.number is null then
      raise exception 'A sub-group goes in a group of the same project, and has no sub-groups of its own.'
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$function$;

-- Numbers a 3D task inside its sub-group from the sub-group's
-- next_task_number. A task is filed only in a sub-group, never straight in a
-- group, and stays where it is filed.
create or replace function assign_task_group_number()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' and new.group_id is not distinct from old.group_id then
    new.group_number := old.group_number;
    return new;
  end if;
  if tg_op = 'UPDATE' and old.group_id is not null then
    raise exception 'A task stays in its group once it is filed there.' using errcode = '22023';
  end if;
  if new.group_id is null then
    new.group_number := null;
    return new;
  end if;

  if exists (select 1 from task_groups where id = new.group_id and parent_id is null) then
    raise exception 'A task goes in a sub-group, not straight in a group.' using errcode = '22023';
  end if;

  update task_groups
     set next_task_number = next_task_number + 1
   where id = new.group_id and project_id = new.project_id
  returning next_task_number - 1 into new.group_number;
  if new.group_number is null then
    raise exception 'That group is not in this project.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

-- T1.4 added between T1.3 and T2.1: T2.1 moves from T1.3 to T1.4. Work that has
-- begun is never put back to waiting. The new task's own link is the form's.
-- Places follow the three-level order of task_group_place().
create or replace function place_task_in_chain()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_place integer[];
  v_prev  uuid;
  v_next  uuid;
begin
  if tg_op = 'UPDATE' and new.group_id is not distinct from old.group_id then
    return null;
  end if;
  if not exists (
    select 1 from projects p where p.id = new.project_id and p.is_3d and p.step_by_step
  ) then
    return null;
  end if;

  v_place := task_group_place(new.group_id) || new.group_number;

  select t.id into v_prev
    from tasks t
   where t.project_id = new.project_id and t.id <> new.id and t.group_id is not null
     and (task_group_place(t.group_id) || t.group_number) < v_place
   order by (task_group_place(t.group_id) || t.group_number) desc
   limit 1;

  select t.id into v_next
    from tasks t
   where t.project_id = new.project_id and t.id <> new.id and t.group_id is not null
     and (task_group_place(t.group_id) || t.group_number) > v_place
     and t.status = 'Not Started'
     and not exists (select 1 from time_sessions s where s.task_id = t.id)
   order by (task_group_place(t.group_id) || t.group_number)
   limit 1;

  if v_prev is null or v_next is null then
    return null;
  end if;

  delete from task_dependencies where task_id = v_next and depends_on_task_id = v_prev;
  if found then
    insert into task_dependencies (task_id, depends_on_task_id) values (v_next, new.id);
  end if;
  return null;
end;
$function$;

-- Deleting T1.2 from T1.1 -> T1.2 -> T1.3: T1.3 takes over what T1.2 waited on, so
-- the chain does not split. Deleting the head leaves the next one holding its
-- projected dates. Work that has begun is left alone.
create or replace function close_chain_gap()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- Inside a project's own delete the project row has already gone, so this
  -- does nothing there.
  if old.project_id is null or not exists (
    select 1 from projects p where p.id = old.project_id and p.is_3d and p.step_by_step
  ) then
    return old;
  end if;

  insert into task_dependencies (task_id, depends_on_task_id)
    select waiter.task_id, inherited.depends_on_task_id
      from task_dependencies waiter
      join tasks t on t.id = waiter.task_id
      join task_dependencies inherited on inherited.task_id = old.id
     where waiter.depends_on_task_id = old.id
       and t.status = 'Not Started'
       and not exists (select 1 from time_sessions s where s.task_id = t.id)
       and inherited.depends_on_task_id <> waiter.task_id
    on conflict do nothing;
  return old;
end;
$function$;

create or replace function is_3d_artist()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from profile_departments
     where profile_id = auth.uid() and department = '3D Artists'
  );
$function$;

create or replace function is_3d_team_leader()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select is_team_leader() and is_3d_artist();
$function$;

create or replace function is_3d_project(p_project_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (select 1 from projects where id = p_project_id and is_3d);
$function$;

create or replace function can_manage_task_groups(p_project_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select is_global_manager() or leads_project(p_project_id) or is_3d_team_leader();
$function$;

create or replace function guard_3d_content_task()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if is_3d_project(new.project_id) then
    raise exception 'A 3D project cannot have content tasks.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

create or replace function guard_3d_task_department()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- A task already there keeps its department until someone tries to change it.
  if tg_op = 'UPDATE'
     and new.department = old.department
     and new.project_id is not distinct from old.project_id then
    return new;
  end if;
  if is_3d_project(new.project_id) then
    raise exception 'A 3D project''s tasks belong to the 3D Artists department.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

create or replace function can_view_user_activity()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select auth_role() in ('super_admin', 'admin');
$function$;

create or replace function log_task_open(p_task_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null or not can_see_task(p_task_id) then
    return;
  end if;
  if exists (
    select 1 from task_opens
     where profile_id = auth.uid()
       and task_id = p_task_id
       and opened_at > now() - interval '10 minutes'
  ) then
    return;
  end if;
  insert into task_opens (profile_id, task_id) values (auth.uid(), p_task_id);
end;
$function$;

create or replace function task_versions()
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  with
    s as (select task_id, string_agg(x::text, '|' order by x.id) as agg from time_sessions x group by task_id),
    b as (select task_id, string_agg(x::text, '|' order by x.id) as agg from submissions x group by task_id),
    r as (select task_id, string_agg(x::text, '|' order by x.id) as agg from reviews x group by task_id),
    m as (select task_id, string_agg(x::text, '|' order by x.id) as agg from remarks x group by task_id),
    a as (select task_id, string_agg(x::text, '|' order by x.id) as agg from task_assignments x group by task_id),
    d as (
      select task_id, string_agg(x.depends_on_task_id::text, '|' order by x.depends_on_task_id) as agg
        from task_dependencies x group by task_id
    )
  select coalesce(
    jsonb_object_agg(
      t.id,
      left(md5(
        t::text
        || '#' || coalesce(s.agg, '')
        || '#' || coalesce(b.agg, '')
        || '#' || coalesce(r.agg, '')
        || '#' || coalesce(m.agg, '')
        || '#' || coalesce(a.agg, '')
        || '#' || coalesce(d.agg, '')
      ), 16)
    ),
    '{}'::jsonb
  )
    from tasks t
    left join s on s.task_id = t.id
    left join b on b.task_id = t.id
    left join r on r.task_id = t.id
    left join m on m.task_id = t.id
    left join a on a.task_id = t.id
    left join d on d.task_id = t.id;
$function$;

create or replace function task_group_place(p_group_id uuid)
 returns integer[]
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case when g.parent_id is null then array[g.number, 0]
              else array[p.number, g.number] end
    from task_groups g
    left join task_groups p on p.id = g.parent_id
   where g.id = p_group_id;
$function$;

create or replace function guard_shorts_plan()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_3d_project(new.project_id) then
    raise exception 'Only a 3D project has shorts.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

create or replace function assign_short_number()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update shorts_plans
     set next_short_number = next_short_number + 1
   where project_id = new.project_id
  returning next_short_number - 1 into new.number;
  if new.number is null then
    raise exception 'Set up the project''s Shorts first.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

create or replace function assign_cam_number()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' and new.short_id is not distinct from old.short_id then
    new.short_number := old.short_number;
    return new;
  end if;
  if tg_op = 'UPDATE' and old.short_id is not null then
    raise exception 'A cam stays in its short.' using errcode = '22023';
  end if;
  if new.short_id is null then
    new.short_number := null;
    return new;
  end if;

  update shorts
     set next_cam_number = next_cam_number + 1
   where id = new.short_id and project_id = new.project_id
  returning next_cam_number - 1 into new.short_number;
  if new.short_number is null then
    raise exception 'That short is not in this project.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

-- Everything a cam renders is in its own project: a group or sub-group, or a task
-- filed in one. Named once each.
create or replace function guard_cam_render()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if exists (
    select 1 from unnest(new.render_group_ids) x
     where not exists (
       select 1 from task_groups g where g.id = x and g.project_id = new.project_id)
  ) then
    raise exception 'A cam renders groups in its own project.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(new.render_task_ids) x
     where not exists (
       select 1 from tasks t
        where t.id = x and t.project_id = new.project_id and t.group_id is not null)
  ) then
    raise exception 'A cam renders tasks filed in groups of its own project.'
      using errcode = '22023';
  end if;
  if cardinality(new.render_group_ids) <> (select count(distinct x) from unnest(new.render_group_ids) x)
     or cardinality(new.render_task_ids) <> (select count(distinct x) from unnest(new.render_task_ids) x)
  then
    raise exception 'A cam names each thing it renders once.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

-- A deleted group or task leaves every cam that rendered it; the cam stays.
create or replace function drop_cam_render_links()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_table_name = 'task_groups' then
    update tasks set render_group_ids = array_remove(render_group_ids, old.id)
     where render_group_ids @> array[old.id];
  else
    update tasks set render_task_ids = array_remove(render_task_ids, old.id)
     where render_task_ids @> array[old.id];
  end if;
  return null;
end;
$function$;

-- Approving a designer's task moves the pieces allotted to it from Ready To
-- Design to Design Completed. A Static to Motion / Festival STM piece moves only
-- once its static and reel tasks are both approved. The transaction-local
-- pms.design_by_approval flag lets the update past the Design Completed guard.
create or replace function complete_content_design()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform set_config('pms.design_by_approval', 'on', true);
  update content_bank c
     set stage = 'Design Completed'
   where c.stage = 'Ready To Design'
     and (c.allotted_task_id = new.id or c.motion_allotted_task_id = new.id)
     -- The static part is approved: this task, or already.
     and c.allotted_task_id is not null
     and exists (
       select 1 from tasks s where s.id = c.allotted_task_id and s.status = 'Approved'
     )
     -- And a reel, if the piece has one to make, is approved too.
     and (
       not is_stm_type(c.type)
       or exists (
         select 1 from tasks m where m.id = c.motion_allotted_task_id and m.status = 'Approved'
       )
     );
  perform set_config('pms.design_by_approval', '', true);
  return null;
end;
$function$;

create or replace function may_be_allotted_content(p_profile_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select not exists (
    select 1 from profile_departments
     where profile_id = p_profile_id
       and department = 'Content Writers / Copywriters / Brand Strategists'
  );
$function$;

create or replace function guard_content_allottee()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.allotted_to is not null
     and (tg_op = 'INSERT' or new.allotted_task_id is distinct from old.allotted_task_id)
     and not may_be_allotted_content(new.allotted_to)
  then
    raise exception 'A content writer cannot be allotted a piece to design.' using errcode = '22023';
  end if;
  if new.motion_allotted_to is not null
     and (tg_op = 'INSERT' or new.motion_allotted_task_id is distinct from old.motion_allotted_task_id)
     and not may_be_allotted_content(new.motion_allotted_to)
  then
    raise exception 'A content writer cannot be allotted the reel editing of a piece.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

create or replace function set_content_placement(p_content_id uuid, p_placement content_placement)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_global_manager() then
    raise exception 'Only a Super Admin, an Admin or a Manager can change the placement.'
      using errcode = '42501';
  end if;
  if p_placement is null then
    raise exception 'Pick the content placement: SMM or WhatsApp Share.' using errcode = '23502';
  end if;
  update content_bank set placement = p_placement where id = p_content_id;
  if not found then
    raise exception 'That piece no longer exists.' using errcode = 'P0002';
  end if;
end;
$function$;

create or replace function guard_content_design_completed()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.stage = 'Design Completed'
     and (tg_op = 'INSERT' or old.stage is distinct from 'Design Completed')
     and auth.uid() is not null
     and coalesce(current_setting('pms.design_by_approval', true), '') <> 'on'
     and not is_global_manager()
  then
    raise exception 'Only a Super Admin, an Admin or a Manager can mark a piece Design Completed.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

create or replace function content_stage_step(p_stage content_stage)
 returns integer
 language sql
 immutable
as $function$
  select case p_stage
    when 'Ready To Design' then 1
    when 'Design Completed' then 2
    when 'Scheduled' then 3
    else 0
  end;
$function$;

-- A piece's status only moves forward (Not set -> Ready To Design -> Design
-- Completed -> Scheduled); Cancelled and Carry Forwarded any time, and coming
-- back from them ready_at / completed_at set the floor. Only a session with no
-- user steps back - and reopen_content_design(), through the transaction-local
-- pms.design_reopened flag.
create or replace function guard_content_stage_forward()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null
     or coalesce(current_setting('pms.design_reopened', true), '') = 'on'
     or new.stage is not distinct from old.stage
     or new.stage in ('Cancelled', 'Carry Forwarded')
  then
    return new;
  end if;
  if new.stage is null
     or content_stage_step(new.stage) < greatest(
          content_stage_step(old.stage),
          case when old.completed_at is not null then 2
               when old.ready_at is not null then 1
               else 0 end
        )
  then
    raise exception 'A piece''s status only moves forward. Cancelled and Carry Forwarded can be chosen at any time.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

create or replace function content_scheduled_delivery()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  -- A day picked with the Scheduled status becomes the delivery date.
  if new.stage = 'Scheduled' and new.scheduled_on is not null
     and (tg_op = 'INSERT'
          or old.stage is distinct from new.stage
          or old.scheduled_on is distinct from new.scheduled_on)
  then
    new.delivery_date := new.scheduled_on;
  end if;
  -- And the scheduled day is always the delivery date.
  new.scheduled_on := case when new.stage = 'Scheduled' then new.delivery_date end;
  return new;
end;
$function$;

create or replace function reopen_content_design()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform set_config('pms.design_reopened', 'on', true);
  update content_bank c
     set stage = 'Ready To Design'
   where c.stage = 'Design Completed'
     and (c.allotted_task_id = new.id or c.motion_allotted_task_id = new.id);
  perform set_config('pms.design_reopened', '', true);
  return null;
end;
$function$;

-- How many entries each record keeps.
create or replace function change_log_keep()
 returns integer
 language sql
 immutable
as $function$
  select 5;
$function$;

create or replace function log_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_type    text := tg_argv[0];
  v_skip    text[];
  v_body    text[];
  v_old     jsonb;
  v_new     jsonb;
  v_changes jsonb := '{}';
  v_last    change_log%rowtype;
  v_merged  jsonb;
  k         text;
begin
  if tg_op = 'DELETE' then
    delete from change_log where entity_type = v_type and entity_id = old.id;
    return null;
  end if;

  if tg_op = 'UPDATE' then
    v_skip := array['id', 'created_at', 'created_by', 'updated_at'] || case v_type
      when 'project' then array[
        'recurrence_anchor', 'recurrence_cursor', 'series_source_id', 'series_index',
        'series_date', 'next_group_number', 'drive_folder_id', 'drive_csf_folder_id',
        'drive_team3d_folder_id']
      when 'task' then array[
        'recurrence_anchor', 'recurrence_cursor', 'series_source_id', 'series_index',
        'series_date', 'group_number', 'short_number', 'depends_on_task_id',
        'thumbnail_file_id', 'thumbnail_url']
      else array[
        'started_by', 'ready_at', 'allotted_at', 'completed_at', 'scheduled_on', 'slot']
    end;
    v_body := array[
      'description', 'on_pic', 'caption', 'reference_links', 'client_supe_notes',
      'shots_brief', 'camera_angles', 'lead_note', 'general_notes'];

    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    for k in select jsonb_object_keys(v_new) loop
      continue when k = any (v_skip);
      if (v_new -> k) is distinct from (v_old -> k) then
        v_changes := v_changes || jsonb_build_object(
          k,
          case when k = any (v_body) then '[null, null]'::jsonb
               else jsonb_build_array(v_old -> k, v_new -> k) end);
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return null;
    end if;

    -- Already written to in this request: fold this into that entry.
    select * into v_last
      from change_log
     where entity_type = v_type and entity_id = new.id and tx = txid_current()
     order by changed_at desc
     limit 1;
    if found then
      if v_last.action = 'created' then
        return null;
      end if;
      v_merged := v_last.changes;
      for k in select jsonb_object_keys(v_changes) loop
        v_merged := v_merged || jsonb_build_object(
          k,
          jsonb_build_array(
            coalesce(v_last.changes -> k -> 0, v_changes -> k -> 0),
            v_changes -> k -> 1));
        -- Changed and changed back: nothing to show.
        if k <> all (v_body) and (v_merged -> k -> 0) is not distinct from (v_merged -> k -> 1) then
          v_merged := v_merged - k;
        end if;
      end loop;
      if v_merged = '{}'::jsonb then
        delete from change_log where id = v_last.id;
      else
        update change_log set changes = v_merged where id = v_last.id;
      end if;
      return null;
    end if;
  end if;

  insert into change_log (entity_type, entity_id, action, changes, changed_by)
  values (v_type, new.id, case when tg_op = 'INSERT' then 'created' else 'updated' end,
          v_changes, auth.uid());

  -- Keep the newest few.
  delete from change_log c
   where c.entity_type = v_type and c.entity_id = new.id
     and c.id not in (
       select x.id from change_log x
        where x.entity_type = v_type and x.entity_id = new.id
        order by x.changed_at desc, x.id desc
        limit change_log_keep());
  return null;
end;
$function$;

-- The piece other than p_content_id already allotted to p_task_id, if any.
create or replace function task_held_piece(p_task_id uuid, p_content_id uuid)
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select c.id from content_bank c
   where (c.allotted_task_id = p_task_id or c.motion_allotted_task_id = p_task_id)
     and c.id is distinct from p_content_id
   limit 1;
$function$;

create or replace function guard_content_one_per_task()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  t uuid;
begin
  foreach t in array array[
    case when new.allotted_task_id is not null
          and (tg_op = 'INSERT' or new.allotted_task_id is distinct from old.allotted_task_id)
         then new.allotted_task_id end,
    case when new.motion_allotted_task_id is not null
          and (tg_op = 'INSERT' or new.motion_allotted_task_id is distinct from old.motion_allotted_task_id)
         then new.motion_allotted_task_id end]
  loop
    continue when t is null;
    -- Two allotments to the same task at once: the second waits for the first.
    perform pg_advisory_xact_lock(hashtext('content_one_per_task'), hashtext(t::text));
    if task_held_piece(t, new.id) is not null then
      raise exception 'That task already has a piece allotted. A task takes one piece: pick another task or create a new one.'
        using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$function$;

-- One copy of a repeating project: the project, its services, members, tasks
-- and their dependencies. p_day is the date the rule produced (series_date),
-- p_start the day the copy starts.
create or replace function make_project_occurrence(p_source_id uuid, p_day date, p_index integer, p_start date, p_name text, p_notify boolean)
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
create or replace function make_task_occurrence(p_source_id uuid, p_day date, p_index integer, p_start date, p_name text, p_notify boolean)
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

-- Where a blueprint stands on p_after: how many of its dates have come
-- (last_index), and its next date after p_after that has no copy yet - one
-- already brought forward is passed over - with that date's number.
create or replace function recurrence_position(p_kind text, p_source_id uuid, p_rule jsonb, p_anchor date, p_after date, out last_index integer, out next_day date, out next_index integer)
 returns record
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
