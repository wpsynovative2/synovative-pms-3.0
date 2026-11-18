-- Approving a designer's task finishes the design of the content pieces allotted
-- to it: each piece that is Ready To Design moves to Design Completed, and the
-- journey stamps completed_at as it does for a hand-set stage
-- (stamp_content_journey, 0004).
--
-- * Only Ready To Design moves. A piece not yet ready is left for its writer, and
--   one already Design Completed, Scheduled, Cancelled or Carry Forwarded is
--   never moved back.
-- * A Static to Motion or Festival STM piece has two parts (0022, is_stm_type):
--   the static design on allotted_task_id and the reel on motion_allotted_task_id.
--   It is done only when both tasks are approved, whichever is approved last.
-- * The writer's content task (content_bank.task_id) does not trigger this.
-- * Taking an approval back later leaves the stage as it is; it is the writer's
--   to set again by hand.
--
-- Runs as the owner: whoever approves the task may not be allowed to edit the
-- piece. Mirrors completeContentDesign in lib/store.tsx.

create or replace function complete_content_design()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update content_bank c
     set stage = 'Design Completed'
   where c.stage = 'Ready To Design'
     and (c.allotted_task_id = new.id or c.motion_allotted_task_id = new.id)
     -- The static part is approved: this task, or already.
     and c.allotted_task_id is not null
     and exists (
       select 1 from tasks s where s.id = c.allotted_task_id and s.status = 'Approved'
     )
     -- And a reel, if the piece has one to make, is approved too.
     and (
       not is_stm_type(c.type)
       or exists (
         select 1 from tasks m where m.id = c.motion_allotted_task_id and m.status = 'Approved'
       )
     );
  return null;
end;
$function$;

create trigger tasks_complete_content_design after update of status on tasks
  for each row
  when (new.status = 'Approved' and old.status is distinct from 'Approved')
  execute function complete_content_design();

notify pgrst, 'reload schema';
