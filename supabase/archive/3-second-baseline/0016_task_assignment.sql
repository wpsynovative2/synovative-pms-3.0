-- Assigning project tasks, and a record of every time a task changed hands.
--
-- A Team Leader may hand any task of a project they can see to someone,
-- whoever created it - assigning only: the rest of the task stays with its
-- creator and the Project Leader (can_edit_task). That goes through
-- assign_task(), which applies the same rules the edit form does: the person
-- must be in the task's department (§9.1), a reassigned task starts again at
-- Not Started, and the old assignee's running timer is closed. Work with a
-- reviewer, the client, or already approved is not moved.
--
-- task_assignments is the history, written by a trigger on tasks so every path
-- is recorded - the edit form, assign_task, a rejection that reassigns, a
-- Content Writers Team Leader handing out a content task, recurring copies.
-- Mirrors canAssignTask in lib/permissions.ts.

create or replace function can_assign_task(p_task_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select can_edit_task(p_task_id)
      or exists (
           select 1 from tasks t
            where t.id = p_task_id
              and t.project_id is not null
              and is_team_leader()
              and can_see_project(t.project_id)
         );
$function$;

create or replace function assign_task(p_task_id uuid, p_assignee uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_task tasks%rowtype;
begin
  if not can_assign_task(p_task_id) then
    raise exception 'You can''t assign this task.' using errcode = '42501';
  end if;

  select * into v_task from tasks where id = p_task_id;
  if v_task.assignee_id is not distinct from p_assignee then
    return;
  end if;
  if v_task.status in ('Submitted', 'Waiting for Client Response', 'Approved') then
    raise exception 'This task is % and can''t be reassigned.', lower(v_task.status::text)
      using errcode = '22023';
  end if;
  if p_assignee is not null and not exists (
       select 1
         from profiles p
         join profile_departments d on d.profile_id = p.id
        where p.id = p_assignee and p.active and d.department = v_task.department
     ) then
    raise exception 'Pick someone from the % department.', v_task.department
      using errcode = '22023';
  end if;

  -- The old assignee's timer stops here; their time stays logged.
  update time_sessions
     set ended_at = now(), end_reason = 'Switched', end_note = 'Task reassigned'
   where task_id = p_task_id and ended_at is null;

  update tasks
     set assignee_id = p_assignee,
         status      = 'Not Started'
   where id = p_task_id;
end;
$function$;

create table task_assignments (
  id              uuid        not null default uuid_generate_v4(),
  task_id         uuid        not null references tasks (id) on delete cascade,
  from_profile_id uuid        references profiles (id) on delete set null,
  to_profile_id   uuid        references profiles (id) on delete set null,
  -- Null when the system did it: the recurrence job making a copy.
  by_profile_id   uuid        references profiles (id) on delete set null,
  at              timestamptz not null default now(),
  constraint task_assignments_pkey primary key (id)
);
create index task_assignments_task_id_idx on task_assignments (task_id, at);

create or replace function record_task_assignment()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    if new.assignee_id is not null then
      insert into task_assignments (task_id, from_profile_id, to_profile_id, by_profile_id)
      values (new.id, null, new.assignee_id, auth.uid());
    end if;
  elsif new.assignee_id is distinct from old.assignee_id then
    insert into task_assignments (task_id, from_profile_id, to_profile_id, by_profile_id)
    values (new.id, old.assignee_id, new.assignee_id, auth.uid());
  end if;
  return null;
end;
$function$;

create trigger tasks_record_assignment after insert or update of assignee_id on tasks
  for each row execute function record_task_assignment();

-- Tasks assigned before this have one line: to their assignee, by whoever
-- created the task, when it was created. Their earlier changes went unrecorded.
insert into task_assignments (task_id, from_profile_id, to_profile_id, by_profile_id, at)
select t.id, null, t.assignee_id, t.created_by, t.created_at
  from tasks t
 where t.assignee_id is not null;

alter table task_assignments enable row level security;

-- Readable with the task it belongs to; written only by the trigger.
create policy task_assignments_read on task_assignments for select to authenticated
  using (((select is_global_manager()) or (task_id = any ((select my_task_ids())::uuid[]))));

revoke insert, update, delete on task_assignments from anon, authenticated;
revoke all on task_assignments from anon;
revoke all on function assign_task(uuid, uuid) from public;
grant execute on function assign_task(uuid, uuid) to authenticated;
grant execute on function can_assign_task(uuid) to authenticated;

notify pgrst, 'reload schema';
