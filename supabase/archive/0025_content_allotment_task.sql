-- =============================================================================
-- Allotting content: managers only, and always onto a task. Run after
-- 0024_content_without_review.sql.
--
-- Writers write; they no longer hand pieces out. Allotting is for the people
-- who plan the work - Super Admin, Admin, Manager, the project's Project
-- Leader and Team Leaders - which is exactly who may create a task on the
-- project (tasks_insert, 0002), so the same people can raise the task a piece
-- needs in the same step.
--
-- A piece allotted to someone now names the task it is for
-- (content_bank.allotted_task_id). That task must be the allottee's own, on
-- the piece's project. Someone outside the project therefore has to be given
-- a task there first, which is how they are brought onto it. The piece then
-- shows on that task, so the designer goes from the task to the copy.
--
-- content_bank.task_id is unchanged: it is still the *writer's* task.
-- =============================================================================

alter table content_bank
  add column if not exists allotted_task_id uuid references tasks (id) on delete set null;

create index if not exists content_bank_allotted_task_idx on content_bank (allotted_task_id);

-- Who may hand a piece on. Mirrors lib/permissions.ts canAllotContent.
create or replace function can_allot_content(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_global_manager() or leads_project(p_project_id) or is_team_leader();
$$;

-- The two-argument version from 0022 let the writer allot and named no task.
drop function if exists allot_content(uuid, uuid);

create or replace function allot_content(
  p_content_id uuid,
  p_profile_id uuid,
  p_task_id    uuid
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_project uuid;
begin
  select project_id into v_project from content_bank where id = p_content_id;
  if v_project is null then
    raise exception 'That content no longer exists.' using errcode = 'P0002';
  end if;
  if not can_allot_content(v_project) then
    raise exception 'Only a manager, the Project Leader or a Team Leader can allot content.'
      using errcode = '42501';
  end if;

  -- Taking a piece back clears both halves together.
  if p_profile_id is null then
    update content_bank set allotted_to = null, allotted_task_id = null where id = p_content_id;
    return;
  end if;

  if not exists (select 1 from profiles where id = p_profile_id and active) then
    raise exception 'That team member is not active.' using errcode = '22023';
  end if;
  if p_task_id is null then
    raise exception 'Pick or create the task this piece is for.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from tasks
     where id = p_task_id and project_id = v_project and assignee_id = p_profile_id
  ) then
    raise exception 'That task is not theirs on this project.' using errcode = '22023';
  end if;

  -- notify_content_allotment (0014) tells the new holder.
  update content_bank
     set allotted_to = p_profile_id, allotted_task_id = p_task_id
   where id = p_content_id;
end;
$$;

-- The writer's own insert and update policies (0014, 0018) would otherwise
-- still let them set allotted_to on their piece directly. Allotment changes
-- are refused unless the caller may allot - allot_content() passes this,
-- because auth.uid() inside it is still the caller.
create or replace function guard_content_allotment()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  -- Deleting the allotted task blanks the link by foreign key, and whoever
  -- deleted the task need not be someone who may allot.
  if tg_op = 'UPDATE'
     and new.allotted_to is not distinct from old.allotted_to
     and new.allotted_task_id is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if (new.allotted_to is not null or new.allotted_task_id is not null)
       and not can_allot_content(new.project_id) then
      raise exception 'Only a manager, the Project Leader or a Team Leader can allot content.'
        using errcode = '42501';
    end if;
  elsif (new.allotted_to is distinct from old.allotted_to
         or new.allotted_task_id is distinct from old.allotted_task_id)
        and not can_allot_content(new.project_id) then
    raise exception 'Only a manager, the Project Leader or a Team Leader can allot content.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists content_bank_guard_allotment on content_bank;
create trigger content_bank_guard_allotment
  before insert or update on content_bank
  for each row execute function guard_content_allotment();

comment on column content_bank.allotted_task_id is
  'The allottee''s task this piece is for, on the same project. Set with allotted_to by allot_content().';

notify pgrst, 'reload schema';
