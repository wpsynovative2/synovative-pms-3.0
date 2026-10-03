-- =============================================================================
-- Task and project visibility — a Team Leader is no longer a special case.
-- Run after 0007_account_guards.sql.
--
-- Until now a Team Leader could read every project and every task in their
-- departments. Visibility now works the same way for everyone below global
-- manager: you see a project once you hold at least one task in it (or lead
-- it), and you see a task when it is yours, you created it, or it sits in a
-- project you can already see.
--
-- Super Admin / Admin / Manager are unchanged and still see everything.
-- =============================================================================

-- §4.2 — a user sees a project when they lead it or hold at least one task in
-- it. Team-member listing alone grants nothing, and neither does leading a
-- department; global managers see all of them.
create or replace function can_see_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    is_global_manager()
    or exists (select 1 from projects p
               where p.id = p_project_id and p.leader_id = auth.uid())
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
        or (t.project_id is not null and can_see_project(t.project_id))
      )
  );
$$;

drop policy tasks_read on tasks;

create policy tasks_read on tasks
  for select to authenticated
  using (
    is_global_manager()
    or assignee_id = auth.uid()
    or created_by  = auth.uid()
    or (project_id is not null and can_see_project(project_id))
  );

-- can_see_project() runs once per row for tasks, project_services and
-- project_members, and its hot path is "does this person hold a task in this
-- project". The single-column indexes make that two lookups; this makes it one.
create index if not exists tasks_project_assignee_idx on tasks (project_id, assignee_id);
