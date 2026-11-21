-- A content task says where each of its pieces goes - SMM or WhatsApp Share -
-- when it is raised, the same way it says each piece's CB type (0015). Asked for
-- on 20 Nov 2026: "ask for Placements for every count at once".
--
-- * tasks.content_placements holds one placement per target piece, by slot
--   (content_placements[1] is Count 1). A null or missing entry leaves the
--   piece's placement for the writer to set, as before.
-- * A new slot takes its placement from the task; changing one on the task
--   changes that piece, exactly as content_types does. A blank entry never
--   clears a placement a piece already has.
-- * Recurring copies carry the placements with the tasks (0032 otherwise).
--
-- Run before deploying the code that writes content_placements.
-- Mirrors contentPlacements in lib/types.ts and PieceTypesPicker in
-- components/content/piece-types.tsx.

alter table tasks
  add column if not exists content_placements content_placement[] not null default '{}';

comment on column tasks.content_placements is
  'Content tasks: the placement of each target piece, by slot (content_placements[1] is Count 1). Null or missing leaves it to the writer.';

-- sync_content_slots as in 0004: a new slot takes its placement from the task.
create or replace function sync_content_slots(p_task_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  t tasks%rowtype;
  n integer;
begin
  select * into t from tasks where id = p_task_id;
  if not found or t.project_id is null then
    return;
  end if;

  if t.kind <> 'content' or is_blueprint_project(t.project_id) then
    -- No slots here: empty ones go, written ones become ordinary pieces.
    delete from content_bank c
     where c.task_id = t.id and c.slot is not null and content_is_empty(c);
    update content_bank set slot = null where task_id = t.id and slot is not null;
    return;
  end if;

  -- Lowering the target: empty slots past it go, written ones become extras.
  delete from content_bank c
   where c.task_id = t.id and c.slot > t.content_count and content_is_empty(c);
  update content_bank set slot = null
   where task_id = t.id and slot > t.content_count;

  -- Raising it, or a new task: create whatever is missing.
  for n in 1 .. t.content_count loop
    if not exists (select 1 from content_bank where task_id = t.id and slot = n) then
      insert into content_bank
        (project_id, task_id, slot, title, type, billing_type, created_by, for_month,
         placement)
      values
        (t.project_id, t.id, n, content_slot_title(t.title, n),
         coalesce(t.content_types[n], 'Static Design'), 'Count', t.assignee_id,
         content_month(t.project_id, t.start_date),
         t.content_placements[n]);
    end if;
  end loop;

  -- Empty slots are the assignee's to fill.
  update content_bank c
     set created_by = t.assignee_id
   where c.task_id = t.id and c.slot is not null and content_is_empty(c)
     and c.created_by is distinct from t.assignee_id;
end;
$function$;

-- tasks_sync_content_slots as in 0004, also following the placements.
create or replace function tasks_sync_content_slots()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' then
    if new.kind is not distinct from old.kind
       and new.content_count is not distinct from old.content_count
       and new.content_types is not distinct from old.content_types
       and new.content_placements is not distinct from old.content_placements
       and new.assignee_id is not distinct from old.assignee_id
       and new.title is not distinct from old.title then
      return null;
    end if;
    -- Slots still wearing the generated name follow a renamed task.
    if new.title is distinct from old.title then
      update content_bank
         set title = content_slot_title(new.title, slot)
       where task_id = new.id and slot is not null
         and title = content_slot_title(old.title, slot);
    end if;
    if new.content_types is distinct from old.content_types then
      update content_bank c
         set type = new.content_types[c.slot]
       where c.task_id = new.id and c.slot is not null
         and new.content_types[c.slot] is not null
         and new.content_types[c.slot] is distinct from old.content_types[c.slot]
         and c.type is distinct from new.content_types[c.slot];
    end if;
    -- The same for where each piece goes. A slot the task leaves blank keeps
    -- whatever its piece already says.
    if new.content_placements is distinct from old.content_placements then
      update content_bank c
         set placement = new.content_placements[c.slot]
       where c.task_id = new.id and c.slot is not null
         and new.content_placements[c.slot] is not null
         and new.content_placements[c.slot] is distinct from old.content_placements[c.slot]
         and c.placement is distinct from new.content_placements[c.slot];
    end if;
  end if;
  perform sync_content_slots(new.id);
  return null;
end;
$function$;

drop trigger if exists tasks_content_slots on tasks;
create trigger tasks_content_slots
  after insert or update of kind, content_count, content_types, content_placements, assignee_id, title
  on tasks for each row execute function tasks_sync_content_slots();

-- generate_recurring_occurrences as in 0032, copying each task's placements.
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
              content_types, content_placements, created_by, created_at, duration_days
            ) values (
              v_new, t.title, t.description, t.department, t.assignee_id, t.priority,
              v_tstart, v_due, t.estimated_hours, t.tags, t.kind, t.content_count,
              t.content_types, t.content_placements, t.created_by, clock_timestamp(), t.duration_days
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
