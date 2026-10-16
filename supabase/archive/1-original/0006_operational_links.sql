-- =============================================================================
-- Operational links — shared Google Drive (and other) links, kept in groups.
-- Run after 0005_app_support.sql.
--
-- Access: Super Admin, Admin and Manager create, edit and delete groups and
-- links; every active PMS member can read them.
-- =============================================================================

create table link_groups (
  id         uuid primary key default uuid_generate_v4(),
  name       text        not null check (length(btrim(name)) between 1 and 80),
  created_by uuid        references profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- "Brand Assets" and "brand assets" are the same group.
create unique index link_groups_name_unique on link_groups (lower(btrim(name)));

create table operational_links (
  id         uuid primary key default uuid_generate_v4(),
  group_id   uuid        not null references link_groups (id) on delete cascade,
  name       text        not null check (length(btrim(name)) between 1 and 120),
  url        text        not null check (url ~* '^https?://[^[:space:]]+$'),
  created_by uuid        references profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on operational_links (group_id);

create or replace function touch_operational_link()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger operational_links_touch
  before update on operational_links
  for each row execute function touch_operational_link();

-- ---------------------------------------------------------------- RLS ---

alter table link_groups       enable row level security;
alter table operational_links enable row level security;

create policy link_groups_read on link_groups
  for select to authenticated using (is_active_member());

create policy link_groups_write on link_groups
  for all to authenticated
  using (is_global_manager())
  with check (is_global_manager());

create policy operational_links_read on operational_links
  for select to authenticated using (is_active_member());

create policy operational_links_write on operational_links
  for all to authenticated
  using (is_global_manager())
  with check (is_global_manager());
