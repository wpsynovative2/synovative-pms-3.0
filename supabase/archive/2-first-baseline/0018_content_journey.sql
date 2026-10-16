-- The journey of a piece, step by step: created, started by its writer,
-- Ready To Design, allotted, completed. Created is created_at; the rest are
-- stamped here the moment the piece reaches them, so the Content Bank can show
-- when each happened.
--
-- Pieces from before this migration have no stamps. The app still marks
-- those steps done from the piece's current state, just without a date.

alter table content_bank
  add column if not exists started_at   timestamptz,
  add column if not exists ready_at     timestamptz,
  add column if not exists allotted_at  timestamptz,
  add column if not exists completed_at timestamptz;

comment on column content_bank.started_at is
  'When something was first written in the piece.';
comment on column content_bank.ready_at is
  'When the piece was first marked Ready To Design.';
comment on column content_bank.allotted_at is
  'When the piece was put in its current holder''s name. Null while unallotted.';
comment on column content_bank.completed_at is
  'When the design was done: the stage became Design Completed or Scheduled. Cleared if it goes back.';

create or replace function stamp_content_journey()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Started: the first time there is anything written in it.
  if new.started_at is null and not content_is_empty(new) then
    new.started_at := now();
  end if;

  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    -- Ready To Design: the first time only; going on from it keeps the date.
    if new.stage = 'Ready To Design' and new.ready_at is null then
      new.ready_at := now();
    end if;
    -- Completed: on reaching it; stepping back off it clears the date.
    if new.stage in ('Design Completed', 'Scheduled') then
      if new.completed_at is null then
        new.completed_at := now();
      end if;
    elsif new.stage is null or new.stage = 'Ready To Design' then
      new.completed_at := null;
    end if;
  end if;

  -- Allotted: each new holder restarts it; taking the piece back clears it.
  if new.allotted_to is null then
    new.allotted_at := null;
  elsif tg_op = 'INSERT' or new.allotted_to is distinct from old.allotted_to then
    new.allotted_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists content_bank_journey on content_bank;
create trigger content_bank_journey
  before insert or update on content_bank
  for each row execute function stamp_content_journey();

notify pgrst, 'reload schema';
