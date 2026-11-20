-- A scheduled piece has one date: its delivery date (asked for on 20 Nov 2026).
-- 0042 copied the scheduled day (scheduled_on, 0013) into delivery_date when the
-- piece was scheduled, but a delivery date changed afterwards left scheduled_on
-- behind, so the list showed "20 Nov" as delivery and "on 19 Nov" under
-- Scheduled.
--
-- delivery_date is now the date. scheduled_on stays as a copy of it while the
-- piece is Scheduled (and null otherwise), so nothing that reads it goes stale:
--
-- * Scheduling a piece, or picking a new day for it, sets delivery_date to that
--   day (as 0042).
-- * Changing the delivery date of a Scheduled piece, however it is written
--   (set_content_delivery_date, the writer's form), moves scheduled_on with it.
-- * Pieces already apart are brought together on the delivery date, which is
--   the one set last; one with no delivery date takes the scheduled day.
--
-- Mirrors setContentStage / setContentDeliveryDate in lib/store.tsx and
-- stageValueOf in components/content/content-view.tsx.

create or replace function content_scheduled_delivery()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  -- A day picked with the Scheduled status becomes the delivery date.
  if new.stage = 'Scheduled' and new.scheduled_on is not null
     and (tg_op = 'INSERT'
          or old.stage is distinct from new.stage
          or old.scheduled_on is distinct from new.scheduled_on)
  then
    new.delivery_date := new.scheduled_on;
  end if;
  -- And the scheduled day is always the delivery date.
  new.scheduled_on := case when new.stage = 'Scheduled' then new.delivery_date end;
  return new;
end;
$function$;

drop trigger if exists content_bank_scheduled_delivery on content_bank;
create trigger content_bank_scheduled_delivery
  before insert or update of stage, scheduled_on, delivery_date on content_bank
  for each row execute function content_scheduled_delivery();

-- Bring the pieces already apart together.
update content_bank
   set delivery_date = coalesce(delivery_date, scheduled_on),
       scheduled_on  = coalesce(delivery_date, scheduled_on)
 where stage = 'Scheduled'
   and scheduled_on is distinct from delivery_date;

notify pgrst, 'reload schema';
