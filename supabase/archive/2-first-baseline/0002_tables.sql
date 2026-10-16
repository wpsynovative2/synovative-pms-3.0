-- =============================================================================
-- Synovative PMS — baseline 2/8: tables
--
-- Every table with its columns, keys, checks and indexes. Foreign keys are
-- added at the end, once every table they point at exists - some point both
-- ways (projects <-> obcs).
-- =============================================================================

create table departments (
  name text not null,
  constraint departments_pkey primary key (name)
);

create table services (
  name text not null,
  constraint services_pkey primary key (name)
);

-- Mirrors auth.users. Created server-side when an admin adds a user (§6).
create table profiles (
  id                     uuid         not null,
  full_name              text         not null,
  email                  text         not null,
  role                   app_role     not null default 'team_member',
  active                 boolean      not null default true,
  must_change_password   boolean      not null default true,
  created_at             timestamptz  not null default now(),
  capacity_hours_per_day numeric(4,2) not null default 8,
  constraint profiles_pkey primary key (id),
  constraint profiles_email_key unique (email),
  constraint profiles_capacity_sane check (((capacity_hours_per_day > (0)::numeric) and (capacity_hours_per_day <= (24)::numeric)))
);

-- A Team Leader can lead several departments (§4.1).
create table profile_departments (
  profile_id uuid not null,
  department text not null,
  constraint profile_departments_pkey primary key (profile_id, department)
);
create index profile_departments_department_idx on profile_departments (department);

create table projects (
  id                uuid           not null default uuid_generate_v4(),
  name              text           not null,
  color             text           not null default '#5F3CA7',
  client_name       text           not null,
  start_date        date           not null,
  deadline          date           not null,
  description       text           not null default '',
  status            project_status not null default 'Planning',
  priority          priority_level not null default 'Medium',
  leader_id         uuid,
  created_by        uuid           default auth.uid(),
  created_at        timestamptz    not null default now(),
  recurrence        jsonb,
  recurrence_anchor date,
  recurrence_cursor date,
  series_source_id  uuid,
  series_index      integer,
  series_date       date,
  recurrence_paused boolean        not null default false,
  company_id        uuid,
  client_id         uuid,
  property_id       uuid,
  obc_id            uuid,
  constraint projects_pkey primary key (id),
  constraint project_dates_ordered check ((deadline >= start_date)),
  constraint project_recurrence_complete check (((recurrence is null) or ((recurrence_anchor is not null) and (recurrence_cursor is not null))))
);
create index projects_company_idx on projects (company_id);
create index projects_leader_id_idx on projects (leader_id);
create index projects_recurring on projects (recurrence_cursor) where (recurrence is not null);
create index projects_series_source_id_idx on projects (series_source_id);
create index projects_status_idx on projects (status);

create table project_services (
  project_id uuid not null,
  service    text not null,
  constraint project_services_pkey primary key (project_id, service)
);

create table project_members (
  project_id uuid not null,
  profile_id uuid not null,
  constraint project_members_pkey primary key (project_id, profile_id)
);
create index project_members_profile_id_idx on project_members (profile_id);

-- project_id null → individual task (§10).
create table tasks (
  id                uuid           not null default uuid_generate_v4(),
  project_id        uuid,
  title             text           not null,
  description       text           not null default '',
  department        text           not null,
  assignee_id       uuid,
  status            task_status    not null default 'Not Started',
  priority          priority_level not null default 'Medium',
  start_date        date           not null,
  due_date          date           not null,
  estimated_hours   numeric(6,2)   not null,
  tags              text[]         not null default '{}',
  created_by        uuid           default auth.uid(),
  created_at        timestamptz    not null default now(),
  recurrence        jsonb,
  recurrence_anchor date,
  recurrence_cursor date,
  series_source_id  uuid,
  series_index      integer,
  series_date       date,
  recurrence_paused boolean        not null default false,
  kind              text           not null default 'standard',
  content_count     integer        not null default 0,
  constraint tasks_pkey primary key (id),
  constraint task_dates_ordered check ((due_date >= start_date)),
  constraint task_recurrence_complete check (((recurrence is null) or ((recurrence_anchor is not null) and (recurrence_cursor is not null)))),
  constraint task_recurrence_individual_only check (((recurrence is null) or (project_id is null))),
  constraint tasks_content_count_check check ((content_count >= 0)),
  constraint tasks_estimated_hours_check check ((estimated_hours > (0)::numeric)),
  constraint tasks_kind_check check ((kind = any (array['standard'::text, 'content'::text])))
);
create index tasks_assignee_id_idx on tasks (assignee_id);
create index tasks_department_idx on tasks (department);
create index tasks_due_date_idx on tasks (due_date);
create index tasks_project_assignee_idx on tasks (project_id, assignee_id);
create index tasks_project_id_created_at_idx on tasks (project_id, created_at);
create index tasks_project_id_idx on tasks (project_id);
create index tasks_recurring on tasks (recurrence_cursor) where (recurrence is not null);
create index tasks_series_source_id_idx on tasks (series_source_id);
create index tasks_status_idx on tasks (status);
create index tasks_unassigned_idx on tasks (project_id) where (assignee_id is null);
comment on column tasks.kind is
  'standard = one piece of work; content = a batch of Content Bank pieces. Both are submitted and reviewed as a task.';
comment on column tasks.content_count is
  'Content tasks: how many pieces were asked for. A target, not a ceiling.';

-- §11.3.5 — only start/stop timestamps are stored; elapsed time is computed.
create table time_sessions (
  id         uuid               not null default uuid_generate_v4(),
  task_id    uuid               not null,
  profile_id uuid               not null,
  started_at timestamptz        not null default now(),
  ended_at   timestamptz,
  end_reason session_end_reason,
  end_note   text,
  constraint time_sessions_pkey primary key (id),
  constraint session_ends_after_start check (((ended_at is null) or (ended_at >= started_at)))
);
create index time_sessions_profile_id_idx on time_sessions (profile_id);
create index time_sessions_task_id_idx on time_sessions (task_id);
create unique index one_running_timer_per_user on time_sessions (profile_id) where (ended_at is null);

create table submissions (
  id              uuid            not null default uuid_generate_v4(),
  task_id         uuid            not null,
  by_profile_id   uuid            not null,
  submitted_at    timestamptz     not null default now(),
  output_location output_location not null,
  drive_link      text,
  description     text            not null default '',
  constraint submissions_pkey primary key (id),
  constraint drive_needs_link check (((output_location <> 'Google Drive'::output_location) or ((drive_link is not null) and (drive_link <> ''::text))))
);
create index submissions_task_id_idx on submissions (task_id);

create table reviews (
  id              uuid            not null default uuid_generate_v4(),
  task_id         uuid            not null,
  submission_id   uuid,
  by_profile_id   uuid            not null,
  reviewed_at     timestamptz     not null default now(),
  decision        review_decision not null,
  source          review_source,
  remarks         text            not null default '',
  new_assignee_id uuid,
  new_due_date    date,
  constraint reviews_pkey primary key (id),
  constraint rejection_needs_assignee check (((decision <> 'Rejected'::review_decision) or (new_assignee_id is not null))),
  constraint source_required_unless_approved check (((decision = any (array['Approved'::review_decision, 'Waiting for Client Response'::review_decision])) or (source is not null)))
);
create index reviews_task_id_idx on reviews (task_id);

create table remarks (
  id            uuid        not null default uuid_generate_v4(),
  task_id       uuid        not null,
  by_profile_id uuid        not null,
  created_at    timestamptz not null default now(),
  body          text        not null,
  constraint remarks_pkey primary key (id)
);
create index remarks_task_id_idx on remarks (task_id);

create table vendors (
  id             uuid          not null default uuid_generate_v4(),
  name           text          not null,
  service_type   text,
  contact_person text          not null default '',
  phone          text          not null default '',
  email          text          not null default '',
  rate           numeric(12,2) not null default 0,
  notes          text,
  constraint vendors_pkey primary key (id)
);

create table expenses (
  id              uuid           not null default uuid_generate_v4(),
  project_id      uuid           not null,
  vendor_id       uuid           not null,
  description     text           not null,
  amount          numeric(12,2)  not null,
  expense_date    date           not null,
  attachment_name text,
  attachment_url  text,
  status          expense_status not null default 'Pending',
  finance_remarks text,
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  created_by      uuid           default auth.uid(),
  created_at      timestamptz    not null default now(),
  constraint expenses_pkey primary key (id),
  constraint expenses_amount_check check ((amount > (0)::numeric)),
  constraint rejection_needs_remarks check (((status <> 'Rejected'::expense_status) or ((finance_remarks is not null) and (finance_remarks <> ''::text))))
);
create index expenses_expense_date_idx on expenses (expense_date);
create index expenses_project_id_idx on expenses (project_id);
create index expenses_status_idx on expenses (status);

create table project_templates (
  id            uuid           not null default uuid_generate_v4(),
  name          text           not null,
  description   text           not null default '',
  color         text           not null default '#5F3CA7',
  priority      priority_level not null default 'Medium',
  duration_days integer        not null default 30,
  created_at    timestamptz    not null default now(),
  constraint project_templates_pkey primary key (id)
);

create table project_template_services (
  template_id uuid not null,
  service     text not null,
  constraint project_template_services_pkey primary key (template_id, service)
);

create table project_template_tasks (
  id                uuid           not null default uuid_generate_v4(),
  template_id       uuid           not null,
  position          integer        not null,
  title             text           not null,
  description       text           not null default '',
  department        text           not null,
  priority          priority_level not null default 'Medium',
  estimated_hours   numeric(6,2)   not null default 4,
  tags              text[]         not null default '{}',
  start_offset_days integer        not null default 0,
  duration_days     integer        not null default 3,
  constraint project_template_tasks_pkey primary key (id)
);
create index project_template_tasks_template_id_position_idx on project_template_tasks (template_id, "position");

create table task_templates (
  id                uuid           not null default uuid_generate_v4(),
  title             text           not null,
  description       text           not null default '',
  department        text           not null,
  priority          priority_level not null default 'Medium',
  estimated_hours   numeric(6,2)   not null default 4,
  duration_days     integer        not null default 2,
  tags              text[]         not null default '{}',
  created_at        timestamptz    not null default now(),
  start_offset_days integer        not null default 0,
  constraint task_templates_pkey primary key (id)
);

create table holidays (
  holiday_date date not null,
  name         text not null,
  constraint holidays_pkey primary key (holiday_date)
);

-- §5.4.5 — HR can force a non-working day back to working.
create table working_overrides (
  override_date date        not null,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  constraint working_overrides_pkey primary key (override_date)
);

create table notifications (
  id         uuid              not null default uuid_generate_v4(),
  profile_id uuid              not null,
  type       notification_type not null,
  title      text              not null,
  body       text              not null default '',
  href       text              not null default '/',
  read       boolean           not null default false,
  created_at timestamptz       not null default now(),
  constraint notifications_pkey primary key (id)
);
create index notifications_profile_id_read_created_at_idx on notifications (profile_id, read, created_at desc);

create table link_groups (
  id         uuid        not null default uuid_generate_v4(),
  name       text        not null,
  created_by uuid        default auth.uid(),
  created_at timestamptz not null default now(),
  constraint link_groups_pkey primary key (id),
  constraint link_groups_name_check check (((length(btrim(name)) >= 1) and (length(btrim(name)) <= 80)))
);
create unique index link_groups_name_unique on link_groups (lower(btrim(name)));

create table operational_links (
  id         uuid        not null default uuid_generate_v4(),
  group_id   uuid        not null,
  name       text        not null,
  url        text        not null,
  created_by uuid        default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operational_links_pkey primary key (id),
  constraint operational_links_name_check check (((length(btrim(name)) >= 1) and (length(btrim(name)) <= 120))),
  constraint operational_links_url_check check ((url ~* '^https?://[^[:space:]]+$'::text))
);
create index operational_links_group_id_idx on operational_links (group_id);

create table companies (
  id               uuid         not null default uuid_generate_v4(),
  name             text         not null,
  legal_name       text         not null default '',
  gstin            text         not null default '',
  pan              text         not null default '',
  rera_promoter_id text         not null default '',
  address          text         not null default '',
  city             text         not null default '',
  website          text         not null default '',
  phone            text         not null default '',
  email            text         not null default '',
  logo_url         text         not null default '',
  account_owner_id uuid,
  status           party_status not null default 'active',
  created_by       uuid         default auth.uid(),
  created_at       timestamptz  not null default now(),
  updated_at       timestamptz  not null default now(),
  constraint companies_pkey primary key (id),
  constraint companies_name_check check (((length(btrim(name)) >= 1) and (length(btrim(name)) <= 160)))
);
create unique index companies_name_unique on companies (lower(btrim(name)));

create table clients (
  id          uuid         not null default uuid_generate_v4(),
  company_id  uuid         not null,
  full_name   text         not null,
  designation text         not null default '',
  mobile      text         not null default '',
  whatsapp    text         not null default '',
  email       text         not null default '',
  role        client_role,
  status      party_status not null default 'active',
  created_by  uuid         default auth.uid(),
  created_at  timestamptz  not null default now(),
  updated_at  timestamptz  not null default now(),
  constraint clients_pkey primary key (id),
  constraint clients_full_name_check check (((length(btrim(full_name)) >= 1) and (length(btrim(full_name)) <= 160)))
);
create index clients_company_idx on clients (company_id);

create table properties (
  id               uuid        not null default uuid_generate_v4(),
  company_id       uuid        not null,
  client_id        uuid,
  name             text        not null,
  description      text        not null default '',
  address          text        not null default '',
  maps_url         text        not null default '',
  maharera_number  text        not null default '',
  drive_folder_id  text        not null default '',
  drive_folder_url text        not null default '',
  created_by       uuid        default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint properties_pkey primary key (id),
  constraint properties_name_check check (((length(btrim(name)) >= 1) and (length(btrim(name)) <= 160)))
);
create index properties_client_idx on properties (client_id);
create index properties_company_idx on properties (company_id);

-- The unit mix, as line items: 1 BHK / 450 sq.ft / Rs 65 L / Open.
create table property_configs (
  id          uuid          not null default uuid_generate_v4(),
  property_id uuid          not null,
  position    integer       not null default 0,
  config      text          not null,
  sq_ft       numeric(10,2) not null default 0,
  price       numeric(14,2) not null default 0,
  status      config_status not null default 'Open',
  constraint property_configs_pkey primary key (id),
  constraint property_configs_config_check check (((length(btrim(config)) >= 1) and (length(btrim(config)) <= 80))),
  constraint property_configs_price_check check ((price >= (0)::numeric)),
  constraint property_configs_sq_ft_check check ((sq_ft >= (0)::numeric))
);
create index property_configs_property_idx on property_configs (property_id, "position");

-- One row per media folder created on Drive, so the app can link straight into
-- "Property Brochure" or "Drone Video" rather than just the parent.
create table property_drive_folders (
  id          uuid        not null default uuid_generate_v4(),
  property_id uuid        not null,
  name        text        not null,
  folder_id   text        not null,
  url         text        not null,
  created_at  timestamptz not null default now(),
  constraint property_drive_folders_pkey primary key (id),
  constraint property_drive_folders_property_id_name_key unique (property_id, name)
);

create table obcs (
  id                uuid        not null default uuid_generate_v4(),
  code              text        not null default ('OBC-'::text || lpad((nextval('obc_code_seq'::regclass))::text, 4, '0'::text)),
  company_id        uuid        not null,
  client_id         uuid,
  property_id       uuid,
  zoho_quote_id     text        not null default '',
  zoho_quote_number text        not null default '',
  notes             text        not null default '',
  status            obc_status  not null default 'Draft',
  submitted_at      timestamptz,
  converted_at      timestamptz,
  project_id        uuid,
  created_by        uuid        default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  zoho_quote_name   text        not null default '',
  constraint obcs_pkey primary key (id),
  constraint obcs_code_key unique (code)
);
create index obcs_company_idx on obcs (company_id);
create index obcs_status_idx on obcs (status);

-- The quoted services and their values, locked in when the OBC is submitted.
create table obc_items (
  id                uuid          not null default uuid_generate_v4(),
  obc_id            uuid          not null,
  position          integer       not null default 0,
  service           text          not null,
  quantity          numeric(10,2) not null default 1,
  description       text          not null default '',
  brief_description text          not null default '',
  constraint obc_items_pkey primary key (id),
  constraint obc_items_quantity_check check ((quantity >= (0)::numeric)),
  constraint obc_items_service_check check (((length(btrim(service)) >= 1) and (length(btrim(service)) <= 160)))
);
create index obc_items_obc_idx on obc_items (obc_id, "position");

-- One row is one piece of content: written by a Content Writer against a
-- project, and usually against the specific task they were given. A single
-- task can carry several entries, which is why the link points this way.
create table content_bank (
  id               uuid          not null default uuid_generate_v4(),
  project_id       uuid          not null,
  task_id          uuid,
  entry_date       date          not null default ist_today(),
  type             cb_type       not null,
  on_pic           text          not null default '',
  caption          text          not null default '',
  description      text          not null default '',
  reference_links  text[]        not null default '{}',
  billing_type     cb_billing    not null default 'Count',
  allotted_to      uuid,
  created_by       uuid          default auth.uid(),
  created_at       timestamptz   not null default now(),
  updated_at       timestamptz   not null default now(),
  stage            content_stage,
  allotted_task_id uuid,
  title            text          not null default '',
  slot             integer,
  constraint content_bank_pkey primary key (id),
  constraint content_bank_slot_check check (((slot is null) or (slot >= 1)))
);
create index content_bank_allotted_task_idx on content_bank (allotted_task_id);
create index content_bank_project_idx on content_bank (project_id, created_at desc);
create index content_bank_task_idx on content_bank (task_id);
create unique index content_bank_task_slot_unique on content_bank (task_id, slot) where (slot is not null);
comment on column content_bank.allotted_to is
  'The team member this piece is for. Any active member may be named: the person who builds the creative is often not on the project yet.';
comment on column content_bank.stage is
  'Where the piece has got to after writing: Ready To Design, Design Completed, Scheduled, Cancelled, Carry Forwarded. Null until the writer sets it.';
comment on column content_bank.allotted_task_id is
  'The allottee''s task this piece is for, on the same project. Set with allotted_to by allot_content().';
comment on column content_bank.title is
  'The piece''s name. Slots are named "<task> Count <n>"; the writer may rename them.';
comment on column content_bank.slot is
  'Which of the content task''s target pieces this is (1..content_count). Null for extras and library pieces.';

-- Quick internal thread. Plain text, so an @mention is just text we highlight.
create table comments (
  id          uuid          not null default uuid_generate_v4(),
  entity_type collab_entity not null,
  entity_id   uuid          not null,
  body        text          not null,
  created_by  uuid          default auth.uid(),
  created_at  timestamptz   not null default now(),
  constraint comments_pkey primary key (id),
  constraint comments_body_check check (((length(btrim(body)) >= 1) and (length(btrim(body)) <= 4000)))
);
create index comments_entity_idx on comments (entity_type, entity_id, created_at);

-- Formal minutes of a client meeting. Rich text, kept as a history log.
create table minutes (
  id           uuid          not null default uuid_generate_v4(),
  entity_type  collab_entity not null,
  entity_id    uuid          not null,
  title        text          not null,
  meeting_date date          not null default ist_today(),
  attendees    text          not null default '',
  body         text          not null default '',
  created_by   uuid          default auth.uid(),
  created_at   timestamptz   not null default now(),
  updated_at   timestamptz   not null default now(),
  constraint minutes_pkey primary key (id),
  constraint minutes_title_check check (((length(btrim(title)) >= 1) and (length(btrim(title)) <= 200)))
);
create index minutes_entity_idx on minutes (entity_type, entity_id, meeting_date desc);

create table obc_services (
  id          uuid          not null default uuid_generate_v4(),
  obc_id      uuid          not null,
  position    integer       not null default 0,
  service     text          not null,
  quantity    numeric(10,2) not null default 1,
  description text          not null default '',
  project_id  uuid,
  task_id     uuid,
  created_at  timestamptz   not null default now(),
  constraint obc_services_pkey primary key (id),
  constraint obc_services_one_allotment check (((project_id is null) or (task_id is null))),
  constraint obc_services_quantity_check check ((quantity >= (0)::numeric)),
  constraint obc_services_service_check check (((length(btrim(service)) >= 1) and (length(btrim(service)) <= 160)))
);
create index obc_services_obc_idx on obc_services (obc_id, "position");
create index obc_services_project_idx on obc_services (project_id);
create index obc_services_task_idx on obc_services (task_id);
comment on table obc_services is
  'What the agency will actually deliver for an OBC, written by hand. The estimate in obc_items is what the client bought; this is the list work is raised from.';

create table property_clients (
  property_id uuid    not null,
  client_id   uuid    not null,
  position    integer not null default 0,
  constraint property_clients_pkey primary key (property_id, client_id)
);
create index property_clients_client_idx on property_clients (client_id);

-- ---------------------------------------------------------- foreign keys ---

alter table profiles add constraint profiles_id_fkey
  foreign key (id) references auth.users(id) on delete cascade;
alter table profile_departments add constraint profile_departments_department_fkey
  foreign key (department) references departments(name);
alter table profile_departments add constraint profile_departments_profile_id_fkey
  foreign key (profile_id) references profiles(id) on delete cascade;
alter table projects add constraint projects_client_id_fkey
  foreign key (client_id) references clients(id) on delete set null;
alter table projects add constraint projects_company_id_fkey
  foreign key (company_id) references companies(id) on delete set null;
alter table projects add constraint projects_created_by_fkey
  foreign key (created_by) references profiles(id);
alter table projects add constraint projects_leader_id_fkey
  foreign key (leader_id) references profiles(id);
alter table projects add constraint projects_obc_id_fkey
  foreign key (obc_id) references obcs(id) on delete set null;
alter table projects add constraint projects_property_id_fkey
  foreign key (property_id) references properties(id) on delete set null;
alter table projects add constraint projects_series_source_id_fkey
  foreign key (series_source_id) references projects(id) on delete set null;
alter table project_services add constraint project_services_project_id_fkey
  foreign key (project_id) references projects(id) on delete cascade;
alter table project_services add constraint project_services_service_fkey
  foreign key (service) references services(name);
alter table project_members add constraint project_members_profile_id_fkey
  foreign key (profile_id) references profiles(id) on delete cascade;
alter table project_members add constraint project_members_project_id_fkey
  foreign key (project_id) references projects(id) on delete cascade;
alter table tasks add constraint tasks_assignee_id_fkey
  foreign key (assignee_id) references profiles(id);
alter table tasks add constraint tasks_created_by_fkey
  foreign key (created_by) references profiles(id);
alter table tasks add constraint tasks_department_fkey
  foreign key (department) references departments(name);
alter table tasks add constraint tasks_project_id_fkey
  foreign key (project_id) references projects(id) on delete cascade;
alter table tasks add constraint tasks_series_source_id_fkey
  foreign key (series_source_id) references tasks(id) on delete set null;
alter table time_sessions add constraint time_sessions_profile_id_fkey
  foreign key (profile_id) references profiles(id);
alter table time_sessions add constraint time_sessions_task_id_fkey
  foreign key (task_id) references tasks(id) on delete cascade;
alter table submissions add constraint submissions_by_profile_id_fkey
  foreign key (by_profile_id) references profiles(id);
alter table submissions add constraint submissions_task_id_fkey
  foreign key (task_id) references tasks(id) on delete cascade;
alter table reviews add constraint reviews_by_profile_id_fkey
  foreign key (by_profile_id) references profiles(id);
alter table reviews add constraint reviews_new_assignee_id_fkey
  foreign key (new_assignee_id) references profiles(id);
alter table reviews add constraint reviews_submission_id_fkey
  foreign key (submission_id) references submissions(id) on delete set null;
alter table reviews add constraint reviews_task_id_fkey
  foreign key (task_id) references tasks(id) on delete cascade;
alter table remarks add constraint remarks_by_profile_id_fkey
  foreign key (by_profile_id) references profiles(id);
alter table remarks add constraint remarks_task_id_fkey
  foreign key (task_id) references tasks(id) on delete cascade;
alter table vendors add constraint vendors_service_type_fkey
  foreign key (service_type) references services(name);
alter table expenses add constraint expenses_created_by_fkey
  foreign key (created_by) references profiles(id);
alter table expenses add constraint expenses_project_id_fkey
  foreign key (project_id) references projects(id) on delete cascade;
alter table expenses add constraint expenses_reviewed_by_fkey
  foreign key (reviewed_by) references profiles(id);
alter table expenses add constraint expenses_vendor_id_fkey
  foreign key (vendor_id) references vendors(id);
alter table project_template_services add constraint project_template_services_service_fkey
  foreign key (service) references services(name);
alter table project_template_services add constraint project_template_services_template_id_fkey
  foreign key (template_id) references project_templates(id) on delete cascade;
alter table project_template_tasks add constraint project_template_tasks_department_fkey
  foreign key (department) references departments(name);
alter table project_template_tasks add constraint project_template_tasks_template_id_fkey
  foreign key (template_id) references project_templates(id) on delete cascade;
alter table task_templates add constraint task_templates_department_fkey
  foreign key (department) references departments(name);
alter table working_overrides add constraint working_overrides_created_by_fkey
  foreign key (created_by) references profiles(id);
alter table notifications add constraint notifications_profile_id_fkey
  foreign key (profile_id) references profiles(id) on delete cascade;
alter table link_groups add constraint link_groups_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;
alter table operational_links add constraint operational_links_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;
alter table operational_links add constraint operational_links_group_id_fkey
  foreign key (group_id) references link_groups(id) on delete cascade;
alter table companies add constraint companies_account_owner_id_fkey
  foreign key (account_owner_id) references profiles(id) on delete set null;
alter table companies add constraint companies_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;
alter table clients add constraint clients_company_id_fkey
  foreign key (company_id) references companies(id) on delete cascade;
alter table clients add constraint clients_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;
alter table properties add constraint properties_client_id_fkey
  foreign key (client_id) references clients(id) on delete set null;
alter table properties add constraint properties_company_id_fkey
  foreign key (company_id) references companies(id) on delete cascade;
alter table properties add constraint properties_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;
alter table property_configs add constraint property_configs_property_id_fkey
  foreign key (property_id) references properties(id) on delete cascade;
alter table property_drive_folders add constraint property_drive_folders_property_id_fkey
  foreign key (property_id) references properties(id) on delete cascade;
alter table obcs add constraint obcs_client_id_fkey
  foreign key (client_id) references clients(id) on delete set null;
alter table obcs add constraint obcs_company_id_fkey
  foreign key (company_id) references companies(id) on delete restrict;
alter table obcs add constraint obcs_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;
alter table obcs add constraint obcs_project_id_fkey
  foreign key (project_id) references projects(id) on delete set null;
alter table obcs add constraint obcs_property_id_fkey
  foreign key (property_id) references properties(id) on delete set null;
alter table obc_items add constraint obc_items_obc_id_fkey
  foreign key (obc_id) references obcs(id) on delete cascade;
alter table content_bank add constraint content_bank_allotted_task_id_fkey
  foreign key (allotted_task_id) references tasks(id) on delete set null;
alter table content_bank add constraint content_bank_allotted_to_fkey
  foreign key (allotted_to) references profiles(id) on delete set null;
alter table content_bank add constraint content_bank_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;
alter table content_bank add constraint content_bank_project_id_fkey
  foreign key (project_id) references projects(id) on delete cascade;
alter table content_bank add constraint content_bank_task_id_fkey
  foreign key (task_id) references tasks(id) on delete set null;
alter table comments add constraint comments_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;
alter table minutes add constraint minutes_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;
alter table obc_services add constraint obc_services_obc_id_fkey
  foreign key (obc_id) references obcs(id) on delete cascade;
alter table obc_services add constraint obc_services_project_id_fkey
  foreign key (project_id) references projects(id) on delete set null;
alter table obc_services add constraint obc_services_task_id_fkey
  foreign key (task_id) references tasks(id) on delete set null;
alter table property_clients add constraint property_clients_client_id_fkey
  foreign key (client_id) references clients(id) on delete cascade;
alter table property_clients add constraint property_clients_property_id_fkey
  foreign key (property_id) references properties(id) on delete cascade;
