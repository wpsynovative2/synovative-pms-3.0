-- =============================================================================
-- Faster reads, same rules. Run after 0009_recurring_blueprints.sql.
--
-- The read policies called can_see_project() / can_see_task() once per row,
-- and each call ran its own lookups (the caller's role, the project's leader,
-- the caller's tasks in it). Loading the workspace reads every visible task,
-- session, submission, review and remark, so a few thousand rows became tens of
-- thousands of small queries - enough to hit Supabase's statement timeout
-- ("canceling statement due to statement timeout").
--
-- Now the caller's visible projects and tasks are worked out once per query,
-- as arrays (my_project_ids / my_task_ids), and every auth.uid() and role check
-- in a read policy is wrapped in (select ...) so Postgres evaluates it once
-- rather than per row. Who may see what is unchanged: the arrays are exactly
-- can_see_project() / can_see_task() without their global-manager branch,
-- which each policy checks first.
-- =============================================================================

-- Projects the caller sees without being a global manager: ones they lead,
-- ones they hold a task in, and - for a Team Leader - ones their departments
-- have work in. Mirrors can_see_project().
create or replace function my_project_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct id), '{}') from (
    select p.id from projects p where p.leader_id = auth.uid()
    union
    select t.project_id from tasks t
     where t.assignee_id = auth.uid() and t.project_id is not null
    union
    select t.project_id from tasks t
     where is_team_leader() and t.project_id is not null
       and t.department = any (my_departments())
  ) visible;
$$;

-- Tasks the caller sees without being a global manager. Mirrors can_see_task().
create or replace function my_task_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(t.id), '{}') from tasks t
   where t.assignee_id = auth.uid()
      or t.created_by = auth.uid()
      or t.project_id = any (my_project_ids());
$$;

-- The lookups above, and the policies below, by column.
create index if not exists tasks_created_by_idx on tasks (created_by);
create index if not exists tasks_project_assignee_idx on tasks (project_id, assignee_id);

-- ------------------------------------------------------------- work ----

drop policy if exists projects_read on projects;
create policy projects_read on projects for select to authenticated
  using ((select is_global_manager()) or id = any ((select my_project_ids())::uuid[]));

drop policy if exists project_services_read on project_services;
create policy project_services_read on project_services for select to authenticated
  using ((select is_global_manager()) or project_id = any ((select my_project_ids())::uuid[]));

drop policy if exists project_members_read on project_members;
create policy project_members_read on project_members for select to authenticated
  using ((select is_global_manager()) or project_id = any ((select my_project_ids())::uuid[]));

drop policy if exists tasks_read on tasks;
create policy tasks_read on tasks for select to authenticated
  using (
    (select is_global_manager())
    or assignee_id = (select auth.uid())
    or created_by = (select auth.uid())
    or project_id = any ((select my_project_ids())::uuid[])
  );

drop policy if exists time_sessions_read on time_sessions;
create policy time_sessions_read on time_sessions for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (select is_global_manager())
    or task_id = any ((select my_task_ids())::uuid[])
  );

drop policy if exists submissions_read on submissions;
create policy submissions_read on submissions for select to authenticated
  using ((select is_global_manager()) or task_id = any ((select my_task_ids())::uuid[]));

drop policy if exists reviews_read on reviews;
create policy reviews_read on reviews for select to authenticated
  using ((select is_global_manager()) or task_id = any ((select my_task_ids())::uuid[]));

drop policy if exists remarks_read on remarks;
create policy remarks_read on remarks for select to authenticated
  using ((select is_global_manager()) or task_id = any ((select my_task_ids())::uuid[]));

drop policy if exists expenses_read on expenses;
create policy expenses_read on expenses for select to authenticated
  using (
    (select is_finance())
    or (select is_global_manager())
    or project_id = any ((select my_project_ids())::uuid[])
  );

drop policy if exists notifications_read on notifications;
create policy notifications_read on notifications for select to authenticated
  using (profile_id = (select auth.uid()));

-- ---------------------------------------------------------- content ----

drop policy if exists content_bank_read on content_bank;
create policy content_bank_read on content_bank for select to authenticated
  using (
    (select is_global_manager())
    or project_id = any ((select my_project_ids())::uuid[])
    or allotted_to = (select auth.uid())
  );

-- Comments and minutes follow the record they hang off (can_see_entity).
drop policy if exists comments_read on comments;
create policy comments_read on comments for select to authenticated
  using (
    case entity_type
      when 'project' then (select is_global_manager()) or entity_id = any ((select my_project_ids())::uuid[])
      when 'task' then (select is_global_manager()) or entity_id = any ((select my_task_ids())::uuid[])
      else (select is_active_member())
    end
  );

drop policy if exists minutes_read on minutes;
create policy minutes_read on minutes for select to authenticated
  using (
    case entity_type
      when 'project' then (select is_global_manager()) or entity_id = any ((select my_project_ids())::uuid[])
      when 'task' then (select is_global_manager()) or entity_id = any ((select my_task_ids())::uuid[])
      else (select is_active_member())
    end
  );

-- -------------------------------------------- directory and master data --

-- Same rule as before - any active member reads these - evaluated once.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('departments_read', 'departments'),
      ('services_read', 'services'),
      ('profile_departments_read', 'profile_departments'),
      ('vendors_read', 'vendors'),
      ('project_templates_read', 'project_templates'),
      ('pts_read', 'project_template_services'),
      ('ptt_read', 'project_template_tasks'),
      ('task_templates_read', 'task_templates'),
      ('holidays_read', 'holidays'),
      ('overrides_read', 'working_overrides'),
      ('link_groups_read', 'link_groups'),
      ('operational_links_read', 'operational_links'),
      ('companies_read', 'companies'),
      ('clients_read', 'clients'),
      ('properties_read', 'properties'),
      ('property_configs_read', 'property_configs'),
      ('property_drive_folders_read', 'property_drive_folders'),
      ('property_clients_read', 'property_clients'),
      ('obcs_read', 'obcs'),
      ('obc_items_read', 'obc_items'),
      ('obc_services_read', 'obc_services')
    ) as p(policy, tbl)
  loop
    execute format('drop policy if exists %I on %I', r.policy, r.tbl);
    execute format(
      'create policy %I on %I for select to authenticated using ((select is_active_member()))',
      r.policy, r.tbl);
  end loop;
end
$$;

drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select to authenticated
  using ((select is_active_member()) or id = (select auth.uid()));

notify pgrst, 'reload schema';
