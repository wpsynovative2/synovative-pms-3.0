-- A piece's status only moves forward: Not set -> Ready To Design -> Design
-- Completed -> Scheduled. Cancelled and Carry Forwarded sit beside that line and
-- can be chosen at any time, by anyone who may move the piece.
--
-- Coming back from Cancelled or Carry Forwarded, the journey's stamps
-- (stamp_content_journey, 0004) still hold the line: a piece that was ready
-- (ready_at) or designed (completed_at) cannot go back before that. Not set is
-- never chosen again once a status is set. The old row's stamps are read, so the
-- order of the before-triggers does not matter.
--
-- Holds for everyone, ops included, and for every way the stage is written
-- (set_content_stage, the writer's direct update). Only a session with no user
-- (the SQL editor, the service role) can step a piece back.
-- Mirrors canMoveContentStage in lib/types.ts.

create or replace function content_stage_step(p_stage content_stage)
 returns integer
 language sql
 immutable
as $function$
  select case p_stage
    when 'Ready To Design' then 1
    when 'Design Completed' then 2
    when 'Scheduled' then 3
    else 0
  end;
$function$;

create or replace function guard_content_stage_forward()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null
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

create trigger content_bank_guard_stage_forward
  before update of stage on content_bank
  for each row execute function guard_content_stage_forward();

notify pgrst, 'reload schema';
