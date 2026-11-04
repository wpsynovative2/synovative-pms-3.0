-- The 3D module (Archi-3d.md): a project marked 3D holds numbered groups T1, T2,
-- and each group holds ordinary tasks T1.1, T1.2. Only the group is new; a task
-- keeps its timer, review, dependencies and notifications.
--
-- The module is for the 3D Artists department, global managers and Business
-- Development. The 3D Artists' Team Leader and Business Development see every 3D
-- project, because the page would otherwise be empty for them. An artist sees the
-- ones they hold a task in, like any other project.
--
-- Mirrors canViewThreeD, canCreateThreeDProjects, canManageTaskGroups and
-- canViewProject in lib/permissions.ts.

alter table projects
  add column is_3d             boolean not null default false,
  add column next_group_number integer not null default 1;

-- Repeating copies duplicate tasks but not groups (Archi-3d.md §8).
alter table projects add constraint projects_3d_does_not_repeat
  check (not (is_3d and recurrence is not null));

create table task_groups (
  id               uuid        not null default uuid_generate_v4(),
  project_id       uuid        not null,
  number           integer     not null,
  name             text        not null,
  next_task_number integer     not null default 1,
  created_by       uuid        not null,
  created_at       timestamptz not null default now(),
  constraint task_groups_pkey primary key (id),
  constraint task_groups_project_number_key unique (project_id, number),
  -- What the composite foreign key on tasks points at.
  constraint task_groups_id_project_key unique (id, project_id),
  constraint task_groups_project_id_fkey
    foreign key (project_id) references projects (id) on delete cascade,
  constraint task_groups_created_by_fkey
    foreign key (created_by) references profiles (id)
);

alter table tasks
  add column group_id     uuid,
  add column group_number integer;

-- Deferred, so deleting a whole project works: its groups and tasks both cascade,
-- and a check at the end of the statement could run before the tasks have gone.
-- Deleting a group that still has tasks is refused at commit.
alter table tasks add constraint tasks_group_fkey
  foreign key (group_id, project_id) references task_groups (id, project_id)
  deferrable initially deferred;
-- The foreign key skips any row where project_id is null, so an individual task
-- needs its own rule. Content tasks stay outside the groups.
alter table tasks add constraint tasks_group_needs_project
  check (group_id is null or (project_id is not null and kind = 'standard'));
alter table tasks add constraint tasks_group_number_key unique (group_id, group_number);

create index tasks_group_id_idx on tasks (group_id);

-- ------------------------------------------------------------- numbering --
-- Each number comes from a counter on the parent row. Taking it locks the row, so
-- two people adding at once get different numbers, and a number is never reused.

create or replace function assign_group_number()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update projects
     set next_group_number = next_group_number + 1
   where id = new.project_id and is_3d
  returning next_group_number - 1 into new.number;
  if new.number is null then
    raise exception 'Only a 3D project has task groups.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

create trigger task_groups_assign_number before insert on task_groups
  for each row execute function assign_group_number();

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
  -- A move would change what the number means (Archi-3d.md §8). An ungrouped
  -- task can still be filed into a group.
  if tg_op = 'UPDATE' and old.group_id is not null then
    raise exception 'A task stays in its group once it is filed there.' using errcode = '22023';
  end if;
  if new.group_id is null then
    new.group_number := null;
    return new;
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

create trigger tasks_assign_group_number before insert or update of group_id, group_number on tasks
  for each row execute function assign_task_group_number();

-- --------------------------------------------------- the step-by-step chain --
-- Plain SBS assumes tasks are only added at the end. A 3D project can take a task
-- in an earlier group at any time, and the chain follows number order. Both rules
-- are triggers because whoever adds or deletes a task may not be allowed to edit
-- the next one. Other SBS projects keep their behaviour.

-- T1.4 added between T1.3 and T2.1: T2.1 moves from T1.3 to T1.4. Work that has
-- begun is never put back to waiting. The new task's own link is the form's.
create or replace function place_task_in_chain()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_number integer;
  v_prev   uuid;
  v_next   uuid;
begin
  if tg_op = 'UPDATE' and new.group_id is not distinct from old.group_id then
    return null;
  end if;
  if not exists (
    select 1 from projects p where p.id = new.project_id and p.is_3d and p.step_by_step
  ) then
    return null;
  end if;

  select number into v_number from task_groups where id = new.group_id;

  select t.id into v_prev
    from tasks t
    join task_groups g on g.id = t.group_id
   where t.project_id = new.project_id and t.id <> new.id
     and (g.number, t.group_number) < (v_number, new.group_number)
   order by g.number desc, t.group_number desc
   limit 1;

  select t.id into v_next
    from tasks t
    join task_groups g on g.id = t.group_id
   where t.project_id = new.project_id and t.id <> new.id
     and (g.number, t.group_number) > (v_number, new.group_number)
     and t.status = 'Not Started'
     and not exists (select 1 from time_sessions s where s.task_id = t.id)
   order by g.number, t.group_number
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

create trigger tasks_place_in_chain after insert or update of group_id on tasks
  for each row when (new.group_id is not null)
  execute function place_task_in_chain();

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

create trigger tasks_close_chain_gap before delete on tasks
  for each row execute function close_chain_gap();

-- ---------------------------------------------------------------- who may --

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

-- As in 0017, plus: the 3D Artists' Team Leader and Business Development see every
-- 3D project. Change one of these two, change the other (ARCHITECTURE.md §11).
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

alter table task_groups enable row level security;

create policy task_groups_read on task_groups for select to authenticated
  using (((select is_global_manager()) or (project_id = any ((select my_project_ids())::uuid[]))));
create policy task_groups_insert on task_groups for insert to authenticated
  with check (can_manage_task_groups(project_id) and created_by = auth.uid());
create policy task_groups_update on task_groups for update to authenticated
  using (can_manage_task_groups(project_id))
  with check (can_manage_task_groups(project_id));
create policy task_groups_delete on task_groups for delete to authenticated
  using (can_manage_task_groups(project_id));

-- The number and the counter belong to the triggers above, which run as the owner.
revoke insert, update on task_groups from authenticated;
grant insert (id, project_id, name, created_by) on task_groups to authenticated;
grant update (name) on task_groups to authenticated;

-- The 3D Artists' Team Leader may raise 3D projects, and only those, with the
-- services and team that a project is saved with.
drop policy projects_insert on projects;
create policy projects_insert on projects for insert to authenticated
  with check (is_global_manager() or (is_3d and is_3d_team_leader()));

drop policy project_services_write on project_services;
create policy project_services_write on project_services for all to authenticated
  using (is_global_manager() or leads_project(project_id)
         or (is_3d_team_leader() and is_3d_project(project_id)))
  with check (is_global_manager() or leads_project(project_id)
              or (is_3d_team_leader() and is_3d_project(project_id)));

drop policy project_members_write on project_members;
create policy project_members_write on project_members for all to authenticated
  using (is_global_manager() or leads_project(project_id)
         or (is_3d_team_leader() and is_3d_project(project_id)))
  with check (is_global_manager() or leads_project(project_id)
              or (is_3d_team_leader() and is_3d_project(project_id)));

notify pgrst, 'reload schema';
