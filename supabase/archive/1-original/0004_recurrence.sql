-- =============================================================================
-- Repeating projects and individual tasks (Google Calendar-style recurrence)
-- Run after 0003_jobs.sql (needs pg_cron and the helpers from 0001 / 0002).
--
-- Mirrors lib/recurrence.ts and applyRecurrence() in lib/store.tsx. The rule is
-- stored as JSON in the same shape as the `RecurrenceRule` TypeScript type:
--
--   {"freq":"weekly","interval":2,"weekdays":[1,4],"ends":{"type":"after","count":10}}
--   {"freq":"monthly","interval":1,"monthlyMode":"nthWeekday","ends":{"type":"never"}}
--   {"freq":"daily","interval":1,"ends":{"type":"on","date":"2026-12-31"}}
--
-- The row carrying the rule is the series *source* — occurrence #1 and the
-- template every later occurrence is copied from. Generated rows point back at
-- it through series_source_id.
-- =============================================================================

-- -------------------------------------------------------------- columns ---

alter table projects
  add column recurrence        jsonb,
  add column recurrence_anchor date,   -- first occurrence; follows start_date
  add column recurrence_cursor date,   -- last date already materialised
  add column series_source_id  uuid references projects (id) on delete set null,
  add column series_index      integer,
  add column series_date       date,   -- date the rule produced, before snapping
  add constraint project_recurrence_complete check (
    recurrence is null
    or (recurrence_anchor is not null and recurrence_cursor is not null)
  );

alter table tasks
  add column recurrence        jsonb,
  add column recurrence_anchor date,
  add column recurrence_cursor date,
  add column series_source_id  uuid references tasks (id) on delete set null,
  add column series_index      integer,
  add column series_date       date,
  -- Project tasks repeat with their project; only individual tasks repeat alone.
  add constraint task_recurrence_individual_only check (
    recurrence is null or project_id is null
  ),
  add constraint task_recurrence_complete check (
    recurrence is null
    or (recurrence_anchor is not null and recurrence_cursor is not null)
  );

create index on projects (series_source_id);
create index on tasks (series_source_id);
create index projects_recurring on projects (recurrence_cursor) where recurrence is not null;
create index tasks_recurring    on tasks    (recurrence_cursor) where recurrence is not null;

-- ------------------------------------------------------------- helpers ---

create or replace function ist_today()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

-- Next working day at or after d (§5.4), with no "past date" rule, so work
-- caught up late keeps its real date.
create or replace function snap_to_working_day(d date)
returns date language plpgsql stable as $$
declare
  v_day date := d;
begin
  for i in 1..400 loop
    if is_working_day(v_day) then
      return v_day;
    end if;
    v_day := v_day + 1;
  end loop;
  return v_day;
end;
$$;

-- Does the rule fire on d? Same logic as matchesRule() in lib/recurrence.ts.
-- Weeks start on Monday (date_trunc 'week' is ISO).
create or replace function recurrence_matches(rule jsonb, anchor date, d date)
returns boolean language plpgsql immutable as $$
declare
  n      integer := greatest(1, coalesce((rule ->> 'interval')::integer, 1));
  mode   text    := coalesce(rule ->> 'monthlyMode', 'monthday');
  months integer;
  days   integer[];
begin
  if d < anchor then return false; end if;
  if d = anchor then return true; end if;

  case rule ->> 'freq'
    when 'daily' then
      return (d - anchor) % n = 0;

    when 'weekly' then
      if jsonb_typeof(rule -> 'weekdays') = 'array'
         and jsonb_array_length(rule -> 'weekdays') > 0 then
        select array_agg(value::integer) into days
          from jsonb_array_elements_text(rule -> 'weekdays');
      else
        days := array[extract(dow from anchor)::integer];
      end if;
      if not (extract(dow from d)::integer = any (days)) then
        return false;
      end if;
      return ((date_trunc('week', d::timestamp)::date
               - date_trunc('week', anchor::timestamp)::date) / 7) % n = 0;

    when 'monthly' then
      months := (extract(year from d)::integer - extract(year from anchor)::integer) * 12
              + (extract(month from d)::integer - extract(month from anchor)::integer);
      if months % n <> 0 then return false; end if;
      if mode = 'monthday' then
        return extract(day from d) = extract(day from anchor);
      end if;
      if extract(dow from d) <> extract(dow from anchor) then return false; end if;
      if mode = 'nthWeekday' then
        return (extract(day from d)::integer - 1) / 7
             = (extract(day from anchor)::integer - 1) / 7;
      end if;
      -- lastWeekday: a week later is already next month.
      return extract(month from d + 7) <> extract(month from d);

    when 'yearly' then
      return (extract(year from d)::integer - extract(year from anchor)::integer) % n = 0
         and extract(month from d) = extract(month from anchor)
         and extract(day from d)   = extract(day from anchor);

    else
      return false;
  end case;
end;
$$;

-- ---------------------------------------------------------- guard rails ---

-- Only Super Admin, Admin and Manager may set or change a repeat rule. The
-- anchor follows the start date, and a newly enabled series starts from today
-- so switching repeat on for an old project never backfills copies.
create or replace function guard_recurrence()
returns trigger language plpgsql set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.recurrence is not null)
     or (tg_op = 'UPDATE' and new.recurrence is distinct from old.recurrence) then
    -- auth.uid() is null for the pg_cron job, which is allowed through.
    if auth.uid() is not null and not is_global_manager() then
      raise exception 'Only Super Admin, Admin or Manager can set a repeat rule.'
        using errcode = '42501';
    end if;
  end if;

  if new.recurrence is null then
    new.recurrence_anchor := null;
    new.recurrence_cursor := null;
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

create trigger projects_guard_recurrence
  before insert or update on projects
  for each row execute function guard_recurrence();

create trigger tasks_guard_recurrence
  before insert or update on tasks
  for each row execute function guard_recurrence();

-- ------------------------------------------------------------ generator ---

-- Materialise every occurrence that has come due, up to today (IST).
-- Occurrences that snap onto the same working day (a daily rule over a weekend)
-- produce a single copy. Returns the number of projects + tasks created.
create or replace function generate_recurring_occurrences()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today    date := ist_today();
  v_created  integer := 0;
  src        record;
  t          record;
  v_type     text;
  v_until    date;
  v_count    integer;
  v_day      date;
  v_index    integer;
  v_start    date;
  v_shift    integer;
  v_deadline date;
  v_due      date;
  v_tstart   date;
  v_new      uuid;
  v_task     uuid;
  v_name     text;
begin
  -- ----------------------------------------------------------- projects --
  for src in
    select * from projects
     where recurrence is not null and recurrence_cursor < v_today
     for update
  loop
    v_type  := src.recurrence -> 'ends' ->> 'type';
    v_until := case when v_type = 'on' then (src.recurrence -> 'ends' ->> 'date')::date end;
    v_count := case when v_type = 'after' then (src.recurrence -> 'ends' ->> 'count')::integer end;
    v_index := 0;
    v_day   := src.recurrence_anchor;

    while v_day <= v_today loop
      exit when v_type = 'on' and v_day > v_until;
      if recurrence_matches(src.recurrence, src.recurrence_anchor, v_day) then
        v_index := v_index + 1;
        exit when v_type = 'after' and v_index > v_count;

        if v_day > src.recurrence_cursor then
          v_start := snap_to_working_day(v_day);
          if v_start <> src.start_date and not exists (
               select 1 from projects p
                where p.series_source_id = src.id and p.start_date = v_start) then
            v_shift    := v_start - src.start_date;
            v_deadline := src.deadline + v_shift;
            v_name     := src.name || ' · ' || to_char(v_start, 'FMDD Mon YYYY');

            insert into projects (
              name, color, client_name, start_date, deadline, description, status,
              priority, leader_id, created_by, series_source_id, series_index, series_date
            ) values (
              v_name, src.color, src.client_name, v_start, v_deadline, src.description,
              case when src.status in ('Completed', 'Cancelled', 'Archived')
                   then 'Planning'::project_status else src.status end,
              src.priority, src.leader_id, src.created_by, src.id, v_index, v_day
            ) returning id into v_new;

            insert into project_services (project_id, service)
              select v_new, service from project_services where project_id = src.id;
            insert into project_members (project_id, profile_id)
              select v_new, profile_id from project_members where project_id = src.id;

            -- Same tasks, same assignees, fresh state; creation order kept (§9.2).
            for t in
              select * from tasks where project_id = src.id order by created_at
            loop
              v_tstart := least(greatest(snap_to_working_day(t.start_date + v_shift), v_start), v_deadline);
              v_due    := least(greatest(snap_to_working_day(t.due_date + v_shift), v_tstart), v_deadline);

              insert into tasks (
                project_id, title, description, department, assignee_id, priority,
                start_date, due_date, estimated_hours, tags, created_by, created_at
              ) values (
                v_new, t.title, t.description, t.department, t.assignee_id, t.priority,
                v_tstart, v_due, t.estimated_hours, t.tags, t.created_by, clock_timestamp()
              ) returning id into v_task;

              insert into notifications (profile_id, type, title, body, href)
              values (
                t.assignee_id, 'task_assigned', 'New task assigned',
                '"' || t.title || '" in ' || v_name || '.',
                '/projects/' || v_new || '?task=' || v_task
              );
              v_created := v_created + 1;
            end loop;

            v_created := v_created + 1;
          end if;
        end if;
      end if;
      v_day := v_day + 1;
    end loop;

    update projects set recurrence_cursor = v_today where id = src.id;
  end loop;

  -- --------------------------------------------------- individual tasks --
  for src in
    select * from tasks
     where recurrence is not null and project_id is null and recurrence_cursor < v_today
     for update
  loop
    v_type  := src.recurrence -> 'ends' ->> 'type';
    v_until := case when v_type = 'on' then (src.recurrence -> 'ends' ->> 'date')::date end;
    v_count := case when v_type = 'after' then (src.recurrence -> 'ends' ->> 'count')::integer end;
    v_index := 0;
    v_day   := src.recurrence_anchor;

    while v_day <= v_today loop
      exit when v_type = 'on' and v_day > v_until;
      if recurrence_matches(src.recurrence, src.recurrence_anchor, v_day) then
        v_index := v_index + 1;
        exit when v_type = 'after' and v_index > v_count;

        if v_day > src.recurrence_cursor then
          v_start := snap_to_working_day(v_day);
          if v_start <> src.start_date and not exists (
               select 1 from tasks x
                where x.series_source_id = src.id and x.start_date = v_start) then
            v_shift := v_start - src.start_date;
            v_due   := greatest(snap_to_working_day(src.due_date + v_shift), v_start);

            insert into tasks (
              project_id, title, description, department, assignee_id, priority,
              start_date, due_date, estimated_hours, tags, created_by, created_at,
              series_source_id, series_index, series_date
            ) values (
              null, src.title, src.description, src.department, src.assignee_id, src.priority,
              v_start, v_due, src.estimated_hours, src.tags, src.created_by, clock_timestamp(),
              src.id, v_index, v_day
            ) returning id into v_task;

            insert into notifications (profile_id, type, title, body, href)
            values (
              src.assignee_id, 'task_assigned', 'New task assigned',
              '"' || src.title || '" — repeat #' || v_index || ', due '
                || to_char(v_due, 'FMDD Mon YYYY') || '.',
              '/individual-tasks?task=' || v_task
            );
            v_created := v_created + 1;
          end if;
        end if;
      end if;
      v_day := v_day + 1;
    end loop;

    update tasks set recurrence_cursor = v_today where id = src.id;
  end loop;

  return v_created;
end;
$$;

-- pg_cron schedules in UTC. 00:05 IST = 18:35 UTC on the previous day, so each
-- day's occurrences exist before anyone starts work.
select cron.schedule(
  'generate-recurring-occurrences-0005-ist',
  '35 18 * * *',
  $$ select generate_recurring_occurrences(); $$
);

-- To remove:
--   select cron.unschedule('generate-recurring-occurrences-0005-ist');
