-- =============================================================================
-- Optional Project Leader, optional assignee, department-wide Team Leaders,
-- and the "Waiting for Client Response" outcome added in 0009.
-- Run after 0009_review_outcomes.sql.
--
-- Four related changes:
--   1. A project may have no leader, and a task may have no assignee, so work
--      can be planned before it is handed out (a template creates its tasks
--      unassigned).
--   2. A Team Leader sees every project their department works on, whether or
--      not any task in it is theirs -- but reviews only the tasks they allotted.
--   3. A review can park a task with the client instead of settling it.
--   4. Work submitted on time is no longer "overdue" while it waits to be
--      reviewed; the delay there is the reviewer's, not the assignee's.
-- =============================================================================

alter table projects alter column leader_id   drop not null;
alter table tasks    alter column assignee_id drop not null;

-- Work that has been planned but not handed out yet is a list people will ask
-- for; keep it cheap to find.
create index if not exists tasks_unassigned_idx on tasks (project_id)
  where assignee_id is null;

-- ------------------------------------------------------------ plumbing ---

-- Callers now pass arrays that may hold a NULL (an unassigned task, a project
-- with no leader). Skip those rather than violating notifications.profile_id.
create or replace function notify(
  p_profile_ids uuid[], p_type notification_type,
  p_title text, p_body text, p_href text
) returns void
language sql
security definer
set search_path = public
as $$
  insert into notifications (profile_id, type, title, body, href)
  select distinct id, p_type, p_title, p_body, p_href
    from unnest(p_profile_ids) as id
   where id is not null;
$$;

-- Parking a task with the client is not a verdict, so it carries no source.
alter table reviews drop constraint source_required_unless_approved;
alter table reviews add constraint source_required_unless_approved check (
  decision in ('Approved', 'Waiting for Client Response') or source is not null
);

-- ------------------------------------------------------------- overdue ---

-- A task is late only while the delay is still ours. Approved work is done;
-- work parked with the client is waiting on them; and work submitted on or
-- before its due date is waiting on a reviewer. Anything else past its due
-- date is genuinely late.
create or replace function task_is_overdue(
  p_task_id uuid, p_status task_status, p_due_date date
) returns boolean
language sql
stable
set search_path = public
as $$
  select case
    when p_status in ('Approved', 'Waiting for Client Response') then false
    when p_due_date >= current_date then false
    when p_status = 'Submitted' and (
      select max(s.submitted_at) from submissions s where s.task_id = p_task_id
    )::date <= p_due_date then false
    else true
  end;
$$;

-- ---------------------------------------------------------- visibility ---

-- Global managers see everything. Everyone else sees a project they lead or
-- hold a task in; a Team Leader also sees any project their department is
-- working on, so they can follow work they allotted to their team.
create or replace function can_see_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
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
$$;

-- Project tasks: managers or the project's leader. Individual tasks: managers
-- only. A Team Leader reviews the tasks they allotted themselves, wherever
-- those sit -- seeing a department's project does not make them its reviewer.
create or replace function can_review_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tasks t
    where t.id = p_task_id
      and (
        is_global_manager()
        or (is_team_leader() and t.created_by = auth.uid())
        or (t.project_id is not null and leads_project(t.project_id))
      )
  );
$$;

-- --------------------------------------------------------------- submit ---

create or replace function submit_task(
  p_task_id uuid,
  p_output output_location,
  p_drive_link text,
  p_description text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- --------------------------------------------------------------- review ---

create or replace function review_task(
  p_task_id       uuid,
  p_decision      review_decision,
  p_remarks       text,
  p_source        review_source default null,
  p_new_assignee  uuid default null,
  p_new_due_date  date default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- -------------------------------------------------------- notifications ---

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

-- The daily 9:00 AM IST sweep: skip tasks nobody holds, and use the same
-- definition of "late" the app shows.
create or replace function notify_due_and_overdue()
returns integer
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- ----------------------------------------------------------------- views ---

create or replace view project_stats as
select
  p.id                                                as project_id,
  count(t.id)                                         as total_tasks,
  count(t.id) filter (where t.status = 'Approved')    as approved_tasks,
  case when count(t.id) = 0 then 0
       else round(100.0 * count(t.id) filter (where t.status = 'Approved') / count(t.id))
  end                                                 as progress_pct,
  count(t.id) filter (
    where task_is_overdue(t.id, t.status, t.due_date)
  )                                                   as overdue_tasks,
  coalesce(sum(tt.seconds_logged), 0)                 as seconds_logged,
  coalesce(sum(t.estimated_hours), 0)                 as estimated_hours
from projects p
left join tasks t        on t.project_id = p.id
left join task_totals tt on tt.task_id = t.id
group by p.id;
