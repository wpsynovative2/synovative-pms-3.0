-- Content allotted to a task belongs to whoever does that task. When the task
-- is handed to someone else, its allotted pieces go with it - otherwise the
-- piece keeps naming the old assignee ("for Annu Sharma") on a task that is
-- now someone else's.

-- Move the allotment when the assignee changes. Security definer so the piece
-- moves even where the caller could not write it directly; who may reassign
-- the task is already settled by the tasks policies.
create or replace function follow_task_assignee()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update content_bank
     set allotted_to = new.assignee_id
   where allotted_task_id = new.id
     and allotted_to is distinct from new.assignee_id;
  return null;
end;
$function$;

drop trigger if exists tasks_follow_assignee on tasks;
create trigger tasks_follow_assignee
  after update of assignee_id on tasks
  for each row
  when (new.assignee_id is distinct from old.assignee_id)
  execute function follow_task_assignee();

-- The guard refuses allotment changes from anyone who may not allot. Following
-- the allotted task's own assignee is not a new allotment, so let it through.
create or replace function guard_content_allotment()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    return new;
  end if;
  -- Deleting the allotted task blanks the link by foreign key, and whoever
  -- deleted the task need not be someone who may allot.
  if tg_op = 'UPDATE'
     and new.allotted_to is not distinct from old.allotted_to
     and new.allotted_task_id is null then
    return new;
  end if;
  -- The task was reassigned and the piece is following it.
  if tg_op = 'UPDATE'
     and new.allotted_task_id is not null
     and new.allotted_task_id is not distinct from old.allotted_task_id
     and new.allotted_to is not distinct from
         (select assignee_id from tasks where id = new.allotted_task_id) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if (new.allotted_to is not null or new.allotted_task_id is not null)
       and not can_allot_content(new.project_id) then
      raise exception 'Only a manager, the Project Leader or a Team Leader can allot content.'
        using errcode = '42501';
    end if;
  elsif (new.allotted_to is distinct from old.allotted_to
         or new.allotted_task_id is distinct from old.allotted_task_id)
        and not can_allot_content(new.project_id) then
    raise exception 'Only a manager, the Project Leader or a Team Leader can allot content.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

-- Put right the pieces whose task was reassigned before this migration.
update content_bank c
   set allotted_to = t.assignee_id
  from tasks t
 where c.allotted_task_id = t.id
   and c.allotted_to is distinct from t.assignee_id;
