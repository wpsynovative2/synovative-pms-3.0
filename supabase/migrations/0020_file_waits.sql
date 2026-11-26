-- 0020_file_waits.sql
--
-- Three rules for tasks that wait on files to receive (0016, 0018).
--
-- 1. A projection keeps up. A task waiting on a file not yet in is projected as
--    if the file came in today (schedule_dependent_task) - but only when the row
--    was last written, so the next day its start was already behind it.
--    reproject_file_waits() re-projects every such task whose start has gone by,
--    each night at 00:01 IST, and once now. The new due date follows down the
--    chain as it always does (follow_task_dependency). None of it is a change
--    anyone made, so the change log (0047) leaves it out: tasks_log_change now
--    skips while the transaction-local `pms.quiet_change_log` flag is on.
--
-- 2. Only a file not yet received can be waited on. A task may keep a file it
--    already waited on when it came in, but may not newly name a received one
--    (guard_task_file_items).
--
-- 3. Received stays received. A file ticked in cannot be ticked back out, so a
--    task released by it never goes back to waiting. Only a session with no user
--    (the SQL editor) may still put a mistake right, as with content stages (0041).
--
-- Mirrors updateFileItem in lib/store.tsx, the file picker in TaskFormModal
-- (fileChoices) and the Received button and dialog in FilesDrawer.

/* ----------------------------------------------- 1. projections keep up */

drop trigger if exists tasks_log_change on tasks;
create trigger tasks_log_change after insert or delete or update on tasks
  for each row
  when (coalesce(current_setting('pms.quiet_change_log', true), '') <> 'on')
  execute function log_change('task');

-- Every open task still waiting on a file not yet in, whose projected start is
-- already behind today's working day, re-projected from today. Returns how many.
create or replace function reproject_file_waits()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_today date := snap_to_working_day(ist_today());
  v_count integer := 0;
  r       record;
begin
  perform set_config('pms.quiet_change_log', 'on', true);
  for r in
    select t.id
      from tasks t
     where t.project_id is not null
       and t.kind = 'standard'
       and t.status <> 'Approved'
       and t.duration_days is not null
       and t.start_date < v_today
       and exists (
             select 1 from file_items f
              where f.id = any (t.file_item_ids) and not f.received)
     order by t.created_at, t.id
  loop
    -- One task that cannot be moved never holds up the rest.
    begin
      -- Touching the row is enough: schedule_dependent_task recomputes it.
      update tasks set start_date = start_date where id = r.id;
      v_count := v_count + 1;
    exception when others then
      raise warning 'reproject_file_waits: task %: %', r.id, sqlerrm;
    end;
  end loop;
  perform set_config('pms.quiet_change_log', '', true);
  return v_count;
end;
$function$;

revoke all on function reproject_file_waits() from public, anon, authenticated;

select cron.schedule(
  'reproject-file-waits-0001-ist',
  '31 18 * * *',
  $job$ select reproject_file_waits(); $job$
);

/* ------------------------------------- 2. waiting on received files */

-- As 0018, and a file newly named must not be in yet.
create or replace function guard_task_file_items()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_had   uuid[] := '{}';
  v_names text;
begin
  if exists (
    select 1 from unnest(new.file_item_ids) x
     where not exists (
       select 1 from file_items f where f.id = x and f.project_id = new.project_id)
  ) then
    raise exception 'A task waits on files of its own project.' using errcode = '22023';
  end if;
  if cardinality(new.file_item_ids)
     <> (select count(distinct x) from unnest(new.file_item_ids) x) then
    raise exception 'A task names each file once.' using errcode = '22023';
  end if;

  -- Nested so OLD is never read on insert.
  if tg_op = 'UPDATE' then
    v_had := old.file_item_ids;
  end if;
  select string_agg('"' || f.name || '"', ', ' order by f.created_at, f.id)
    into v_names
    from file_items f
   where f.id = any (new.file_item_ids) and f.received and f.id <> all (v_had);
  if v_names is not null then
    raise exception 'A task can''t wait on a file already received: %.', v_names
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

/* --------------------------------------- 3. received stays received */

create or replace function guard_file_item_received()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is not null then
    raise exception '"%" is already received, and a file marked received stays received.', old.name
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

create trigger file_items_guard_received before update of received on file_items
  for each row when (old.received and not new.received)
  execute function guard_file_item_received();

/* ------------------------------------------------------------- catch up */

select reproject_file_waits();

notify pgrst, 'reload schema';
