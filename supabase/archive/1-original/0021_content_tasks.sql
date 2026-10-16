-- =============================================================================
-- Content tasks: one task, several pieces, each approved on its own.
-- Run after 0020_obc_delivery_services.sql.
--
-- "Content for 5 reels" is one piece of work to plan and one to schedule, but
-- five things to write, hand out and approve. Modelling it as five tasks loses
-- that it is one commitment; modelling it as one task loses the five verdicts.
-- So a task gains a kind and a count, and each piece in the Content Bank gains
-- the small workflow a task already has.
--
-- Who does what:
--   * The writer (the task's assignee) writes each piece and submits it.
--   * Whoever may review the task - its creator, the Project Leader, or a
--     global manager - approves, rejects or asks for changes, one piece at a
--     time. Same rule as can_review_task, deliberately.
--   * When every piece is approved and the count is met, the task approves
--     itself. Nobody has to remember to close it.
-- =============================================================================

-- Guarded so the file can be re-run; Postgres has no CREATE TYPE IF NOT EXISTS.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'content_status') then
    create type content_status as enum (
      'Not Started', 'Submitted', 'Changes Required', 'Rejected', 'Approved'
    );
  end if;
end
$$;

alter table tasks
  add column if not exists kind text not null default 'standard'
    check (kind in ('standard', 'content')),
  -- The count asked for. A target, not a ceiling: the writer may add more, and
  -- the progress bar follows whichever is larger.
  add column if not exists content_count integer not null default 0
    check (content_count >= 0);

alter table content_bank
  add column if not exists status       content_status not null default 'Not Started',
  add column if not exists submitted_at timestamptz;

create index if not exists content_bank_status_idx on content_bank (task_id, status);

-- One verdict on one piece. Rewrites keep the whole trail, exactly as a task's
-- reviews do, so "why was this changed three times" stays answerable.
create table if not exists content_reviews (
  id            uuid primary key default uuid_generate_v4(),
  content_id    uuid not null references content_bank (id) on delete cascade,
  by_profile_id uuid references profiles (id) on delete set null default auth.uid(),
  decision      review_decision not null,
  remarks       text not null default '',
  created_at    timestamptz not null default now()
);

create index if not exists content_reviews_content_idx
  on content_reviews (content_id, created_at);

-- ------------------------------------------------------------ workflow ----

-- The writer hands a piece over. Only the person who wrote it, and only when
-- it is theirs to hand over.
create or replace function submit_content(p_content_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_author uuid;
begin
  select created_by into v_author from content_bank where id = p_content_id;
  if v_author is null then
    raise exception 'That content no longer exists.' using errcode = 'P0002';
  end if;
  if v_author <> auth.uid() then
    raise exception 'Only the writer can submit their own content.' using errcode = '42501';
  end if;

  update content_bank
     set status = 'Submitted', submitted_at = now()
   where id = p_content_id;
end;
$$;

-- Does the whole batch stand approved? The denominator is the count that was
-- asked for, or the number actually written when the writer has added more.
create or replace function sync_content_task(p_task_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_kind  text;
  v_count integer;
  v_written integer;
  v_approved integer;
  v_total integer;
begin
  select kind, content_count into v_kind, v_count from tasks where id = p_task_id;
  if v_kind is distinct from 'content' then
    return;
  end if;

  select count(*), count(*) filter (where status = 'Approved')
    into v_written, v_approved
    from content_bank where task_id = p_task_id;

  v_total := greatest(v_count, v_written);

  if v_total > 0 and v_approved = v_total then
    update tasks set status = 'Approved' where id = p_task_id and status <> 'Approved';
  else
    -- A piece that stops being approved re-opens the task, so a batch can
    -- never read as finished while part of it is still being rewritten.
    update tasks
       set status = 'In Progress'
     where id = p_task_id and status = 'Approved';
  end if;
end;
$$;

-- A verdict on one piece.
create or replace function review_content(
  p_content_id uuid,
  p_decision   review_decision,
  p_remarks    text default ''
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_task uuid;
  v_author uuid;
  v_type text;
begin
  select task_id, created_by, type::text
    into v_task, v_author, v_type
    from content_bank where id = p_content_id;

  if v_author is null then
    raise exception 'That content no longer exists.' using errcode = 'P0002';
  end if;
  if v_task is null then
    raise exception 'Only content written for a task can be reviewed.'
      using errcode = '22023';
  end if;
  if not can_review_task(v_task) then
    raise exception 'You cannot review this content.' using errcode = '42501';
  end if;
  if p_decision = 'Waiting for Client Response' then
    raise exception 'Content is settled in-house; that outcome does not apply.'
      using errcode = '22023';
  end if;

  insert into content_reviews (content_id, decision, remarks)
  values (p_content_id, p_decision, coalesce(p_remarks, ''));

  update content_bank
     set status = p_decision::text::content_status
   where id = p_content_id;

  -- Tell the writer, unless they reviewed their own piece.
  if v_author <> auth.uid() then
    perform notify(
      array[v_author],
      'review_decision'::notification_type,
      p_decision::text || ': ' || v_type,
      coalesce(nullif(btrim(p_remarks), ''), 'No remarks.'),
      '/content-bank?entry=' || p_content_id
    );
  end if;

  perform sync_content_task(v_task);
end;
$$;

-- Adding or removing a piece changes the denominator, so the task's own status
-- has to be reconsidered then too - not only when a verdict is given.
create or replace function touch_content_task()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'INSERT' and old.task_id is not null then
    perform sync_content_task(old.task_id);
  end if;
  if tg_op <> 'DELETE' and new.task_id is not null then
    perform sync_content_task(new.task_id);
  end if;
  return null;
end;
$$;

drop trigger if exists content_bank_sync_task on content_bank;
create trigger content_bank_sync_task
  after insert or delete or update of task_id, status on content_bank
  for each row execute function touch_content_task();

-- ----------------------------------------------------------------- RLS ----

alter table content_reviews enable row level security;

-- Reading a verdict follows reading the piece it is about.
drop policy if exists content_reviews_read on content_reviews;
create policy content_reviews_read on content_reviews
  for select to authenticated
  using (exists (
    select 1 from content_bank c
     where c.id = content_id
       and (can_see_project(c.project_id) or c.allotted_to = auth.uid())
  ));

-- Rows are written by review_content() alone, which checks the rule itself.
-- No insert policy is granted, so the table cannot be written around it.

comment on column tasks.kind is
  'standard = one piece of work with one review; content = a batch of Content Bank pieces, each reviewed on its own.';
comment on column tasks.content_count is
  'Content tasks: how many pieces were asked for. A target, not a ceiling.';
