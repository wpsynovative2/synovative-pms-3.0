-- Only ops - Super Admin, Admin and Managers - may mark a piece Design Completed
-- by hand. Designers (Team Members and Team Leaders), writers and everyone else
-- who may move a piece's stage (set_content_stage, 0004) can still set every
-- other stage, and can still move a piece on from Design Completed.
--
-- Approving the designer's task still finishes the design (0037), whoever
-- approves it: complete_content_design() raises a transaction-local flag around
-- its own update, and the guard lets that one through.
--
-- Checked by a trigger, so it holds for set_content_stage() and for the writer's
-- own direct update alike. Mirrors canMarkDesignCompleted in lib/permissions.ts.

create or replace function guard_content_design_completed()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.stage = 'Design Completed'
     and (tg_op = 'INSERT' or old.stage is distinct from 'Design Completed')
     and auth.uid() is not null
     and coalesce(current_setting('pms.design_by_approval', true), '') <> 'on'
     and not is_global_manager()
  then
    raise exception 'Only a Super Admin, an Admin or a Manager can mark a piece Design Completed.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

create trigger content_bank_guard_design_completed
  before insert or update of stage on content_bank
  for each row execute function guard_content_design_completed();

-- 0037's function, with the flag raised around its update.
create or replace function complete_content_design()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform set_config('pms.design_by_approval', 'on', true);
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
  perform set_config('pms.design_by_approval', '', true);
  return null;
end;
$function$;

notify pgrst, 'reload schema';
