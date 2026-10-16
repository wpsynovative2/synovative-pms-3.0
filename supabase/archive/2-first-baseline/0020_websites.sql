-- Websites: the client sites Synovative builds and looks after, with their
-- logins and the annual renewal of their domain and hosting.
--
-- Replaces the "Website ID & Password" sheet. Three tables:
--   websites             one row per site, renewal due every year from its
--                        start date ("start date + 1 year")
--   website_credentials  its logins. Passwords cannot be read with a plain
--                        select - only through reveal_website_password(),
--                        which checks who is asking and logs it
--   website_renewals     each renewal recorded, by mark_website_renewed()
--
-- Who may do what (mirrored in lib/permissions.ts):
--   see websites and renewals   managers, Website Developers, Accounts &
--                               Finance, Business Development Executives
--   add / edit / delete sites   managers, Website Developers
--   logins and passwords        Super Admin, Admin, Website Developers
--   mark a renewal done         managers, Website Developers, Finance
--
-- Reminders: every morning, for active sites whose domain or hosting
-- Synovative pays for, 30, 15, 7 and 1 days before renewal, on the day, and
-- weekly once overdue - to Super Admins, Admins and everyone in Website
-- Developers, Accounts & Finance and Business Development Executives. The
-- client is reminded by email from the app, by whoever sends it.
--
-- Needs 0019 (the 'website_renewal' notification type) first.

-- ------------------------------------------------------------ who ----

create or replace function is_website_dev()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profile_departments
     where profile_id = auth.uid() and department = 'Website Developers'
  );
$$;

create or replace function can_view_websites()
returns boolean language sql stable security definer set search_path = public as $$
  select is_global_manager() or is_website_dev() or is_finance() or is_business_exec();
$$;

create or replace function can_manage_websites()
returns boolean language sql stable security definer set search_path = public as $$
  select is_global_manager() or is_website_dev();
$$;

create or replace function can_see_website_passwords()
returns boolean language sql stable security definer set search_path = public as $$
  select auth_role() in ('super_admin', 'admin') or is_website_dev();
$$;

create or replace function can_renew_websites()
returns boolean language sql stable security definer set search_path = public as $$
  select can_manage_websites() or is_finance();
$$;

-- ---------------------------------------------------------- tables ----

create table if not exists websites (
  id                 uuid          not null default uuid_generate_v4(),
  name               text          not null,
  url                text          not null default '',
  company_id         uuid          references companies(id) on delete set null,
  client_id          uuid          references clients(id) on delete set null,
  project_id         uuid          references projects(id) on delete set null,
  built_with         text          not null default 'WordPress',
  hosting_plan       text          not null default '',
  synovative_domain  boolean       not null default false,
  synovative_hosting boolean       not null default true,
  status             text          not null default 'Active',
  start_date         date,
  renewal_due        date,
  renewal_fee        numeric(12,2) not null default 0,
  client_email       text          not null default '',
  notes              text          not null default '',
  created_by         uuid          default auth.uid() references profiles(id) on delete set null,
  created_at         timestamptz   not null default now(),
  updated_at         timestamptz   not null default now(),
  constraint websites_pkey primary key (id),
  constraint websites_built_with_check
    check (built_with = any (array['WordPress', 'Plain code', 'Other'])),
  constraint websites_status_check check (status = any (array['Active', 'Off-boarded'])),
  constraint websites_renewal_fee_check check (renewal_fee >= 0)
);
create index if not exists websites_renewal_idx on websites (renewal_due) where status = 'Active';
create index if not exists websites_company_idx on websites (company_id);

comment on column websites.renewal_due is
  'Next annual renewal. Defaults to start_date + 1 year, rolled on to the next anniversary not yet past; mark_website_renewed() moves it on a year.';
comment on column websites.client_email is
  'Where the client renewal email goes when no client contact is linked, or to override theirs.';

create table if not exists website_credentials (
  id          uuid        not null default uuid_generate_v4(),
  website_id  uuid        not null references websites(id) on delete cascade,
  label       text        not null,
  login_url   text        not null default '',
  username    text        not null default '',
  password    text        not null default '',
  recovery    text        not null default '',
  notes       text        not null default '',
  position    integer     not null default 0,
  created_at  timestamptz not null default now(),
  constraint website_credentials_pkey primary key (id)
);
create index if not exists website_credentials_site_idx on website_credentials (website_id, position);

comment on column website_credentials.password is
  'Not selectable by app users (column privilege). Read through reveal_website_password(), which logs each read.';

create table if not exists website_renewals (
  id          uuid          not null default uuid_generate_v4(),
  website_id  uuid          not null references websites(id) on delete cascade,
  renewed_on  date          not null default ist_today(),
  period_from date          not null,
  period_to   date          not null,
  amount      numeric(12,2),
  note        text          not null default '',
  created_by  uuid          default auth.uid() references profiles(id) on delete set null,
  created_at  timestamptz   not null default now(),
  constraint website_renewals_pkey primary key (id)
);
create index if not exists website_renewals_site_idx on website_renewals (website_id, renewed_on desc);

create table if not exists website_password_reveals (
  id            uuid        not null default uuid_generate_v4(),
  credential_id uuid        not null references website_credentials(id) on delete cascade,
  profile_id    uuid        references profiles(id) on delete set null,
  revealed_at   timestamptz not null default now(),
  constraint website_password_reveals_pkey primary key (id)
);

-- ---------------------------------------------- the renewal date ----

-- First renewal: a year after the start, or the next anniversary still ahead
-- for a site that started years ago. Changing the start date moves it, unless
-- the same save also set the renewal date by hand.
create or replace function websites_default_renewal()
returns trigger language plpgsql set search_path = public as $$
declare
  v date;
begin
  if new.start_date is not null and (
       (tg_op = 'INSERT' and new.renewal_due is null)
    or (tg_op = 'UPDATE' and new.start_date is distinct from old.start_date
        and new.renewal_due is not distinct from old.renewal_due)
  ) then
    v := (new.start_date + interval '1 year')::date;
    while v < ist_today() loop
      v := (v + interval '1 year')::date;
    end loop;
    new.renewal_due := v;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists websites_renewal_default on websites;
create trigger websites_renewal_default
  before insert or update on websites
  for each row execute function websites_default_renewal();

-- ------------------------------------------------------------ RPCs ----

create or replace function reveal_website_password(p_credential_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_password text;
begin
  if not can_see_website_passwords() then
    raise exception 'Only a Super Admin, Admin or Website Developer can see passwords.'
      using errcode = '42501';
  end if;
  select password into v_password from website_credentials where id = p_credential_id;
  if not found then
    raise exception 'That login no longer exists.' using errcode = 'P0002';
  end if;
  insert into website_password_reveals (credential_id, profile_id)
  values (p_credential_id, auth.uid());
  return v_password;
end;
$$;

-- The renewal is done: record it and move the due date on a year.
create or replace function mark_website_renewed(
  p_website_id uuid,
  p_amount     numeric default null,
  p_note       text    default ''
)
returns date language plpgsql security definer set search_path = public as $$
declare
  w     websites%rowtype;
  v_from date;
  v_to   date;
begin
  if not can_renew_websites() then
    raise exception 'Only a manager, Website Developer or Accounts & Finance can mark a renewal.'
      using errcode = '42501';
  end if;
  select * into w from websites where id = p_website_id for update;
  if not found then
    raise exception 'That website no longer exists.' using errcode = 'P0002';
  end if;

  v_from := coalesce(w.renewal_due, (w.start_date + interval '1 year')::date, ist_today());
  v_to   := (v_from + interval '1 year')::date;

  insert into website_renewals (website_id, period_from, period_to, amount, note)
  values (p_website_id, v_from, v_to, p_amount, coalesce(p_note, ''));
  update websites set renewal_due = v_to where id = p_website_id;
  return v_to;
end;
$$;

-- ------------------------------------------------------- reminders ----

create or replace function notify_website_renewals()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  with due as (
    select w.*, w.renewal_due - ist_today() as days_left
      from websites w
     where w.status = 'Active'
       and w.renewal_due is not null
       -- Only what Synovative pays for; a client renewing their own needs no chasing.
       and (w.synovative_domain or w.synovative_hosting)
  ),
  picked as (
    select * from due
     where days_left in (30, 15, 7, 1, 0)
        or (days_left < 0 and days_left >= -180 and (-days_left) % 7 = 0)
  ),
  people as (
    select p.id from profiles p
     where p.active
       and (
         p.role in ('super_admin', 'admin')
         or exists (
           select 1 from profile_departments pd
            where pd.profile_id = p.id
              and pd.department in (
                'Website Developers', 'Accounts & Finance', 'Business Development Executives'
              )
         )
       )
  ),
  inserted as (
    insert into notifications (profile_id, type, title, body, href)
    select people.id,
           'website_renewal',
           case
             when s.days_left < 0 then 'Website renewal overdue'
             when s.days_left = 0 then 'Website renewal due today'
             when s.days_left = 1 then 'Website renewal tomorrow'
             else 'Website renewal in ' || s.days_left || ' days'
           end,
           s.name || coalesce(nullif(' (' || s.url || ')', ' ()'), '') ||
           case when s.days_left < 0 then ' was due on ' else ' renews on ' end ||
           to_char(s.renewal_due, 'FMDD Mon YYYY') || ' - ' ||
           case
             when s.synovative_domain and s.synovative_hosting then 'domain and hosting'
             when s.synovative_domain then 'domain'
             else 'hosting'
           end || '.',
           '/websites?site=' || s.id
      from picked s
     cross join people
     where not exists (
       select 1 from notifications n
        where n.profile_id = people.id
          and n.type = 'website_renewal'
          and n.href = '/websites?site=' || s.id
          and n.created_at >= current_date
     )
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end;
$$;

select cron.unschedule('website-renewals-0915-ist')
 where exists (select 1 from cron.job where jobname = 'website-renewals-0915-ist');
select cron.schedule(
  'website-renewals-0915-ist',
  '45 3 * * *',
  $job$ select notify_website_renewals(); $job$
);

-- ------------------------------------------------------------- RLS ----

alter table websites                 enable row level security;
alter table website_credentials      enable row level security;
alter table website_renewals         enable row level security;
alter table website_password_reveals enable row level security;

drop policy if exists websites_read on websites;
create policy websites_read on websites for select to authenticated
  using ((select can_view_websites()));
drop policy if exists websites_write on websites;
create policy websites_write on websites for all to authenticated
  using ((select can_manage_websites())) with check ((select can_manage_websites()));

drop policy if exists website_credentials_all on website_credentials;
create policy website_credentials_all on website_credentials for all to authenticated
  using ((select can_see_website_passwords()))
  with check ((select can_see_website_passwords()));

-- Renewals are written only by mark_website_renewed().
drop policy if exists website_renewals_read on website_renewals;
create policy website_renewals_read on website_renewals for select to authenticated
  using ((select can_view_websites()));

-- Who looked at which password: for the people who could look.
drop policy if exists website_password_reveals_read on website_password_reveals;
create policy website_password_reveals_read on website_password_reveals for select to authenticated
  using ((select auth_role() in ('super_admin', 'admin')));

-- The password column is never selectable by app users, even by those the
-- policy lets in; they read it through reveal_website_password().
revoke select on website_credentials from anon, authenticated;
grant select (id, website_id, label, login_url, username, recovery, notes, position, created_at)
  on website_credentials to authenticated;
grant insert, update, delete on website_credentials to authenticated;
revoke all on website_password_reveals from anon;
revoke insert, update, delete on website_renewals, website_password_reveals from anon, authenticated;

notify pgrst, 'reload schema';
