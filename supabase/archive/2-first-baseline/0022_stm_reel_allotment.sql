-- A Static to Motion piece (0021: "Static to Motion", "Festival STM") is made
-- twice over: a static design first, then that design edited into a reel. So
-- it is allotted twice, both at once:
--
--   allotted_to / allotted_task_id                the Static Design part, as
--                                                 for every other piece
--   motion_allotted_to / motion_allotted_task_id  the Reel Editing part, new
--
-- The reel waits for the static: its task must start no earlier than the
-- static task is due. The piece still counts as one, and is Completed once
-- the reel is done (the same single status as any piece).
--
-- Everything that followed the one allotment now follows both: who is told,
-- who may read the piece and move its status, the guard on who may allot,
-- and reassigning a task moving its part along (0014).
--
-- Needs 0021 first.

alter table content_bank
  add column if not exists motion_allotted_to      uuid references profiles(id) on delete set null,
  add column if not exists motion_allotted_task_id uuid references tasks(id) on delete set null;

create index if not exists content_bank_motion_task_idx on content_bank (motion_allotted_task_id);

comment on column content_bank.motion_allotted_to is
  'Static to Motion pieces only: who edits the static into a reel. Set by allot_content().';
comment on column content_bank.motion_allotted_task_id is
  'Static to Motion pieces only: the reel editor''s task. Starts no earlier than the static task is due.';

create or replace function is_stm_type(p_type cb_type)
returns boolean language sql immutable as $$
  select p_type in ('Static to Motion', 'Festival STM');
$$;

-- ---------------------------------------------------------- allotting ----

drop function if exists allot_content(uuid, uuid, uuid);

create or replace function allot_content(
  p_content_id        uuid,
  p_profile_id        uuid,
  p_task_id           uuid,
  p_motion_profile_id uuid default null,
  p_motion_task_id    uuid default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_project uuid;
  v_type    cb_type;
  v_static  date;
  v_reel    date;
begin
  select project_id, type into v_project, v_type from content_bank where id = p_content_id;
  if v_project is null then
    raise exception 'That content no longer exists.' using errcode = 'P0002';
  end if;
  if not can_allot_content(v_project) then
    raise exception 'Only a manager, the Project Leader or a Team Leader can allot content.'
      using errcode = '42501';
  end if;

  -- Taking a piece back clears every part together.
  if p_profile_id is null then
    update content_bank
       set allotted_to = null, allotted_task_id = null,
           motion_allotted_to = null, motion_allotted_task_id = null
     where id = p_content_id;
    return;
  end if;

  if not exists (select 1 from profiles where id = p_profile_id and active) then
    raise exception 'That team member is not active.' using errcode = '22023';
  end if;
  if p_task_id is null then
    raise exception 'Pick or create the task this piece is for.' using errcode = '22023';
  end if;
  select due_date into v_static from tasks
   where id = p_task_id and project_id = v_project and assignee_id = p_profile_id;
  if not found then
    raise exception 'That task is not theirs on this project.' using errcode = '22023';
  end if;

  if not is_stm_type(v_type) then
    update content_bank
       set allotted_to = p_profile_id, allotted_task_id = p_task_id,
           motion_allotted_to = null, motion_allotted_task_id = null
     where id = p_content_id;
    return;
  end if;

  -- Static to Motion: the reel part is allotted in the same breath.
  if p_motion_profile_id is null or p_motion_task_id is null then
    raise exception 'A Static to Motion piece needs the reel editing allotted too.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from profiles where id = p_motion_profile_id and active) then
    raise exception 'The reel editor is not active.' using errcode = '22023';
  end if;
  select start_date into v_reel from tasks
   where id = p_motion_task_id and project_id = v_project and assignee_id = p_motion_profile_id;
  if not found then
    raise exception 'That reel editing task is not theirs on this project.' using errcode = '22023';
  end if;
  if p_motion_task_id = p_task_id then
    raise exception 'The static design and the reel editing need a task each.' using errcode = '22023';
  end if;
  if v_reel < v_static then
    raise exception 'The reel editing waits for the static design: pick a task starting on or after %.',
      to_char(v_static, 'FMDD Mon YYYY') using errcode = '22023';
  end if;

  -- notify_content_allotment tells each new holder.
  update content_bank
     set allotted_to = p_profile_id, allotted_task_id = p_task_id,
         motion_allotted_to = p_motion_profile_id, motion_allotted_task_id = p_motion_task_id
   where id = p_content_id;
end;
$$;

-- Who may hand a piece on is unchanged; the reel part is guarded the same way.
create or replace function guard_content_allotment()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if (new.allotted_to is not null or new.allotted_task_id is not null
        or new.motion_allotted_to is not null or new.motion_allotted_task_id is not null)
       and not can_allot_content(new.project_id) then
      raise exception 'Only a manager, the Project Leader or a Team Leader can allot content.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Each part on its own: unchanged, blanked by its task being deleted, or
  -- following its task's new assignee (0014) needs no right to allot.
  if (
       (new.allotted_to is not distinct from old.allotted_to
        and new.allotted_task_id is not distinct from old.allotted_task_id)
    or (new.allotted_to is not distinct from old.allotted_to and new.allotted_task_id is null)
    or (new.allotted_task_id is not null
        and new.allotted_task_id is not distinct from old.allotted_task_id
        and new.allotted_to is not distinct from
            (select assignee_id from tasks where id = new.allotted_task_id))
  ) and (
       (new.motion_allotted_to is not distinct from old.motion_allotted_to
        and new.motion_allotted_task_id is not distinct from old.motion_allotted_task_id)
    or (new.motion_allotted_to is not distinct from old.motion_allotted_to
        and new.motion_allotted_task_id is null)
    or (new.motion_allotted_task_id is not null
        and new.motion_allotted_task_id is not distinct from old.motion_allotted_task_id
        and new.motion_allotted_to is not distinct from
            (select assignee_id from tasks where id = new.motion_allotted_task_id))
  ) then
    return new;
  end if;

  if not can_allot_content(new.project_id) then
    raise exception 'Only a manager, the Project Leader or a Team Leader can allot content.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Tell each new holder - static and reel - unless they allotted it to themselves.
create or replace function notify_content_allotment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_project text;
begin
  if auth.uid() is null then
    return new;
  end if;
  select name into v_project from projects where id = new.project_id;

  if new.allotted_to is not null and new.allotted_to <> auth.uid()
     and (tg_op = 'INSERT' or new.allotted_to is distinct from old.allotted_to) then
    perform notify(
      array[new.allotted_to],
      'content_allotted',
      'Content allotted to you',
      new.type::text
        || case when is_stm_type(new.type) then ' (static design)' else '' end
        || ' for ' || coalesce(v_project, 'a project'),
      '/content-bank?entry=' || new.id
    );
  end if;

  if new.motion_allotted_to is not null and new.motion_allotted_to <> auth.uid()
     and (tg_op = 'INSERT' or new.motion_allotted_to is distinct from old.motion_allotted_to) then
    perform notify(
      array[new.motion_allotted_to],
      'content_allotted',
      'Reel editing allotted to you',
      new.type::text || ' for ' || coalesce(v_project, 'a project')
        || ' - starts once the static design is done',
      '/content-bank?entry=' || new.id
    );
  end if;
  return new;
end;
$$;

-- Reassigning a task moves the part allotted to it (0014), reel part included.
create or replace function follow_task_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update content_bank
     set allotted_to = new.assignee_id
   where allotted_task_id = new.id
     and allotted_to is distinct from new.assignee_id;
  update content_bank
     set motion_allotted_to = new.assignee_id
   where motion_allotted_task_id = new.id
     and motion_allotted_to is distinct from new.assignee_id;
  return null;
end;
$$;

-- ------------------------------------------------------ the status ----

-- As 0013, with the reel editor among those who may move the piece on: it is
-- Completed once the reel is done, and they are the one who knows.
create or replace function set_content_stage(
  p_content_id uuid,
  p_stage      content_stage,
  p_date       date default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_project  uuid;
  v_allotted uuid;
  v_motion   uuid;
  v_for      date;
begin
  select project_id, allotted_to, motion_allotted_to, for_month
    into v_project, v_allotted, v_motion, v_for
    from content_bank where id = p_content_id;
  if v_project is null then
    raise exception 'That content no longer exists.' using errcode = 'P0002';
  end if;
  if not (
    can_manage_content(p_content_id)
    or v_allotted = auth.uid()
    or v_motion = auth.uid()
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

-- ------------------------------------------------------------- read ----

drop policy if exists content_bank_read on content_bank;
create policy content_bank_read on content_bank for select to authenticated
  using (
    (select is_global_manager())
    or project_id = any ((select my_project_ids())::uuid[])
    or allotted_to = (select auth.uid())
    or motion_allotted_to = (select auth.uid())
  );

notify pgrst, 'reload schema';
