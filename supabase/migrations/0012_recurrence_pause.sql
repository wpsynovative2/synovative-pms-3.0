-- =============================================================================
-- Pausing a repeat.
-- Run after 0011_capacity_and_task_home.sql.
--
-- A paused series stops producing occurrences without losing its rule, its
-- history or its link to the copies already made. Pausing *skips* the dates it
-- covers rather than banking them: resuming after a month off does not dump a
-- month of back-dated projects into the app. That is done by moving the series
-- cursor forward each day while it is paused, so the generator - which only
-- looks at dates after the cursor - never sees them.
-- =============================================================================

alter table projects add column if not exists recurrence_paused boolean not null default false;
alter table tasks    add column if not exists recurrence_paused boolean not null default false;

-- Setting a repeat rule is Super Admin / Admin / Manager only, and so is
-- pausing one: both decide whether work appears for the whole team.
create or replace function guard_recurrence()
returns trigger language plpgsql set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.recurrence is not null)
     or (tg_op = 'UPDATE' and new.recurrence is distinct from old.recurrence)
     or (tg_op = 'UPDATE' and new.recurrence_paused is distinct from old.recurrence_paused) then
    -- auth.uid() is null for the pg_cron job, which is allowed through.
    if auth.uid() is not null and not is_global_manager() then
      raise exception 'Only Super Admin, Admin or Manager can change a repeat rule.'
        using errcode = '42501';
    end if;
  end if;

  if new.recurrence is null then
    new.recurrence_anchor := null;
    new.recurrence_cursor := null;
    -- Nothing left to pause once the rule is gone.
    new.recurrence_paused := false;
    return new;
  end if;

  new.recurrence_anchor := new.start_date;
  -- The cursor belongs to the generator: a user edit can never rewind it and
  -- make old occurrences come back.
  if tg_op = 'UPDATE' and auth.uid() is not null and old.recurrence is not null then
    new.recurrence_cursor := old.recurrence_cursor;
  end if;
  if new.recurrence_cursor is null then
    new.recurrence_cursor :=
      case when new.start_date >= ist_today() then new.start_date else ist_today() - 1 end;
  end if;
  return new;
end;
$$;

-- Walks the cursor of every paused series up to today, so the dates that passed
-- while it was paused are behind the cursor and will never be generated. Runs
-- immediately before the generator each night.
create or replace function skip_paused_recurrences()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today   date := ist_today();
  v_skipped integer := 0;
  v_rows    integer;
begin
  update projects set recurrence_cursor = v_today
   where recurrence is not null and recurrence_paused and recurrence_cursor < v_today;
  get diagnostics v_rows = row_count;
  v_skipped := v_skipped + v_rows;

  update tasks set recurrence_cursor = v_today
   where recurrence is not null and recurrence_paused and recurrence_cursor < v_today;
  get diagnostics v_rows = row_count;
  v_skipped := v_skipped + v_rows;

  return v_skipped;
end;
$$;

-- Same 00:05 IST slot, now skipping paused series first.
do $do$
begin
  perform cron.unschedule('generate-recurring-occurrences-0005-ist');
exception
  when others then null;   -- not scheduled yet; nothing to remove
end
$do$;

select cron.schedule(
  'generate-recurring-occurrences-0005-ist',
  '35 18 * * *',
  $job$ select skip_paused_recurrences(); select generate_recurring_occurrences(); $job$
);
