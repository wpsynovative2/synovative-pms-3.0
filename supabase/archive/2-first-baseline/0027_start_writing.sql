-- A piece is started by its writer pressing "Start Writing", not by someone
-- setting its stage. Until then its stage is locked.
--
--   * content_bank.started_by - who started it.
--   * start_content_piece()  - the button: only the writer the piece's task
--                              is assigned to may press it.
--   * stamp_content_journey  - as 0018, and a piece nobody has started (and
--                              with nothing written in it) cannot be given a
--                              stage. Writing in it still counts as starting.
--
-- Mirrors isContentStarted / canStartContent in lib/types.ts and
-- lib/permissions.ts.

alter table content_bank
  add column if not exists started_by uuid references profiles(id) on delete set null;

comment on column content_bank.started_by is
  'Who started the piece: its writer pressing Start Writing, or whoever first wrote in it.';
comment on column content_bank.started_at is
  'When the piece was started: Start Writing, or the first thing written in it.';

create or replace function stamp_content_journey()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Started: Start Writing sets it; failing that, the first thing written.
  if new.started_at is null and not content_is_empty(new) then
    new.started_at := now();
    new.started_by := coalesce(new.started_by, auth.uid());
  end if;

  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    -- No stage before the writer has started.
    if new.stage is not null and new.started_at is null then
      raise exception 'Start writing this piece before setting its status.'
        using errcode = 'check_violation';
    end if;
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

create or replace function start_content_piece(p_content_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_assignee uuid;
begin
  select t.assignee_id into v_assignee
    from content_bank c join tasks t on t.id = c.task_id
   where c.id = p_content_id;
  if not found then
    raise exception 'This piece is not on a content task.';
  end if;
  if v_assignee is distinct from auth.uid() then
    raise exception 'Only the writer the task is assigned to can start this piece.'
      using errcode = 'insufficient_privilege';
  end if;

  update content_bank
     set started_at = coalesce(started_at, now()),
         started_by = coalesce(started_by, auth.uid())
   where id = p_content_id;
end;
$$;

revoke all on function start_content_piece(uuid) from public;
grant execute on function start_content_piece(uuid) to authenticated;

notify pgrst, 'reload schema';
