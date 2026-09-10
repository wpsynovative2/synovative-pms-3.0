-- =============================================================================
-- Row Level Security — the authoritative version of the §4.2 permission matrix.
-- PRD §19: "Enforce role access with Row Level Security policies, not only in
-- the UI." The client checks in lib/permissions.ts mirror these; these win.
-- =============================================================================

-- ------------------------------------------------------------- helpers ----
-- SECURITY DEFINER so a policy on `profiles` can read `profiles` without
-- recursing through its own RLS. Each is STABLE and indexed-lookup only.

create or replace function auth_role()
returns app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid() and active;
$$;

create or replace function is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select auth_role() = 'super_admin';
$$;

create or replace function is_global_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select auth_role() in ('super_admin', 'admin', 'manager');
$$;

create or replace function is_hr_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select auth_role() in ('super_admin', 'hr_admin');
$$;

create or replace function is_team_leader()
returns boolean language sql stable security definer set search_path = public as $$
  select auth_role() = 'team_leader';
$$;

create or replace function my_departments()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(department), '{}')
  from profile_departments where profile_id = auth.uid();
$$;

-- Expense approval comes from the department, not the role (§4.1).
create or replace function is_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profile_departments
    where profile_id = auth.uid() and department = 'Accounts & Finance'
  );
$$;

create or replace function leads_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects where id = p_project_id and leader_id = auth.uid()
  );
$$;

-- §4.2 — a user sees a project when they lead it, are a member, or hold at
-- least one task in it; global managers and team leaders see all of them.
create or replace function can_see_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    is_global_manager()
    or is_team_leader()
    or exists (select 1 from projects p
               where p.id = p_project_id and p.leader_id = auth.uid())
    or exists (select 1 from project_members m
               where m.project_id = p_project_id and m.profile_id = auth.uid())
    or exists (select 1 from tasks t
               where t.project_id = p_project_id and t.assignee_id = auth.uid());
$$;

create or replace function can_see_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tasks t
    where t.id = p_task_id
      and (
        is_global_manager()
        or t.assignee_id = auth.uid()
        or t.created_by  = auth.uid()
        or (is_team_leader() and t.department = any (my_departments()))
        or (t.project_id is not null and can_see_project(t.project_id))
      )
  );
$$;

-- §12.2 — project tasks: leader or global manager. Individual: global manager.
create or replace function can_review_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tasks t
    where t.id = p_task_id
      and (
        is_global_manager()
        or (t.project_id is not null and leads_project(t.project_id))
      )
  );
$$;

-- §4.2 — full task edit rights (title, dates, assignee, estimate…).
create or replace function can_edit_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tasks t
    where t.id = p_task_id
      and (
        is_global_manager()
        or (t.project_id is not null and leads_project(t.project_id))
        or (is_team_leader() and t.created_by = auth.uid())
      )
  );
$$;

-- ------------------------------------------------------- enable RLS ------

alter table profiles                 enable row level security;
alter table profile_departments      enable row level security;
alter table projects                 enable row level security;
alter table project_services         enable row level security;
alter table project_members          enable row level security;
alter table tasks                    enable row level security;
alter table time_sessions            enable row level security;
alter table submissions              enable row level security;
alter table reviews                  enable row level security;
alter table remarks                  enable row level security;
alter table vendors                  enable row level security;
alter table expenses                 enable row level security;
alter table project_templates        enable row level security;
alter table project_template_services enable row level security;
alter table project_template_tasks   enable row level security;
alter table task_templates           enable row level security;
alter table holidays                 enable row level security;
alter table working_overrides        enable row level security;
alter table notifications            enable row level security;
alter table departments              enable row level security;
alter table services                 enable row level security;

-- ------------------------------------------------- master data (read-only) --

create policy departments_read on departments
  for select to authenticated using (true);

create policy services_read on services
  for select to authenticated using (true);

-- ------------------------------------------------------------- profiles ---

-- Everyone can see the directory — assignee pickers need it.
create policy profiles_read on profiles
  for select to authenticated using (true);

-- §4.2 — Super Admin, Admin and HR Admin add users.
create policy profiles_insert on profiles
  for insert to authenticated
  with check (auth_role() in ('super_admin', 'admin', 'hr_admin'));

create policy profiles_update on profiles
  for update to authenticated
  using (auth_role() in ('super_admin', 'admin', 'hr_admin') or id = auth.uid())
  with check (auth_role() in ('super_admin', 'admin', 'hr_admin') or id = auth.uid());

-- §4.2 — only a Super Admin deletes.
create policy profiles_delete on profiles
  for delete to authenticated using (is_super_admin());

create policy profile_departments_read on profile_departments
  for select to authenticated using (true);

create policy profile_departments_write on profile_departments
  for all to authenticated
  using (auth_role() in ('super_admin', 'admin', 'hr_admin'))
  with check (auth_role() in ('super_admin', 'admin', 'hr_admin'));

-- ------------------------------------------------------------- projects ---

create policy projects_read on projects
  for select to authenticated using (can_see_project(id));

-- §4.2 — Super Admin, Admin and Manager create projects.
create policy projects_insert on projects
  for insert to authenticated with check (is_global_manager());

-- Global managers edit any project; a Project Leader edits their own.
create policy projects_update on projects
  for update to authenticated
  using (is_global_manager() or leader_id = auth.uid())
  with check (is_global_manager() or leader_id = auth.uid());

create policy projects_delete on projects
  for delete to authenticated
  using (is_global_manager() or leader_id = auth.uid());

create policy project_services_read on project_services
  for select to authenticated using (can_see_project(project_id));

create policy project_services_write on project_services
  for all to authenticated
  using (is_global_manager() or leads_project(project_id))
  with check (is_global_manager() or leads_project(project_id));

create policy project_members_read on project_members
  for select to authenticated using (can_see_project(project_id));

create policy project_members_write on project_members
  for all to authenticated
  using (is_global_manager() or leads_project(project_id))
  with check (is_global_manager() or leads_project(project_id));

-- ---------------------------------------------------------------- tasks ---

create policy tasks_read on tasks
  for select to authenticated
  using (
    is_global_manager()
    or assignee_id = auth.uid()
    or created_by  = auth.uid()
    or (is_team_leader() and department = any (my_departments()))
    or (project_id is not null and can_see_project(project_id))
  );

-- §4.2 — project tasks: managers, the project's leader, or any Team Leader.
--        individual tasks (§10): managers and Team Leaders only.
create policy tasks_insert on tasks
  for insert to authenticated
  with check (
    case
      when project_id is null then is_global_manager() or is_team_leader()
      else is_global_manager() or leads_project(project_id) or is_team_leader()
    end
  );

-- Assignees update their own row only through the RPCs below; a direct UPDATE
-- requires full edit rights.
create policy tasks_update on tasks
  for update to authenticated
  using (can_edit_task(id))
  with check (can_edit_task(id));

create policy tasks_delete on tasks
  for delete to authenticated using (can_edit_task(id));

-- -------------------------------------------------------- time tracking ---

create policy time_sessions_read on time_sessions
  for select to authenticated
  using (profile_id = auth.uid() or can_see_task(task_id));

-- §4.2 — the timer belongs to the assignee alone.
create policy time_sessions_insert on time_sessions
  for insert to authenticated
  with check (
    profile_id = auth.uid()
    and exists (select 1 from tasks t where t.id = task_id and t.assignee_id = auth.uid())
  );

create policy time_sessions_update on time_sessions
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ------------------------------------------------ submissions & reviews ---

create policy submissions_read on submissions
  for select to authenticated using (can_see_task(task_id));

create policy submissions_insert on submissions
  for insert to authenticated
  with check (
    by_profile_id = auth.uid()
    and exists (select 1 from tasks t where t.id = task_id and t.assignee_id = auth.uid())
  );

create policy reviews_read on reviews
  for select to authenticated using (can_see_task(task_id));

create policy reviews_insert on reviews
  for insert to authenticated
  with check (by_profile_id = auth.uid() and can_review_task(task_id));

-- §9.4 — remarks are visible to everyone who can see the task.
create policy remarks_read on remarks
  for select to authenticated using (can_see_task(task_id));

create policy remarks_insert on remarks
  for insert to authenticated
  with check (by_profile_id = auth.uid() and can_see_task(task_id));

-- ------------------------------------------------------------- vendors ---

create policy vendors_read on vendors
  for select to authenticated using (true);

create policy vendors_write on vendors
  for all to authenticated
  using (is_global_manager() or is_finance())
  with check (is_global_manager() or is_finance());

-- ------------------------------------------------------------ expenses ---

create policy expenses_read on expenses
  for select to authenticated
  using (is_finance() or can_see_project(project_id));

-- §4.2 — only the Project Leader adds expenses to their project.
create policy expenses_insert on expenses
  for insert to authenticated
  with check (leads_project(project_id) and status = 'Pending');

-- §8 — the leader may edit only while Pending; Finance sets the verdict.
create policy expenses_update_leader on expenses
  for update to authenticated
  using (leads_project(project_id) and status = 'Pending')
  with check (leads_project(project_id) and status = 'Pending');

create policy expenses_update_finance on expenses
  for update to authenticated
  using (is_finance())
  with check (is_finance());

create policy expenses_delete on expenses
  for delete to authenticated
  using (leads_project(project_id) and status = 'Pending');

-- ----------------------------------------------------------- templates ---
-- Readable by all (they are offered in the create forms); §13 restricts
-- management to Super Admin and Admin.

create policy project_templates_read on project_templates
  for select to authenticated using (true);

create policy project_templates_write on project_templates
  for all to authenticated
  using (auth_role() in ('super_admin', 'admin'))
  with check (auth_role() in ('super_admin', 'admin'));

create policy pts_read on project_template_services
  for select to authenticated using (true);

create policy pts_write on project_template_services
  for all to authenticated
  using (auth_role() in ('super_admin', 'admin'))
  with check (auth_role() in ('super_admin', 'admin'));

create policy ptt_read on project_template_tasks
  for select to authenticated using (true);

create policy ptt_write on project_template_tasks
  for all to authenticated
  using (auth_role() in ('super_admin', 'admin'))
  with check (auth_role() in ('super_admin', 'admin'));

create policy task_templates_read on task_templates
  for select to authenticated using (true);

create policy task_templates_write on task_templates
  for all to authenticated
  using (auth_role() in ('super_admin', 'admin'))
  with check (auth_role() in ('super_admin', 'admin'));

-- ---------------------------------------------------- working calendar ---
-- Everyone reads it (every date picker depends on it); §4.2 limits writes to
-- Super Admin and HR Admin.

create policy holidays_read on holidays
  for select to authenticated using (true);

create policy holidays_write on holidays
  for all to authenticated using (is_hr_admin()) with check (is_hr_admin());

create policy overrides_read on working_overrides
  for select to authenticated using (true);

create policy overrides_write on working_overrides
  for all to authenticated using (is_hr_admin()) with check (is_hr_admin());

-- -------------------------------------------------------- notifications ---
-- §19 — the only Realtime subscription in the app is the current user's own
-- notification stream, so this policy is the whole security boundary for it.

create policy notifications_read on notifications
  for select to authenticated using (profile_id = auth.uid());

create policy notifications_update on notifications
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- Notifications are written by the SECURITY DEFINER RPCs below, never directly.

-- =============================================================================
-- Workflow RPCs — the state transitions the UI is allowed to make.
-- Each re-checks the rule itself, so it is safe as SECURITY DEFINER.
-- =============================================================================

create or replace function notify(
  p_profile_ids uuid[], p_type notification_type,
  p_title text, p_body text, p_href text
) returns void
language sql
security definer
set search_path = public
as $$
  insert into notifications (profile_id, type, title, body, href)
  select distinct unnest(p_profile_ids), p_type, p_title, p_body, p_href;
$$;

/* §11.1 Start / Resume — closes any other running timer for this user first. */
create or replace function start_timer(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;

/* §11.2 Pause — "End of day" or "Switched to <project>". */
create or replace function pause_timer(
  p_task_id uuid,
  p_reason session_end_reason default 'End of day',
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update time_sessions
     set ended_at = now(), end_reason = p_reason, end_note = p_note
   where task_id = p_task_id and profile_id = auth.uid() and ended_at is null;
end;
$$;

/* §12.1 Submit — stops the timer, records the submission, notifies reviewers. */
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
  v_name       text;
begin
  select * into v_task from tasks where id = p_task_id;
  if v_task.assignee_id <> auth.uid() then
    raise exception 'Only the assignee can submit this task';
  end if;

  update time_sessions
     set ended_at = now(), end_reason = 'Submitted'
   where task_id = p_task_id and profile_id = auth.uid() and ended_at is null;

  insert into submissions (task_id, by_profile_id, output_location, drive_link, description)
  values (p_task_id, auth.uid(), p_output, p_drive_link, p_description)
  returning id into v_submission;

  update tasks set status = 'Submitted' where id = p_task_id;

  -- §17 — Project Leader for project tasks; managers for individual tasks.
  if v_task.project_id is null then
    select array_agg(id) into v_reviewers
      from profiles where active and role in ('super_admin', 'admin', 'manager');
  else
    select array[leader_id] into v_reviewers from projects where id = v_task.project_id;
  end if;

  select full_name into v_name from profiles where id = auth.uid();
  perform notify(
    coalesce(v_reviewers, '{}'), 'task_submitted',
    'Task submitted for review',
    v_name || ' submitted "' || v_task.title || '".',
    '/tasks?task=' || p_task_id
  );

  return v_submission;
end;
$$;

/* §12.2 Review — Approve, Changes Required, or Reject (which reassigns). */
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
    -- Same assignee reworks and resubmits.
    update tasks set status = 'Changes Required' where id = p_task_id;

  else
    -- Reject → reassign and reset. History is preserved by design.
    update tasks
       set status      = 'Not Started',
           assignee_id = coalesce(p_new_assignee, v_task.assignee_id),
           due_date    = coalesce(p_new_due_date, v_task.due_date)
     where id = p_task_id;

    if coalesce(p_new_assignee, v_task.assignee_id) <> v_task.assignee_id then
      perform notify(
        array[p_new_assignee], 'task_assigned', 'Task reassigned to you',
        '"' || v_task.title || '" was reassigned to you after a rejection.',
        '/tasks?task=' || p_task_id
      );
    end if;
  end if;

  perform notify(
    array[v_task.assignee_id], 'review_decision',
    'Review: ' || p_decision,
    '"' || v_task.title || '" was marked ' || p_decision || '.',
    '/tasks?task=' || p_task_id
  );

  return v_review;
end;
$$;

/* §8 — Accounts & Finance verify an expense. */
create or replace function review_expense(
  p_expense_id uuid, p_approved boolean, p_remarks text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;
