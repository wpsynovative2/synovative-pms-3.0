-- =============================================================================
-- What the live app needs beyond 0001–0004
-- Run after 0004_recurrence.sql.
--
--  1. Closes a privilege hole: profiles_update let any user edit their own row,
--     including `role`. A trigger now pins who may change what (§4.2, §6).
--  2. Server-side notifications for the events the browser used to fan out
--     itself (§17): task assigned / reassigned, assignee remark, expense added.
--  3. Schema gaps: task template start offset, created_by defaults.
--  4. Directory-style reads limited to active PMS members, not any login.
--  5. Realtime on notifications — the one live subscription the app uses (§19).
-- =============================================================================

-- ---------------------------------------------------------- schema gaps ---

alter table task_templates
  add column if not exists start_offset_days integer not null default 0;

-- The client sends these too, but the database is the source of truth.
alter table projects alter column created_by set default auth.uid();
alter table tasks    alter column created_by set default auth.uid();
alter table expenses alter column created_by set default auth.uid();

-- Link that opens a task wherever it lives in the app.
create or replace function task_href(p_task_id uuid, p_project_id uuid)
returns text language sql immutable as $$
  select case
    when p_project_id is null then '/individual-tasks?task=' || p_task_id
    else '/projects/' || p_project_id || '?task=' || p_task_id
  end;
$$;

-- ------------------------------------------------ profile update guard ---

-- RLS decides *whose* row can be updated; this decides *which columns*.
--   · Anyone may change their own full_name and clear must_change_password.
--   · Super Admin / Admin / HR Admin may edit other people's accounts.
--   · Only a Super Admin may grant or revoke the Admin or Super Admin role (§4.2).
--   · Nobody but a Super Admin may modify a Super Admin's account.
-- Server routes run with the service role (auth.uid() is null) and re-check
-- these rules in code before writing, so they pass straight through.
create or replace function guard_profile_update()
returns trigger language plpgsql set search_path = public as $$
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

  if new.role is distinct from old.role
     and (new.role in ('admin', 'super_admin') or old.role in ('admin', 'super_admin'))
     and v_actor <> 'super_admin' then
    raise exception 'Only a Super Admin can grant or remove the Admin role.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_update
  before update on profiles
  for each row execute function guard_profile_update();

-- Direct inserts go through the server route; keep role grants honest there too.
create or replace function guard_profile_insert()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null
     and new.role in ('admin', 'super_admin')
     and auth_role() <> 'super_admin' then
    raise exception 'Only a Super Admin can grant the Admin role.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_insert
  before insert on profiles
  for each row execute function guard_profile_insert();

-- ------------------------------------------------ notification triggers ---

-- §17 "Task assigned or reassigned → new assignee". Covers direct creates and
-- edits as well as rejections that reassign (review_task below no longer sends
-- its own copy). Skipped for the scheduled generator, which writes its own
-- notification, and when someone assigns a task to themselves.
create or replace function notify_task_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_project text;
begin
  if auth.uid() is null or new.assignee_id = auth.uid() then
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

create trigger tasks_notify_assignment
  after insert or update of assignee_id on tasks
  for each row execute function notify_task_assignment();

-- §17 "Remark added by assignee → reviewers".
create or replace function notify_remark()
returns trigger language plpgsql security definer set search_path = public as $$
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
$$;

create trigger remarks_notify
  after insert on remarks
  for each row execute function notify_remark();

-- §17 "Expense added → Accounts & Finance".
create or replace function notify_expense_added()
returns trigger language plpgsql security definer set search_path = public as $$
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
$$;

create trigger expenses_notify_added
  after insert on expenses
  for each row execute function notify_expense_added();

-- review_task from 0002, minus its own reassignment notification (the
-- assignment trigger above now sends it) and with links that open the task.
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
    update tasks set status = 'Changes Required' where id = p_task_id;
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

-- ------------------------------------------- members-only directory reads ---

-- 0002 let *any* authenticated login read the directory, vendors, templates
-- and the calendar. Supabase logins are per project, so in a project shared
-- with another app (or for a deactivated account) that is too wide. These
-- reads now require an active PMS profile.
create or replace function is_active_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active);
$$;

drop policy if exists departments_read on departments;
create policy departments_read on departments
  for select to authenticated using (is_active_member());

drop policy if exists services_read on services;
create policy services_read on services
  for select to authenticated using (is_active_member());

-- Everyone still needs to read their *own* profile to learn they're inactive.
drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles
  for select to authenticated using (is_active_member() or id = auth.uid());

drop policy if exists profile_departments_read on profile_departments;
create policy profile_departments_read on profile_departments
  for select to authenticated using (is_active_member());

drop policy if exists vendors_read on vendors;
create policy vendors_read on vendors
  for select to authenticated using (is_active_member());

drop policy if exists project_templates_read on project_templates;
create policy project_templates_read on project_templates
  for select to authenticated using (is_active_member());

drop policy if exists pts_read on project_template_services;
create policy pts_read on project_template_services
  for select to authenticated using (is_active_member());

drop policy if exists ptt_read on project_template_tasks;
create policy ptt_read on project_template_tasks
  for select to authenticated using (is_active_member());

drop policy if exists task_templates_read on task_templates;
create policy task_templates_read on task_templates
  for select to authenticated using (is_active_member());

drop policy if exists holidays_read on holidays;
create policy holidays_read on holidays
  for select to authenticated using (is_active_member());

drop policy if exists overrides_read on working_overrides;
create policy overrides_read on working_overrides
  for select to authenticated using (is_active_member());

-- ------------------------------------------------------------ realtime ---

-- §19 — the app subscribes to the signed-in user's own notification inserts;
-- notifications_read (0002) limits each subscriber to their own rows.
alter publication supabase_realtime add table notifications;
