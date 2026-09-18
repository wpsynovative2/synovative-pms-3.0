-- =============================================================================
-- CRM modules — Companies, Clients, Real Estate Properties, New OBCs and the
-- Content Bank, plus the Comments and Minutes of Meeting records that hang off
-- them. Run after 0013_crm_enums.sql.
--
-- The chain is Company -> Client -> Property -> OBC -> Project. Each link is
-- kept as a real foreign key so a project can always be traced back to the
-- company that paid for it, and so a property carries both its company and its
-- client (the deck's "Acc:" line).
--
-- Who may do what, from the workflow deck:
--   * Companies, Clients, Properties, OBCs  - created and edited by Super
--     Admin, Admin, Manager and anyone in Business Development Executives.
--   * Converting an OBC into a project      - Super Admin, Admin, Manager only.
--   * Deleting any of those records         - Super Admin and Admin only.
--   * Writing the Content Bank              - Content Writers only.
--   * Reading the Content Bank              - anyone who can see the project.
-- =============================================================================

-- ----------------------------------------------------------------- enums ---

create type party_status  as enum ('active', 'inactive');
create type client_role   as enum ('Decision Maker', 'Influencer', 'Coordinator');
create type config_status as enum ('Open', 'Sold out');
create type obc_status    as enum ('Draft', 'Submitted', 'Converted');
create type cb_billing    as enum ('Count', 'Extra');

create type cb_type as enum (
  'Static Design', 'Reel Editing', 'Influencer Script', 'Drone Script',
  'OOH', 'Site Branding', 'Website Content', 'Brochure Content'
);

-- Everything a comment or a set of minutes can be filed against.
create type collab_entity as enum (
  'company', 'client', 'property', 'obc', 'project', 'task'
);

-- ------------------------------------------------------------- helpers ----

-- Like is_finance(): the right comes from the department, not the role.
create or replace function is_business_exec()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profile_departments
    where profile_id = auth.uid()
      and department = 'Business Development Executives'
  );
$$;

create or replace function is_content_writer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profile_departments
    where profile_id = auth.uid()
      and department = 'Content Writers / Copywriters / Brand Strategists'
  );
$$;

-- Add and edit the master records that feed a project.
create or replace function can_manage_crm()
returns boolean language sql stable security definer set search_path = public as $$
  select is_global_manager() or is_business_exec();
$$;

-- Deleting is deliberately narrower than editing: these records are referenced
-- by projects that may already be running.
create or replace function can_delete_crm()
returns boolean language sql stable security definer set search_path = public as $$
  select auth_role() in ('super_admin', 'admin');
$$;

-- --------------------------------------------------------------- module 1 --

create table companies (
  id               uuid primary key default uuid_generate_v4(),
  name             text not null check (length(btrim(name)) between 1 and 160),
  legal_name       text not null default '',
  gstin            text not null default '',
  pan              text not null default '',
  rera_promoter_id text not null default '',
  address          text not null default '',
  city             text not null default '',
  website          text not null default '',
  phone            text not null default '',
  email            text not null default '',
  logo_url         text not null default '',
  -- Who owns the relationship on our side.
  account_owner_id uuid references profiles (id) on delete set null,
  status           party_status not null default 'active',
  created_by       uuid references profiles (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- "Lodha Group" and "lodha group" are the same developer.
create unique index companies_name_unique on companies (lower(btrim(name)));

-- --------------------------------------------------------------- module 2 --

create table clients (
  id          uuid primary key default uuid_generate_v4(),
  company_id  uuid not null references companies (id) on delete cascade,
  full_name   text not null check (length(btrim(full_name)) between 1 and 160),
  designation text not null default '',
  mobile      text not null default '',
  whatsapp    text not null default '',
  email       text not null default '',
  role        client_role,
  status      party_status not null default 'active',
  created_by  uuid references profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index clients_company_idx on clients (company_id);

-- --------------------------------------------------------------- module 3 --

create table properties (
  id               uuid primary key default uuid_generate_v4(),
  company_id       uuid not null references companies (id) on delete cascade,
  -- A property can exist before anyone is named as its contact.
  client_id        uuid references clients (id) on delete set null,
  name             text not null check (length(btrim(name)) between 1 and 160),
  description      text not null default '',
  address          text not null default '',
  maps_url         text not null default '',
  maharera_number  text not null default '',
  -- Set once "Create Directory" has run; re-clicking then does nothing, so the
  -- folder tree is never duplicated.
  drive_folder_id  text not null default '',
  drive_folder_url text not null default '',
  created_by       uuid references profiles (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index properties_company_idx on properties (company_id);
create index properties_client_idx  on properties (client_id);

-- The unit mix, as line items: 1 BHK / 450 sq.ft / Rs 65 L / Open.
create table property_configs (
  id          uuid primary key default uuid_generate_v4(),
  property_id uuid not null references properties (id) on delete cascade,
  position    integer not null default 0,
  config      text not null check (length(btrim(config)) between 1 and 80),
  sq_ft       numeric(10, 2) not null default 0 check (sq_ft >= 0),
  price       numeric(14, 2) not null default 0 check (price >= 0),
  status      config_status not null default 'Open'
);

create index property_configs_property_idx on property_configs (property_id, position);

-- One row per media folder created on Drive, so the app can link straight into
-- "Property Brochure" or "Drone Video" rather than just the parent.
create table property_drive_folders (
  id          uuid primary key default uuid_generate_v4(),
  property_id uuid not null references properties (id) on delete cascade,
  name        text not null,
  folder_id   text not null,
  url         text not null,
  created_at  timestamptz not null default now(),
  unique (property_id, name)
);

-- --------------------------------------------------------------- module 4 --

create sequence obc_code_seq;

create table obcs (
  id                 uuid primary key default uuid_generate_v4(),
  -- Human-readable handle for the sales team: OBC-0001.
  code               text not null unique
                       default ('OBC-' || lpad(nextval('obc_code_seq')::text, 4, '0')),
  company_id         uuid not null references companies (id) on delete restrict,
  client_id          uuid references clients (id) on delete set null,
  property_id        uuid references properties (id) on delete set null,
  -- What was pulled from Zoho, kept for traceability rather than re-typing.
  zoho_quote_id      text not null default '',
  zoho_quote_number  text not null default '',
  notes              text not null default '',
  status             obc_status not null default 'Draft',
  submitted_at       timestamptz,
  converted_at       timestamptz,
  -- Filled in when a manager turns this OBC into real work.
  project_id         uuid references projects (id) on delete set null,
  created_by         uuid references profiles (id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index obcs_company_idx on obcs (company_id);
create index obcs_status_idx  on obcs (status);

-- The quoted services and their values, locked in when the OBC is submitted.
create table obc_items (
  id       uuid primary key default uuid_generate_v4(),
  obc_id   uuid not null references obcs (id) on delete cascade,
  position integer not null default 0,
  service  text not null check (length(btrim(service)) between 1 and 160),
  quantity numeric(10, 2) not null default 1 check (quantity >= 0),
  rate     numeric(14, 2) not null default 0 check (rate >= 0),
  amount   numeric(14, 2) not null default 0 check (amount >= 0)
);

create index obc_items_obc_idx on obc_items (obc_id, position);

-- Projects carry the chain they came from. All nullable: projects raised by
-- hand, and every project that already exists, have no OBC behind them.
alter table projects
  add column if not exists company_id  uuid references companies (id)  on delete set null,
  add column if not exists client_id   uuid references clients (id)    on delete set null,
  add column if not exists property_id uuid references properties (id) on delete set null,
  add column if not exists obc_id      uuid references obcs (id)       on delete set null;

create index if not exists projects_company_idx on projects (company_id);

-- Only Super Admin, Admin and Manager convert an OBC, even though a Business
-- Executive may edit everything else about it.
create or replace function guard_obc_conversion()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status = 'Converted' and old.status is distinct from 'Converted' then
    if auth.uid() is not null and not is_global_manager() then
      raise exception 'Only a Super Admin, Admin or Manager can turn an OBC into a project.'
        using errcode = '42501';
    end if;
    new.converted_at := coalesce(new.converted_at, now());
  end if;
  if tg_op = 'UPDATE' and new.status = 'Submitted' and old.status is distinct from 'Submitted' then
    new.submitted_at := coalesce(new.submitted_at, now());
  end if;
  return new;
end;
$$;

create trigger obcs_guard_conversion
  before update on obcs
  for each row execute function guard_obc_conversion();

-- --------------------------------------------------------------- module 5 --

-- One row is one piece of content: written by a Content Writer against a
-- project, and usually against the specific task they were given. A single
-- task can carry several entries, which is why the link points this way.
create table content_bank (
  id              uuid primary key default uuid_generate_v4(),
  project_id      uuid not null references projects (id) on delete cascade,
  task_id         uuid references tasks (id) on delete set null,
  entry_date      date not null default (ist_today()),
  type            cb_type not null,
  -- Rich text: what appears on the creative itself.
  on_pic          text not null default '',
  caption         text not null default '',
  -- Rich text: the brief / body copy.
  description     text not null default '',
  reference_links text[] not null default '{}',
  billing_type    cb_billing not null default 'Count',
  -- The team member this piece is for; must be someone on the project.
  allotted_to     uuid references profiles (id) on delete set null,
  created_by      uuid references profiles (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index content_bank_project_idx on content_bank (project_id, created_at desc);
create index content_bank_task_idx    on content_bank (task_id);

-- ------------------------------------------------- comments & minutes ------

-- Can this user see the record a comment or a set of minutes hangs off? The
-- master records are readable by every active member; projects and tasks keep
-- the visibility rules they already have.
create or replace function can_see_entity(p_type collab_entity, p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_type
    when 'project' then can_see_project(p_id)
    when 'task'    then can_see_task(p_id)
    else is_active_member()
  end;
$$;

-- Quick internal thread. Plain text, so an @mention is just text we highlight.
create table comments (
  id          uuid primary key default uuid_generate_v4(),
  entity_type collab_entity not null,
  entity_id   uuid not null,
  body        text not null check (length(btrim(body)) between 1 and 4000),
  created_by  uuid references profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

create index comments_entity_idx on comments (entity_type, entity_id, created_at);

-- Formal minutes of a client meeting. Rich text, kept as a history log.
create table minutes (
  id           uuid primary key default uuid_generate_v4(),
  entity_type  collab_entity not null,
  entity_id    uuid not null,
  title        text not null check (length(btrim(title)) between 1 and 200),
  meeting_date date not null default (ist_today()),
  attendees    text not null default '',
  body         text not null default '',
  created_by   uuid references profiles (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index minutes_entity_idx on minutes (entity_type, entity_id, meeting_date desc);

-- ------------------------------------------------------------- touch -------

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger companies_touch    before update on companies    for each row execute function touch_updated_at();
create trigger clients_touch      before update on clients      for each row execute function touch_updated_at();
create trigger properties_touch   before update on properties   for each row execute function touch_updated_at();
create trigger obcs_touch         before update on obcs         for each row execute function touch_updated_at();
create trigger content_bank_touch before update on content_bank for each row execute function touch_updated_at();
create trigger minutes_touch      before update on minutes      for each row execute function touch_updated_at();

-- -------------------------------------------------------- notifications ----

-- Tell someone a piece of content has been put in their name. Nothing is sent
-- for content a writer allots to themselves.
create or replace function notify_content_allotment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_project text;
begin
  if auth.uid() is null or new.allotted_to is null or new.allotted_to = auth.uid() then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.allotted_to is not distinct from old.allotted_to then
    return new;
  end if;

  select name into v_project from projects where id = new.project_id;

  perform notify(
    array[new.allotted_to],
    'content_allotted',
    'Content allotted to you',
    new.type::text || ' for ' || coalesce(v_project, 'a project'),
    '/content-bank?entry=' || new.id
  );
  return new;
end;
$$;

create trigger content_bank_notify_allotment
  after insert or update on content_bank
  for each row execute function notify_content_allotment();

-- ---------------------------------------------------------------- RLS ------

alter table companies              enable row level security;
alter table clients                enable row level security;
alter table properties             enable row level security;
alter table property_configs       enable row level security;
alter table property_drive_folders enable row level security;
alter table obcs                   enable row level security;
alter table obc_items              enable row level security;
alter table content_bank           enable row level security;
alter table comments               enable row level security;
alter table minutes                enable row level security;

-- Master records: everyone reads (assignee pickers, project pages and the OBC
-- form all need the directory), managers and BDEs write, admins delete.

create policy companies_read   on companies for select to authenticated using (is_active_member());
create policy companies_insert on companies for insert to authenticated with check (can_manage_crm());
create policy companies_update on companies for update to authenticated using (can_manage_crm()) with check (can_manage_crm());
create policy companies_delete on companies for delete to authenticated using (can_delete_crm());

create policy clients_read   on clients for select to authenticated using (is_active_member());
create policy clients_insert on clients for insert to authenticated with check (can_manage_crm());
create policy clients_update on clients for update to authenticated using (can_manage_crm()) with check (can_manage_crm());
create policy clients_delete on clients for delete to authenticated using (can_delete_crm());

create policy properties_read   on properties for select to authenticated using (is_active_member());
create policy properties_insert on properties for insert to authenticated with check (can_manage_crm());
create policy properties_update on properties for update to authenticated using (can_manage_crm()) with check (can_manage_crm());
create policy properties_delete on properties for delete to authenticated using (can_delete_crm());

create policy property_configs_read  on property_configs for select to authenticated using (is_active_member());
create policy property_configs_write on property_configs for all to authenticated
  using (can_manage_crm()) with check (can_manage_crm());

create policy property_drive_folders_read on property_drive_folders
  for select to authenticated using (is_active_member());
create policy property_drive_folders_write on property_drive_folders for all to authenticated
  using (can_manage_crm()) with check (can_manage_crm());

create policy obcs_read   on obcs for select to authenticated using (is_active_member());
create policy obcs_insert on obcs for insert to authenticated with check (can_manage_crm());
create policy obcs_update on obcs for update to authenticated using (can_manage_crm()) with check (can_manage_crm());
create policy obcs_delete on obcs for delete to authenticated using (can_delete_crm());

create policy obc_items_read  on obc_items for select to authenticated using (is_active_member());
create policy obc_items_write on obc_items for all to authenticated
  using (can_manage_crm()) with check (can_manage_crm());

-- Content Bank: read follows the project, writing is the Content Writers' own.
create policy content_bank_read on content_bank
  for select to authenticated using (can_see_project(project_id));

create policy content_bank_insert on content_bank
  for insert to authenticated
  with check (is_content_writer() and can_see_project(project_id));

-- A writer edits their own entries; nobody else rewrites someone's copy.
create policy content_bank_update on content_bank
  for update to authenticated
  using (is_content_writer() and created_by = auth.uid())
  with check (is_content_writer() and created_by = auth.uid());

create policy content_bank_delete on content_bank
  for delete to authenticated
  using ((is_content_writer() and created_by = auth.uid()) or can_delete_crm());

-- Comments and minutes: anyone who can open the record can read and add to the
-- log; only the author edits their own entry, and admins can always clear one.
create policy comments_read on comments
  for select to authenticated using (can_see_entity(entity_type, entity_id));

create policy comments_insert on comments
  for insert to authenticated
  with check (can_see_entity(entity_type, entity_id) and created_by = auth.uid());

create policy comments_update on comments
  for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());

create policy comments_delete on comments
  for delete to authenticated using (created_by = auth.uid() or can_delete_crm());

create policy minutes_read on minutes
  for select to authenticated using (can_see_entity(entity_type, entity_id));

create policy minutes_insert on minutes
  for insert to authenticated
  with check (can_see_entity(entity_type, entity_id) and created_by = auth.uid());

create policy minutes_update on minutes
  for update to authenticated
  using (created_by = auth.uid() or is_global_manager())
  with check (created_by = auth.uid() or is_global_manager());

create policy minutes_delete on minutes
  for delete to authenticated using (created_by = auth.uid() or can_delete_crm());
