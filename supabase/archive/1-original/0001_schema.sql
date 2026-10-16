-- =============================================================================
-- Agency PMS — schema
-- PRD §2 (Supabase PostgreSQL), §5 (master data), §19 (free-tier guidelines)
-- Run this first, then 0002_rls.sql, then 0003_jobs.sql.
-- =============================================================================

create extension if not exists "uuid-ossp";

-- ----------------------------------------------------------------- enums ---

create type app_role as enum (
  'super_admin', 'admin', 'manager', 'hr_admin', 'team_leader', 'team_member'
);

create type project_status as enum (
  'Planning', 'Active', 'On Hold', 'Completed', 'Cancelled', 'Archived'
);

create type priority_level as enum ('Low', 'Medium', 'High', 'Critical');

create type task_status as enum (
  'Not Started', 'In Progress', 'Submitted', 'Changes Required', 'Rejected', 'Approved'
);

create type session_end_reason as enum (
  'End of day', 'Switched', 'Submitted', 'Auto-stopped'
);

create type output_location as enum ('Google Drive', 'WhatsApp');
create type review_decision as enum ('Approved', 'Changes Required', 'Rejected');
create type review_source as enum ('Client', 'Project Leader');
create type expense_status as enum ('Pending', 'Approved', 'Rejected');

create type notification_type as enum (
  'task_assigned', 'task_submitted', 'review_decision', 'remark_added',
  'expense_added', 'expense_reviewed', 'due_soon', 'overdue', 'timer_autostop'
);

-- ----------------------------------------------------------- master data ---

create table departments (
  name text primary key
);

insert into departments (name) values
  ('Graphic Designers'),
  ('Videographers / Video Editors / Motion Graphics'),
  ('Social Media Marketing'),
  ('Project Managers'),
  ('Performance Marketers'),
  ('3D Artists'),
  ('Website Developers'),
  ('Business Development Executives'),
  ('Inside Sales Executives'),
  ('Accounts & Finance'),
  ('Human Resources & Admin'),
  ('Content Writers / Copywriters / Brand Strategists');

create table services (
  name text primary key
);

insert into services (name) values
  ('Social Media Management Services'), ('Facebook Ads Campaign'), ('Google Ads'),
  ('YouTube Ads'), ('Static Creative Design'), ('Video Editing'),
  ('Brochure Design and Conceptualization'), ('Drone Shoot and Edit'), ('Hosting'),
  ('Logo Design'), ('Website Design and Development'), ('Drone Rental'),
  ('Leads Automation'), ('Site Branding and Conceptualization'), ('Campaign Design'),
  ('Hoarding Printing and Installation'), ('Motion Graphics'),
  ('Hoarding Design and Conceptualization'), ('Hoarding Design and Edits'),
  ('SEO Service'), ('Brand PPT Creation'), ('Creative Post'),
  ('Festival and Event Creative'), ('Reel Editing'), ('Video Shoot & Editing'),
  ('Design and Conceptualization'), ('Storyboard Video'), ('Voice-Over'),
  ('Videography & Photography'), ('Channel Partner Kit'), ('Website Annual Renewal'),
  ('Domain'), ('Website Maintenance'), ('CP Meet Campaign'), ('Landing Page'),
  ('Social Account Setup'), ('Licensed Images'), ('Performance Marketing'),
  ('Influencer Artist'), ('3D Walkthrough Animation'), ('CGI Video'),
  ('Monthly Retainer'), ('Pamphlet Design'), ('Newspaper Insertion'),
  ('AI Video Production & Digital Presenter Creation'),
  ('Project Launch Campaign Design'), ('General Campaign Design'),
  ('Online Reputation Management (ORM)'), ('Bhoomi Pooja Event'),
  ('Corporate Brand Identity & Communication');

-- --------------------------------------------------------------- people ---

-- Mirrors auth.users. Created server-side when an admin adds a user (§6).
create table profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  full_name             text        not null,
  email                 text        not null unique,
  role                  app_role    not null default 'team_member',
  active                boolean     not null default true,
  must_change_password  boolean     not null default true,
  created_at            timestamptz not null default now()
);

-- A Team Leader can lead several departments (§4.1).
create table profile_departments (
  profile_id uuid not null references profiles (id) on delete cascade,
  department text not null references departments (name),
  primary key (profile_id, department)
);

create index on profile_departments (department);

-- ------------------------------------------------------------- projects ---

create table projects (
  id          uuid primary key default uuid_generate_v4(),
  name        text            not null,
  color       text            not null default '#5F3CA7',
  client_name text            not null,
  start_date  date            not null,
  deadline    date            not null,
  description text            not null default '',
  status      project_status  not null default 'Planning',
  priority    priority_level  not null default 'Medium',
  leader_id   uuid            not null references profiles (id),
  created_by  uuid            references profiles (id),
  created_at  timestamptz     not null default now(),
  constraint project_dates_ordered check (deadline >= start_date)
);

create index on projects (leader_id);
create index on projects (status);

create table project_services (
  project_id uuid not null references projects (id) on delete cascade,
  service    text not null references services (name),
  primary key (project_id, service)
);

create table project_members (
  project_id uuid not null references projects (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  primary key (project_id, profile_id)
);

create index on project_members (profile_id);

-- ---------------------------------------------------------------- tasks ---

-- project_id null → individual task (§10).
create table tasks (
  id              uuid primary key default uuid_generate_v4(),
  project_id      uuid           references projects (id) on delete cascade,
  title           text           not null,
  description     text           not null default '',
  department      text           not null references departments (name),
  assignee_id     uuid           not null references profiles (id),
  status          task_status    not null default 'Not Started',
  priority        priority_level not null default 'Medium',
  start_date      date           not null,
  due_date        date           not null,
  estimated_hours numeric(6,2)   not null check (estimated_hours > 0),
  tags            text[]         not null default '{}',
  created_by      uuid           references profiles (id),
  created_at      timestamptz    not null default now(),
  constraint task_dates_ordered check (due_date >= start_date)
);

create index on tasks (project_id);
create index on tasks (assignee_id);
create index on tasks (department);
create index on tasks (status);
create index on tasks (due_date);
-- Creation order is the display order (§9.2).
create index on tasks (project_id, created_at);

-- §11.3.5 — only start/stop timestamps are stored; elapsed time is computed.
create table time_sessions (
  id         uuid primary key default uuid_generate_v4(),
  task_id    uuid        not null references tasks (id) on delete cascade,
  profile_id uuid        not null references profiles (id),
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  end_reason session_end_reason,
  end_note   text,
  constraint session_ends_after_start check (ended_at is null or ended_at >= started_at)
);

create index on time_sessions (task_id);
create index on time_sessions (profile_id);

-- §11.3.1 — at most one open session per user, enforced in the database.
create unique index one_running_timer_per_user
  on time_sessions (profile_id)
  where ended_at is null;

create table submissions (
  id              uuid primary key default uuid_generate_v4(),
  task_id         uuid            not null references tasks (id) on delete cascade,
  by_profile_id   uuid            not null references profiles (id),
  submitted_at    timestamptz     not null default now(),
  output_location output_location not null,
  drive_link      text,
  description     text            not null default '',
  -- §12.1 — a Drive submission must carry a link.
  constraint drive_needs_link check (
    output_location <> 'Google Drive' or (drive_link is not null and drive_link <> '')
  )
);

create index on submissions (task_id);

create table reviews (
  id              uuid primary key default uuid_generate_v4(),
  task_id         uuid            not null references tasks (id) on delete cascade,
  submission_id   uuid            references submissions (id) on delete set null,
  by_profile_id   uuid            not null references profiles (id),
  reviewed_at     timestamptz     not null default now(),
  decision        review_decision not null,
  source          review_source,
  remarks         text            not null default '',
  new_assignee_id uuid            references profiles (id),
  new_due_date    date,
  -- §12.2 — non-approvals must say where the feedback came from.
  constraint source_required_unless_approved check (
    decision = 'Approved' or source is not null
  ),
  constraint rejection_needs_assignee check (
    decision <> 'Rejected' or new_assignee_id is not null
  )
);

create index on reviews (task_id);

create table remarks (
  id            uuid primary key default uuid_generate_v4(),
  task_id       uuid        not null references tasks (id) on delete cascade,
  by_profile_id uuid        not null references profiles (id),
  created_at    timestamptz not null default now(),
  body          text        not null
);

create index on remarks (task_id);

-- -------------------------------------------------- vendors and expenses ---

create table vendors (
  id             uuid primary key default uuid_generate_v4(),
  name           text         not null,
  service_type   text         references services (name),
  contact_person text         not null default '',
  phone          text         not null default '',
  email          text         not null default '',
  rate           numeric(12,2) not null default 0,
  notes          text
);

create table expenses (
  id              uuid primary key default uuid_generate_v4(),
  project_id      uuid           not null references projects (id) on delete cascade,
  vendor_id       uuid           not null references vendors (id),
  description     text           not null,
  amount          numeric(12,2)  not null check (amount > 0),
  expense_date    date           not null,
  attachment_name text,
  -- Cloudinary secure_url (§2).
  attachment_url  text,
  status          expense_status not null default 'Pending',
  finance_remarks text,
  reviewed_by     uuid           references profiles (id),
  reviewed_at     timestamptz,
  created_by      uuid           references profiles (id),
  created_at      timestamptz    not null default now(),
  -- §8 — a rejection must explain itself.
  constraint rejection_needs_remarks check (
    status <> 'Rejected' or (finance_remarks is not null and finance_remarks <> '')
  )
);

create index on expenses (project_id);
create index on expenses (status);
create index on expenses (expense_date);

-- ------------------------------------------------------------ templates ---

create table project_templates (
  id            uuid primary key default uuid_generate_v4(),
  name          text           not null,
  description   text           not null default '',
  color         text           not null default '#5F3CA7',
  priority      priority_level not null default 'Medium',
  duration_days integer        not null default 30,
  created_at    timestamptz    not null default now()
);

create table project_template_services (
  template_id uuid not null references project_templates (id) on delete cascade,
  service     text not null references services (name),
  primary key (template_id, service)
);

create table project_template_tasks (
  id                uuid primary key default uuid_generate_v4(),
  template_id       uuid           not null references project_templates (id) on delete cascade,
  position          integer        not null,
  title             text           not null,
  description       text           not null default '',
  department        text           not null references departments (name),
  priority          priority_level not null default 'Medium',
  estimated_hours   numeric(6,2)   not null default 4,
  tags              text[]         not null default '{}',
  start_offset_days integer        not null default 0,
  duration_days     integer        not null default 3
);

create index on project_template_tasks (template_id, position);

create table task_templates (
  id              uuid primary key default uuid_generate_v4(),
  title           text           not null,
  description     text           not null default '',
  department      text           not null references departments (name),
  priority        priority_level not null default 'Medium',
  estimated_hours numeric(6,2)   not null default 4,
  duration_days   integer        not null default 2,
  tags            text[]         not null default '{}',
  created_at      timestamptz    not null default now()
);

-- ------------------------------------------------------- working calendar ---

create table holidays (
  holiday_date date primary key,
  name         text not null
);

-- §5.4.5 — HR can force a non-working day back to working.
create table working_overrides (
  override_date date primary key,
  created_by    uuid references profiles (id),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------- notifications ---

create table notifications (
  id         uuid primary key default uuid_generate_v4(),
  profile_id uuid              not null references profiles (id) on delete cascade,
  type       notification_type not null,
  title      text              not null,
  body       text              not null default '',
  href       text              not null default '/',
  read       boolean           not null default false,
  created_at timestamptz       not null default now()
);

-- Powers the unread badge without a table scan.
create index on notifications (profile_id, read, created_at desc);

-- =============================================================================
-- Working-calendar helpers (§5.4) — the same rules the date pickers apply.
-- =============================================================================

create or replace function is_working_day(d date)
returns boolean
language sql
stable
as $$
  select
    case
      when exists (select 1 from working_overrides w where w.override_date = d) then true
      when extract(dow from d) = 0 then false                       -- Sunday (Saturdays work)
      when exists (select 1 from holidays h where h.holiday_date = d) then false
      else true
    end;
$$;

-- =============================================================================
-- Aggregates (§19) — one call instead of many round trips.
-- =============================================================================

create or replace view task_totals as
select
  t.id as task_id,
  coalesce(sum(
    extract(epoch from (coalesce(s.ended_at, now()) - s.started_at))
  ), 0)::bigint as seconds_logged
from tasks t
left join time_sessions s on s.task_id = t.id
group by t.id;

create or replace view project_stats as
select
  p.id                                                as project_id,
  count(t.id)                                         as total_tasks,
  count(t.id) filter (where t.status = 'Approved')    as approved_tasks,
  case when count(t.id) = 0 then 0
       else round(100.0 * count(t.id) filter (where t.status = 'Approved') / count(t.id))
  end                                                 as progress_pct,
  count(t.id) filter (
    where t.status <> 'Approved' and t.due_date < current_date
  )                                                   as overdue_tasks,
  coalesce(sum(tt.seconds_logged), 0)                 as seconds_logged,
  coalesce(sum(t.estimated_hours), 0)                 as estimated_hours
from projects p
left join tasks t       on t.project_id = p.id
left join task_totals tt on tt.task_id = t.id
group by p.id;

create or replace view project_expense_totals as
select
  project_id,
  coalesce(sum(amount) filter (where status = 'Approved'), 0) as approved_total,
  coalesce(sum(amount) filter (where status = 'Pending'),  0) as pending_total,
  coalesce(sum(amount) filter (where status = 'Rejected'), 0) as rejected_total
from expenses
group by project_id;

-- One round trip for the project detail header (§7.2).
create or replace function project_overview(p_project_id uuid)
returns table (
  project_id      uuid,
  total_tasks     bigint,
  approved_tasks  bigint,
  progress_pct    numeric,
  overdue_tasks   bigint,
  seconds_logged  numeric,
  estimated_hours numeric,
  approved_spend  numeric,
  pending_spend   numeric,
  rejected_spend  numeric
)
language sql
stable
as $$
  select
    s.project_id, s.total_tasks, s.approved_tasks, s.progress_pct,
    s.overdue_tasks, s.seconds_logged, s.estimated_hours,
    coalesce(e.approved_total, 0),
    coalesce(e.pending_total, 0),
    coalesce(e.rejected_total, 0)
  from project_stats s
  left join project_expense_totals e on e.project_id = s.project_id
  where s.project_id = p_project_id;
$$;
