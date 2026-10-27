-- A Team Leader listed as one of a project's Team Members sees the project.
--
-- Until now project_members granted nothing on its own: a Team Leader saw a
-- project only once their department had a task in it. A leader put on the
-- team to run the work could not open it, so could neither raise its first
-- task nor hand tasks out. Membership now counts - for Team Leaders only;
-- anyone else still needs a task there.
--
-- Seeing the project is all that changes. Creating tasks was already open to
-- Team Leaders (tasks_insert), and assigning follows visibility
-- (can_assign_task, 0016), so both work from here.
--
-- Visibility lives in two places (ARCHITECTURE.md §11): can_see_project() for
-- write rules and workflow functions, my_project_ids() for the read policies.
-- Both are as in the baseline plus the membership line.
-- Mirrors canViewProject / myProjects in lib/permissions.ts.

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
           where t.project_id = p_project_id and t.kind = 'content'));
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
  ) visible;
$function$;

notify pgrst, 'reload schema';
