-- One piece of content per task (asked for on 20 Nov 2026). A designer's task
-- carries a single piece: it cannot be allotted a second one, as the static
-- design or as the reel editing.
--
-- * Counts every piece on the task, whatever its status (Cancelled and Carry
--   Forwarded included): taking the allotment off frees the task.
-- * A Static to Motion piece needs two tasks anyway (0022, allot_content), so
--   its static and reel parts never share one.
-- * Allotting the same piece to the task it already has is not a second piece:
--   re-saving an allotment, or a part following its task to the task's new
--   assignee (0014), is never refused.
-- * Checked on every new allotment however it is made (allot_content() or a
--   direct write), next to the writer guard of 0038. Tasks that already hold
--   several pieces keep them; they just take no more.
-- * The writer's content task (content_bank.task_id) holds many pieces and is
--   not affected.
--
-- Runs as the owner, so a piece the allotting person cannot see still counts.
-- Mirrors heldPiece in components/content/allot-dialog.tsx.

-- The piece other than p_content_id already allotted to p_task_id, if any.
create or replace function task_held_piece(p_task_id uuid, p_content_id uuid)
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select c.id from content_bank c
   where (c.allotted_task_id = p_task_id or c.motion_allotted_task_id = p_task_id)
     and c.id is distinct from p_content_id
   limit 1;
$function$;

create or replace function guard_content_one_per_task()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  t uuid;
begin
  foreach t in array array[
    case when new.allotted_task_id is not null
          and (tg_op = 'INSERT' or new.allotted_task_id is distinct from old.allotted_task_id)
         then new.allotted_task_id end,
    case when new.motion_allotted_task_id is not null
          and (tg_op = 'INSERT' or new.motion_allotted_task_id is distinct from old.motion_allotted_task_id)
         then new.motion_allotted_task_id end]
  loop
    continue when t is null;
    -- Two allotments to the same task at once: the second waits for the first.
    perform pg_advisory_xact_lock(hashtext('content_one_per_task'), hashtext(t::text));
    if task_held_piece(t, new.id) is not null then
      raise exception 'That task already has a piece allotted. A task takes one piece: pick another task or create a new one.'
        using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$function$;

create trigger content_bank_guard_one_per_task
  before insert or update of allotted_task_id, motion_allotted_task_id
  on content_bank
  for each row execute function guard_content_one_per_task();

notify pgrst, 'reload schema';
