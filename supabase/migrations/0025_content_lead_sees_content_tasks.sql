-- A Team Leader sees the projects their department has tasks on. Content
-- tasks raised before they defaulted to the Content Writers department are
-- often filed under another one, so the Content Writers' Team Leader could not
-- see them - nor assign them (0024) - on those projects.
--
-- A Content Writers Team Leader now also sees every project that has a content
-- task, whatever department it is filed under, and with it the project's
-- tasks and content (both follow my_project_ids / can_see_project).
-- Mirrors canViewProject in lib/permissions.ts.

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
    union
    select t.project_id from tasks t
     where is_content_team_leader() and t.project_id is not null
       and t.kind = 'content'
  ) visible;
$$;

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
             and t.department = any (my_departments())))
    or (is_content_team_leader() and exists (
          select 1 from tasks t
           where t.project_id = p_project_id and t.kind = 'content'));
$$;
