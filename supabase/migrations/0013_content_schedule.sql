-- =============================================================================
-- When a piece goes out, which month it is for, and submitting a content task
-- through the Content Bank. Run after 0012_output_content_bank.sql.
--
--   * content_bank.for_month    - the month the piece is for (first of the
--                                 month). Every piece has one: slots take the
--                                 task's month, anything else its own date's.
--   * content_bank.scheduled_on - set with the "Scheduled" stage: the day it
--                                 goes out.
--   * content_bank.carry_month  - set with "Carry Forwarded": the month it moves
--                                 to, always after for_month.
--   * submissions.links         - for a "Content Bank" submission, a link to
--                                 every piece on the task.
--
-- set_content_stage() takes the date with the stage and refuses Scheduled or
-- Carry Forwarded without one. submit_task() refuses a content task while any
-- of the pieces it asked for (its slots) has no stage yet - extras do not
-- count - and only a content task may submit to the Content Bank.
-- =============================================================================

-- ------------------------------------------------------------- columns ----

alter table content_bank
  add column if not exists for_month    date,
  add column if not exists scheduled_on date,
  add column if not exists carry_month  date;

-- Existing pieces: a slot is for its task's month, anything else for its date's.
update content_bank c
   set for_month = date_trunc('month', coalesce(
         (select t.start_date from tasks t where t.id = c.task_id and c.slot is not null),
         c.entry_date))::date
 where c.for_month is null;

alter table content_bank
  alter column for_month set default date_trunc('month', ist_today())::date,
  alter column for_month set not null;

alter table content_bank
  drop constraint if exists content_bank_months_are_months;
alter table content_bank
  add constraint content_bank_months_are_months check (
    extract(day from for_month) = 1
    and (carry_month is null or extract(day from carry_month) = 1)
  );

create index if not exists content_bank_for_month_idx on content_bank (for_month);

alter table submissions
  add column if not exists links text[] not null default '{}';

comment on column content_bank.for_month is
  'The month this piece is for (first day of the month).';
comment on column content_bank.scheduled_on is
  'Set with the Scheduled stage: the day the piece goes out.';
comment on column content_bank.carry_month is
  'Set with the Carry Forwarded stage: the month it moves to (first day), after for_month.';
comment on column submissions.links is
  'For a Content Bank submission: a link to every piece on the task.';

-- ------------------------------------------------------- the stage ----

drop function if exists set_content_stage(uuid, content_stage);

-- Who may move a piece on is unchanged (0022). What is new is the date that
-- comes with two of the stages, and that changing stage clears the other's.
create or replace function set_content_stage(
  p_content_id uuid,
  p_stage      content_stage,
  p_date       date default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_project  uuid;
  v_allotted uuid;
  v_for      date;
begin
  select project_id, allotted_to, for_month into v_project, v_allotted, v_for
    from content_bank where id = p_content_id;
  if v_project is null then
    raise exception 'That content no longer exists.' using errcode = 'P0002';
  end if;
  if not (
    can_manage_content(p_content_id)
    or v_allotted = auth.uid()
    or (can_write_content() and can_see_project(v_project))
  ) then
    raise exception 'You cannot change where this content has got to.' using errcode = '42501';
  end if;

  if p_stage = 'Scheduled' and p_date is null then
    raise exception 'Pick the date it is scheduled for.' using errcode = '22023';
  end if;
  if p_stage = 'Carry Forwarded' then
    if p_date is null then
      raise exception 'Pick the month it is carried forward to.' using errcode = '22023';
    end if;
    if date_trunc('month', p_date)::date <= v_for then
      raise exception 'Carry it forward to a month after the one it is for.' using errcode = '22023';
    end if;
  end if;

  update content_bank
     set stage        = p_stage,
         scheduled_on = case when p_stage = 'Scheduled' then p_date end,
         carry_month  = case when p_stage = 'Carry Forwarded'
                             then date_trunc('month', p_date)::date end
   where id = p_content_id;
end;
$$;

-- ------------------------------------------------ slots get a month ----

-- As 0009, with the task's month on every new slot.
create or replace function sync_content_slots(p_task_id uuid)
returns void language plpgsql security definer set search_path = public as $$
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
        (project_id, task_id, slot, title, type, billing_type, created_by, for_month)
      values
        (t.project_id, t.id, n, content_slot_title(t.title, n),
         'Static Design', 'Count', t.assignee_id, date_trunc('month', t.start_date)::date);
    end if;
  end loop;

  -- Empty slots are the assignee's to fill.
  update content_bank c
     set created_by = t.assignee_id
   where c.task_id = t.id and c.slot is not null and content_is_empty(c)
     and c.created_by is distinct from t.assignee_id;
end;
$$;

-- -------------------------------------------------------- submitting ----

drop function if exists submit_task(uuid, output_location, text, text);

create or replace function submit_task(
  p_task_id     uuid,
  p_output      output_location,
  p_drive_link  text,
  p_description text,
  p_links       text[] default '{}'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_task       tasks%rowtype;
  v_submission uuid;
  v_reviewers  uuid[];
  v_allotter   uuid[];
  v_name       text;
  v_unset      text;
begin
  select * into v_task from tasks where id = p_task_id;
  -- Null-safe on purpose: an unassigned task belongs to nobody, and `<>`
  -- against NULL is NULL, which would let anyone through.
  if v_task.assignee_id is null or v_task.assignee_id <> auth.uid() then
    raise exception 'Only the assignee can submit this task';
  end if;

  if v_task.kind = 'content' then
    -- Every piece the task asked for needs a status first; extras do not.
    select string_agg(coalesce(nullif(btrim(title), ''), 'Piece ' || slot), ', ' order by slot)
      into v_unset
      from content_bank
     where task_id = p_task_id and slot is not null and stage is null;
    if v_unset is not null then
      raise exception 'Give every piece a status before submitting. Still not set: %', v_unset
        using errcode = '22023';
    end if;
    if p_output <> 'Content Bank' then
      raise exception 'A content task is submitted to the Content Bank.' using errcode = '22023';
    end if;
  elsif p_output = 'Content Bank' then
    raise exception 'Only a content task is submitted to the Content Bank.' using errcode = '22023';
  end if;

  update time_sessions
     set ended_at = now(), end_reason = 'Submitted'
   where task_id = p_task_id and profile_id = auth.uid() and ended_at is null;

  insert into submissions (task_id, by_profile_id, output_location, drive_link, description, links)
  values (p_task_id, auth.uid(), p_output, p_drive_link, coalesce(p_description, ''),
          coalesce(p_links, '{}'))
  returning id into v_submission;

  update tasks set status = 'Submitted' where id = p_task_id;

  -- Project Leader for project tasks; managers for individual tasks.
  if v_task.project_id is null then
    select array_agg(id) into v_reviewers
      from profiles where active and role in ('super_admin', 'admin', 'manager');
  else
    select array[leader_id] into v_reviewers from projects where id = v_task.project_id;
    -- A project with no leader still needs someone to look at the work.
    if v_reviewers[1] is null then
      select array_agg(id) into v_reviewers
        from profiles where active and role in ('super_admin', 'admin', 'manager');
    end if;
  end if;

  -- Whoever allotted the task reviews it too when they are a Team Leader.
  select array_agg(p.id) into v_allotter
    from profiles p where p.id = v_task.created_by and p.role = 'team_leader';

  select full_name into v_name from profiles where id = auth.uid();
  perform notify(
    coalesce(v_reviewers, '{}') || coalesce(v_allotter, '{}'), 'task_submitted',
    'Task submitted for review',
    v_name || ' submitted "' || v_task.title || '".',
    task_href(p_task_id, v_task.project_id)
  );

  return v_submission;
end;
$$;

notify pgrst, 'reload schema';
