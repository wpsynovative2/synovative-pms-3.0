-- =============================================================================
-- Per-person daily capacity, and individual tasks moving under /tasks.
-- Run after 0010_flexible_assignment.sql.
--
-- Workload assumed a flat 8 hours per working day for everyone. Capacity is now
-- a property of the person, so part-timers and shared resources are planned
-- honestly. It is an HR setting, not a self-service one.
-- =============================================================================

alter table profiles
  add column if not exists capacity_hours_per_day numeric(4, 2) not null default 8;

alter table profiles drop constraint if exists profiles_capacity_sane;
alter table profiles add constraint profiles_capacity_sane
  check (capacity_hours_per_day > 0 and capacity_hours_per_day <= 24);

-- Capacity drives workload and over-allocation warnings, so it belongs with the
-- people who manage accounts - not with the person whose capacity it is.
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
$$;

-- Individual tasks now live on /tasks behind a type filter rather than on their
-- own page, so notifications must land there. Links already written to the
-- notifications table keep pointing at /individual-tasks, which the app still
-- serves as a redirect.
create or replace function task_href(p_task_id uuid, p_project_id uuid)
returns text language sql immutable as $$
  select case
    when p_project_id is null then '/tasks?type=individual&task=' || p_task_id
    else '/projects/' || p_project_id || '?task=' || p_task_id
  end;
$$;
