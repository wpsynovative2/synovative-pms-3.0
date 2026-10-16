-- Content placement: where a piece is going to be used - SMM (social media)
-- or WhatsApp Share. One of the two, never both, and required: a piece cannot
-- be written without saying which, and a content task cannot be submitted
-- while any of its pieces lacks one.
--
-- Empty pieces (a content task's slots before anyone writes in them) and pieces
-- written before this migration have none until someone next edits them.

do $$
begin
  create type content_placement as enum ('SMM', 'WhatsApp Share');
exception when duplicate_object then null;
end $$;

alter table content_bank add column if not exists placement content_placement;

comment on column content_bank.placement is
  'Where the piece will be used: SMM or WhatsApp Share. Required once anything is written in it.';

-- Writing in a piece, or clearing its placement, needs a placement. Moving a
-- piece between tasks or changing its status does not touch this.
create or replace function guard_content_placement()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.placement is not null or content_is_empty(new) then
    return new;
  end if;
  if tg_op = 'INSERT'
     or old.placement is not null
     or new.on_pic is distinct from old.on_pic
     or new.caption is distinct from old.caption
     or new.description is distinct from old.description
     or new.reference_links is distinct from old.reference_links then
    raise exception 'Pick the content placement: SMM or WhatsApp Share.' using errcode = '23502';
  end if;
  return new;
end;
$$;

drop trigger if exists content_bank_guard_placement on content_bank;
create trigger content_bank_guard_placement
  before insert or update on content_bank
  for each row execute function guard_content_placement();

-- ---------------------------------------------------------- submitting ----

-- As 0013, also refusing a content task whose pieces lack a placement.
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
    -- And every piece with something in it says where it goes (0023).
    select string_agg(coalesce(nullif(btrim(title), ''), 'Piece ' || coalesce(slot::text, '')),
                      ', ' order by slot nulls last, created_at)
      into v_unset
      from content_bank c
     where c.task_id = p_task_id and c.placement is null
       and (c.slot is not null or not content_is_empty(c));
    if v_unset is not null then
      raise exception 'Give every piece a content placement before submitting. Still not set: %', v_unset
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
