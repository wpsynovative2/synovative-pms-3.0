-- Taking a designer's approval back reopens the design (asked for on 20 Nov
-- 2026). 0037 moves the pieces allotted to a task to Design Completed when the
-- task is approved; this is the other half.
--
-- * Any move of the task away from Approved - Changes Required, Rejected, back to
--   In Progress, a reassignment - sends each piece allotted to it (static or reel
--   part) that is at Design Completed back to Ready To Design. The journey trigger
--   (stamp_content_journey, 0004) clears completed_at on the way.
-- * Scheduled, Cancelled and Carry Forwarded pieces are left as they are.
-- * A Static to Motion / Festival STM piece goes back if either of its two tasks
--   loses its approval.
-- * A piece a manager set to Design Completed by hand goes back too: the database
--   does not record how a piece reached it.
-- * The writer's content task (content_bank.task_id) does not trigger this.
--
-- A piece's status otherwise only moves forward (0041). This is the one step
-- back, and only this function takes it: it raises the transaction-local
-- pms.design_reopened flag around its update, which the forward-only guard lets
-- through - as 0040 does for pms.design_by_approval.
--
-- Runs as the owner: whoever changes the task may not be allowed to edit the
-- piece. Mirrors reopenContentDesign in lib/store.tsx.

create or replace function reopen_content_design()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform set_config('pms.design_reopened', 'on', true);
  update content_bank c
     set stage = 'Ready To Design'
   where c.stage = 'Design Completed'
     and (c.allotted_task_id = new.id or c.motion_allotted_task_id = new.id);
  perform set_config('pms.design_reopened', '', true);
  return null;
end;
$function$;

create trigger tasks_reopen_content_design after update of status on tasks
  for each row
  when (old.status = 'Approved' and new.status is distinct from 'Approved')
  execute function reopen_content_design();

-- guard_content_stage_forward as in 0041, letting reopen_content_design through.
create or replace function guard_content_stage_forward()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null
     or coalesce(current_setting('pms.design_reopened', true), '') = 'on'
     or new.stage is not distinct from old.stage
     or new.stage in ('Cancelled', 'Carry Forwarded')
  then
    return new;
  end if;
  if new.stage is null
     or content_stage_step(new.stage) < greatest(
          content_stage_step(old.stage),
          case when old.completed_at is not null then 2
               when old.ready_at is not null then 1
               else 0 end
        )
  then
    raise exception 'A piece''s status only moves forward. Cancelled and Carry Forwarded can be chosen at any time.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

notify pgrst, 'reload schema';
