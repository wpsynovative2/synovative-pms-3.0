-- Recurring copies are named "<Property> | <Title> | <Month Year>", e.g.
-- "Trinity Vista | SMM Retainer | December 2026" (asked for on 13 Nov 2026).
--
-- * The property is the blueprint's own; with none, that part is left out:
--   "SMM Retainer | December 2026".
-- * The title is the blueprint's name with any [Month] / [Year] taken out, since
--   the month now always comes last; a dash or comma they leave dangling goes too.
-- * The month is chosen as before: the occurrence date, or the month after it for
--   a project set to 'upcoming' (title_day, 0029).
--
-- Projects and individual tasks alike. Copies made before this keep their names.
-- The two-argument occurrence_name() stays for anything else that calls it.
--
-- Mirrors titleExample() in components/project/project-form.tsx and
-- occurrenceTitle() in lib/recurrence.ts.

create or replace function occurrence_name(p_name text, p_day date, p_property_id uuid)
 returns text
 language sql
 stable
 set search_path to 'public'
as $function$
  select concat_ws(' | ',
    nullif(btrim((select pr.name from properties pr where pr.id = p_property_id)), ''),
    nullif(
      regexp_replace(
        regexp_replace(
          regexp_replace(coalesce(p_name, ''), '\[(month|year)\]', '', 'gi'),
          '\s{2,}', ' ', 'g'),
        '^[\s,|:–—-]+|[\s,|:–—-]+$', '', 'g'),
      ''),
    to_char(p_day, 'FMMonth YYYY'));
$function$;

-- generate_recurring_occurrences as in 0021, naming copies with the property.
create or replace function generate_recurring_occurrences()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  -- Blueprint task id -> the id of its copy in this occurrence.
  v_copies   jsonb;
  -- A user who saves a blueprint due today runs this themselves; the
  -- assignment trigger then tells the assignees, so only the cron run (no
  -- signed-in user) writes its own notifications.
  v_notify   boolean := auth.uid() is null;
begin
  -- ----------------------------------------------------------- projects --
  for src in
    select * from projects
     where recurrence is not null and not recurrence_paused and recurrence_cursor < v_today
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

        if v_day > src.recurrence_cursor and not exists (
             select 1 from projects p
              where p.series_source_id = src.id and p.series_date = v_day) then
          v_start    := snap_to_working_day(v_day);
          v_shift    := v_start - src.start_date;
          v_deadline := greatest(src.deadline + v_shift, v_start);
          -- An "upcoming month" blueprint names each copy for the month after (0029).
          v_name     := occurrence_name(src.name, title_day(src.title_month, v_day), src.property_id);

          insert into projects (
            name, color, client_name, start_date, deadline, description, status,
            priority, leader_id, created_by, company_id, client_id, property_id,
            series_source_id, series_index, series_date, step_by_step
          ) values (
            v_name, src.color, src.client_name, v_start, v_deadline, src.description,
            case when src.status in ('Completed', 'Cancelled', 'Archived')
                 then 'Planning'::project_status else src.status end,
            src.priority, src.leader_id, src.created_by,
            src.company_id, src.client_id, src.property_id,
            src.id, v_index, v_day, src.step_by_step
          ) returning id into v_new;

          insert into project_services (project_id, service)
            select v_new, service from project_services where project_id = src.id;
          insert into project_members (project_id, profile_id)
            select v_new, profile_id from project_members where project_id = src.id;

          -- Same tasks and assignees, fresh state, creation order kept (§9.2).
          -- A content task keeps its kind and count; its slots are laid out
          -- by the tasks trigger (0026).
          v_copies := '{}'::jsonb;
          for t in
            select * from tasks where project_id = src.id order by created_at, id
          loop
            v_tstart := least(greatest(snap_to_working_day(t.start_date + v_shift), v_start), v_deadline);
            v_due    := least(greatest(snap_to_working_day(t.due_date + v_shift), v_tstart), v_deadline);

            insert into tasks (
              project_id, title, description, department, assignee_id, priority,
              start_date, due_date, estimated_hours, tags, kind, content_count,
              content_types, created_by, created_at, duration_days
            ) values (
              v_new, t.title, t.description, t.department, t.assignee_id, t.priority,
              v_tstart, v_due, t.estimated_hours, t.tags, t.kind, t.content_count,
              t.content_types, t.created_by, clock_timestamp(), t.duration_days
            ) returning id into v_task;

            v_copies := v_copies || jsonb_build_object(t.id::text, v_task::text);

            if v_notify and t.assignee_id is not null then
              insert into notifications (profile_id, type, title, body, href)
              values (
                t.assignee_id, 'task_assigned', 'New task assigned',
                '"' || t.title || '" in ' || v_name || '.',
                task_href(v_task, v_new)
              );
            end if;
          end loop;

          -- Once every task of the occurrence exists, and in creation order,
          -- so a chain is projected from its head down.
          for t in
            select d.task_id, d.depends_on_task_id
              from task_dependencies d
              join tasks x on x.id = d.task_id
             where x.project_id = src.id
             order by x.created_at, x.id, d.created_at
          loop
            insert into task_dependencies (task_id, depends_on_task_id)
            values (
              (v_copies ->> t.task_id::text)::uuid,
              (v_copies ->> t.depends_on_task_id::text)::uuid
            );
          end loop;

          v_created := v_created + 1;
        end if;
      end if;
      v_day := v_day + 1;
    end loop;

    update projects set recurrence_cursor = v_today where id = src.id;
  end loop;

  -- --------------------------------------------------- individual tasks --
  for src in
    select * from tasks
     where recurrence is not null and project_id is null
       and not recurrence_paused and recurrence_cursor < v_today
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

        if v_day > src.recurrence_cursor and not exists (
             select 1 from tasks x
              where x.series_source_id = src.id and x.series_date = v_day) then
          v_start := snap_to_working_day(v_day);
          v_shift := v_start - src.start_date;
          v_due   := greatest(snap_to_working_day(src.due_date + v_shift), v_start);
          v_name  := occurrence_name(src.title, v_day, src.property_id);

          insert into tasks (
            project_id, title, description, department, assignee_id, priority,
            start_date, due_date, estimated_hours, tags, created_by, created_at,
            series_source_id, series_index, series_date,
            company_id, property_id, client_ids
          ) values (
            null, v_name, src.description, src.department, src.assignee_id, src.priority,
            v_start, v_due, src.estimated_hours, src.tags, src.created_by, clock_timestamp(),
            src.id, v_index, v_day,
            src.company_id, src.property_id, src.client_ids
          ) returning id into v_task;

          if v_notify and src.assignee_id is not null then
            insert into notifications (profile_id, type, title, body, href)
            values (
              src.assignee_id, 'task_assigned', 'New task assigned',
              '"' || v_name || '", due ' || to_char(v_due, 'FMDD Mon YYYY') || '.',
              task_href(v_task, null)
            );
          end if;
          v_created := v_created + 1;
        end if;
      end if;
      v_day := v_day + 1;
    end loop;

    update tasks set recurrence_cursor = v_today where id = src.id;
  end loop;

  return v_created;
end;
$function$;

notify pgrst, 'reload schema';
