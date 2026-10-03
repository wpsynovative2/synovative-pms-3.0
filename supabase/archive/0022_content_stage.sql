-- =============================================================================
-- Content Bank: a production stage, and allotting from the piece itself.
-- Run after 0021_content_tasks.sql.
--
-- `status` (0021) is the review verdict on the words. Once the words stand,
-- the piece still has a life of its own - handed to a designer, built,
-- scheduled, or dropped - and that is what `stage` records. It is optional:
-- a piece nobody has picked up yet has no stage.
--
-- Both changes go through SECURITY DEFINER functions rather than the table's
-- update policy, because the update policy is the writer's alone (0018) and
-- rewriting the copy must stay that way. Handing a piece on, or saying where
-- it has got to, is a narrower right held by more people:
--
--   * Allotting   - the writer, the task's reviewer, the Project Leader and
--                   the global managers.
--   * Stage       - all of the above, plus whoever the piece is allotted to
--                   (the designer marks the design done) and the author desks
--                   on the project (Social Media Marketing schedules it).
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'content_stage') then
    create type content_stage as enum (
      'Ready To Move', 'Design Completed', 'Scheduled', 'Cancelled', 'Carry Forwarded'
    );
  end if;
end
$$;

alter table content_bank
  add column if not exists stage content_stage;

-- Who may hand a piece on. Kept as one predicate so the two functions below,
-- and lib/permissions.ts canAllotContent, read the same rule.
create or replace function can_manage_content(p_content_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from content_bank c
     where c.id = p_content_id
       and (
         c.created_by = auth.uid()
         or is_global_manager()
         or leads_project(c.project_id)
         or (c.task_id is not null and can_review_task(c.task_id))
       )
  );
$$;

create or replace function allot_content(p_content_id uuid, p_profile_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from content_bank where id = p_content_id) then
    raise exception 'That content no longer exists.' using errcode = 'P0002';
  end if;
  if not can_manage_content(p_content_id) then
    raise exception 'You cannot allot this content.' using errcode = '42501';
  end if;
  if p_profile_id is not null
     and not exists (select 1 from profiles where id = p_profile_id and active) then
    raise exception 'That team member is not active.' using errcode = '22023';
  end if;

  -- notify_content_allotment (0014) tells the new holder.
  update content_bank set allotted_to = p_profile_id where id = p_content_id;
end;
$$;

create or replace function set_content_stage(p_content_id uuid, p_stage content_stage)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_project uuid;
  v_allotted uuid;
begin
  select project_id, allotted_to into v_project, v_allotted
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

  update content_bank set stage = p_stage where id = p_content_id;
end;
$$;

comment on column content_bank.stage is
  'Where the piece has got to after writing: Ready To Move, Design Completed, Scheduled, Cancelled, Carry Forwarded. Null until someone sets it.';
