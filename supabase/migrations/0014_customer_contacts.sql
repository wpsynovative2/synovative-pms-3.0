-- =============================================================================
-- 0014 — The people Accounts call: each customer's contact persons
--
-- A payment follow-up (0011) is a phone call to someone. Books keeps each
-- customer's contact persons; customer_contacts holds them for the PMS, one
-- list per Books customer, shared by every invoice of that customer:
--
--   name         Books' Last Name (where this organisation keeps the whole
--                name), else the First Name
--   designation  as in Books
--   phones       Work Phone and Mobile in one field, comma separated
--
-- Rows from Books (source 'zoho', keyed by Books' contact_person_id) are
-- written by the invoice import route on every fetch, sync and refetch, from
-- the customer record (scope ZohoBooks.contacts.READ) or, without it, from the
-- invoice's own contact list. Accounts add their own (source 'pms') — a new
-- accounts person at the client, a direct line — which no fetch touches.
-- Existing invoices are filled in here from what was already fetched (no
-- designation: the invoice does not carry it; a refetch adds it).
--
-- A logged call (invoice_calls) now names who was called and on which number:
-- contact_id and phone. `contact` keeps the name as it was, so the history
-- still reads right if the contact is later removed.
--
-- Who: can_view_invoices() reads, can_manage_invoices() writes (0009).
-- Mirrors CustomerContact and the contact actions in lib/store.tsx.
-- =============================================================================

alter table invoices add column zoho_customer_id text not null default '';
update invoices set zoho_customer_id = coalesce(details->>'customer_id', '');
create index invoices_zoho_customer_idx on invoices (zoho_customer_id);

create table customer_contacts (
  id                     uuid        not null default gen_random_uuid(),
  zoho_customer_id       text        not null,
  zoho_contact_person_id text,
  name                   text        not null,
  designation            text        not null default '',
  phones                 text        not null default '',
  is_primary             boolean     not null default false,
  source                 text        not null default 'pms',
  created_by             uuid        default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint customer_contacts_pkey primary key (id),
  constraint customer_contacts_person_key unique (zoho_customer_id, zoho_contact_person_id),
  constraint customer_contacts_created_by_fkey foreign key (created_by) references profiles (id) on delete set null,
  constraint customer_contacts_source_check check (source = any (array['zoho', 'pms'])),
  -- A Books row always carries Books' id; one added here never does.
  constraint customer_contacts_source_id check ((source = 'zoho') = (zoho_contact_person_id is not null)),
  constraint customer_contacts_name_check check (length(btrim(name)) between 1 and 160),
  constraint customer_contacts_designation_check check (length(designation) <= 160),
  constraint customer_contacts_phones_check check (length(phones) <= 200)
);
create index customer_contacts_customer_idx on customer_contacts (zoho_customer_id);

insert into customer_contacts (zoho_customer_id, zoho_contact_person_id, name, phones, is_primary, source, created_by, created_at)
select distinct on (i.zoho_customer_id, p->>'contact_person_id')
       i.zoho_customer_id,
       p->>'contact_person_id',
       coalesce(nullif(btrim(p->>'last_name'), ''), nullif(btrim(p->>'first_name'), ''), 'Contact'),
       coalesce(concat_ws(', ', nullif(btrim(p->>'phone'), ''), nullif(btrim(p->>'mobile'), '')), ''),
       coalesce((p->>'is_primary_contact')::boolean, false),
       'zoho',
       null,
       now()
  from invoices i
 cross join lateral jsonb_array_elements(
         case when jsonb_typeof(i.details->'contact_persons_details') = 'array'
              then i.details->'contact_persons_details' else '[]'::jsonb end
       ) p
 where i.zoho_customer_id <> ''
   and coalesce(p->>'contact_person_id', '') <> ''
 order by i.zoho_customer_id, p->>'contact_person_id', i.fetched_at desc
on conflict (zoho_customer_id, zoho_contact_person_id) do nothing;

alter table customer_contacts enable row level security;

create policy customer_contacts_read on customer_contacts for select to authenticated
  using ((select can_view_invoices()));
create policy customer_contacts_write on customer_contacts for all to authenticated
  using ((select can_manage_invoices()))
  with check ((select can_manage_invoices()));

revoke all on customer_contacts from anon;

alter table invoice_calls
  add column contact_id uuid,
  add column phone      text not null default '',
  add constraint invoice_calls_contact_fkey foreign key (contact_id) references customer_contacts (id) on delete set null,
  add constraint invoice_calls_phone_check check (length(phone) <= 40);

notify pgrst, 'reload schema';
