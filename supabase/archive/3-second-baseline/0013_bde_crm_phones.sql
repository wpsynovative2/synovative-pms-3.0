-- Business Development Executives see CRM phone numbers too: a company's phone
-- and its clients' mobile / WhatsApp, as Super Admin, Admin and Managers do
-- (0009). They are the ones who call these people.
--
-- Only who crm_phone_numbers() answers changes; the columns stay unreadable
-- through plain selects. Like is_finance(), the right comes from the
-- department, not the role.
-- Mirrors canSeeCrmPhones in lib/permissions.ts.

create or replace function crm_phone_numbers()
returns table (kind text, id uuid, phone text, whatsapp text)
language sql stable security definer set search_path = public as $$
  select 'company', c.id, c.phone, ''::text
    from companies c
   where (is_global_manager() or is_business_exec()) and c.phone <> ''
  union all
  select 'client', k.id, k.mobile, k.whatsapp
    from clients k
   where (is_global_manager() or is_business_exec()) and (k.mobile <> '' or k.whatsapp <> '');
$$;

revoke all on function crm_phone_numbers() from public;
grant execute on function crm_phone_numbers() to authenticated;

notify pgrst, 'reload schema';
