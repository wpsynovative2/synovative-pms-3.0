-- Scheduling a piece sets its delivery date: the day it is scheduled for
-- (scheduled_on, chosen with the Scheduled status, 0013) becomes delivery_date
-- (0012), replacing any date set before. Changing the scheduled day moves the
-- delivery date with it. Leaving Scheduled keeps the delivery date as it is.
--
-- A trigger, so it holds however the stage is written (set_content_stage or the
-- writer's own update). Whoever may schedule the piece sets the date this way,
-- even if set_content_delivery_date() would not let them set it by hand.
-- Mirrors setContentStage in lib/store.tsx.

create or replace function content_scheduled_delivery()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.stage = 'Scheduled' and new.scheduled_on is not null
     and (tg_op = 'INSERT'
          or old.stage is distinct from new.stage
          or old.scheduled_on is distinct from new.scheduled_on)
  then
    new.delivery_date := new.scheduled_on;
  end if;
  return new;
end;
$function$;

create trigger content_bank_scheduled_delivery
  before insert or update of stage, scheduled_on on content_bank
  for each row execute function content_scheduled_delivery();

notify pgrst, 'reload schema';
