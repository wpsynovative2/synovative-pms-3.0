-- A third level in a 3D project (Archi-3d.md §1). A group T1 now holds sub-groups
-- T1.1, T1.2, and each sub-group holds the tasks T1.1.1, T1.1.2. Work still happens
-- only on tasks; a group and a sub-group both show progress worked out from the
-- tasks under them.
--
-- A sub-group is a task_groups row with a parent. Like a group it carries the three
-- notes (0024), and it also has a description, rich text. Only a sub-group holds
-- tasks, and a sub-group has no sub-groups of its own.
--
-- Tasks already filed straight in a group move into a new sub-group named after it,
-- numbered 1, and keep their own numbers: T1.3 becomes T1.1.3. The group keeps its
-- notes.
--
-- Mirrors TaskGroup.parentId / description, groupCodes and chainPredecessor
-- (lib/task-groups.ts, lib/dependencies.ts).

alter table task_groups
  add column parent_id            uuid,
  add column description          text    not null default '',
  add column next_subgroup_number integer not null default 1;

-- In the same project. Deferred like tasks_group_fkey (0022), so deleting a whole
-- project still cascades; deleting a group that still has sub-groups is refused
-- at commit.
alter table task_groups add constraint task_groups_parent_fkey
  foreign key (parent_id, project_id) references task_groups (id, project_id)
  deferrable initially deferred;

-- Numbers are unique among siblings now, not across the project: T1.1 and T2.1 are
-- both sub-group 1.
alter table task_groups drop constraint task_groups_project_number_key;
create unique index task_groups_top_number_key on task_groups (project_id, number)
  where parent_id is null;
create unique index task_groups_sub_number_key on task_groups (parent_id, number)
  where parent_id is not null;

-- ------------------------------------------------------------- numbering --
-- A group's number comes from its project's counter, as before; a sub-group's from
-- its group's. Taking it locks the parent row, and a number is never reused.

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

-- As in 0022, and a task is filed only in a sub-group.
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

-- --------------------------------------------------- the step-by-step chain --
-- Where a group sits in number order: {1, 2} for T1.2, and {1, 0} for T1 itself,
-- so the chain runs T1.1.1, T1.1.2, T1.2.1, T2.1.1.

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

-- As in 0022, in the three-level order.
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

-- ------------------------------------------- tasks filed straight in a group --
-- Each group holding tasks gets sub-group 1, named after it, which takes over the
-- group's task counter so the numbers carry on. The tasks move with their numbers
-- and links as they are: the numbering trigger would refuse a move, and the chain
-- trigger would re-point links that are already right.

insert into task_groups (project_id, parent_id, name, next_task_number, created_by, created_at)
select g.project_id, g.id, g.name, g.next_task_number, g.created_by, g.created_at
  from task_groups g
 where g.parent_id is null
   and exists (select 1 from tasks t where t.group_id = g.id);

alter table tasks disable trigger tasks_assign_group_number;
alter table tasks disable trigger tasks_place_in_chain;

-- tasks_group_fkey is deferred (0022), and a check still waiting for commit stops
-- the triggers being switched back on below. Checked as each row moves instead;
-- this lasts only until the end of the transaction.
set constraints tasks_group_fkey immediate;

update tasks t
   set group_id = s.id
  from task_groups s
 where s.parent_id = t.group_id;

alter table tasks enable trigger tasks_assign_group_number;
alter table tasks enable trigger tasks_place_in_chain;

-- ---------------------------------------------------------------- who may --
-- The same people manage both levels (can_manage_task_groups, 0022). The parent is
-- set once, when the sub-group is made.
grant insert (parent_id, description) on task_groups to authenticated;
grant update (description) on task_groups to authenticated;

notify pgrst, 'reload schema';
