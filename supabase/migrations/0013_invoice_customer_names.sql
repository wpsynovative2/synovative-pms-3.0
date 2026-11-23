-- =============================================================================
-- 0013 — An invoice's customer by all three of Books' names
--
-- Books names a customer three ways, and `customer_name` (0009) is only the
-- Display Name. Accounts chase by the other two:
--
--   customer_company  the customer's Company Name. Not on the invoice itself:
--                     it is read from the customer record (contacts API,
--                     scope ZohoBooks.contacts.READ) when the invoice is
--                     fetched, so existing rows fill in on their next refetch.
--   contact_person    the Primary Contact, first and last name. It is on the
--                     invoice (contact_persons_details), so existing rows are
--                     filled in here from what was already fetched.
--
-- Both are Books' columns, rewritten by the import route like the others.
-- Mirrors Invoice.customerCompany / contactPerson and invoiceColumns().
-- =============================================================================

alter table invoices
  add column customer_company text not null default '',
  add column contact_person   text not null default '';

update invoices i
   set contact_person = coalesce((
     select btrim(concat_ws(' ', nullif(btrim(p->>'first_name'), ''), nullif(btrim(p->>'last_name'), '')))
       from jsonb_array_elements(
              case when jsonb_typeof(i.details->'contact_persons_details') = 'array'
                   then i.details->'contact_persons_details' else '[]'::jsonb end
            ) p
      order by coalesce((p->>'is_primary_contact')::boolean, false) desc
      limit 1
   ), '');

notify pgrst, 'reload schema';
