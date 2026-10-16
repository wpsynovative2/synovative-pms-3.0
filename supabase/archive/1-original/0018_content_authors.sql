-- =============================================================================
-- Social Media Marketing joins the Content Bank's authors.
-- Run after 0017_master_data_admin.sql.
--
-- Writing was the Content Writers' alone (0014). In practice the copy and the
-- post that carries it are drafted by the same two desks, so Social Media
-- Marketing writes here too. It stays a *department* right, like Finance's
-- expense verdicts: no role grants it and no role overrides it.
--
-- Also relaxes allotment. `content_bank.allotted_to` was documented as
-- "must be someone on the project" but never constrained, and the form is the
-- only thing that enforced it. A piece is routinely handed to a designer or
-- an editor who has no task on that project yet, so the form now offers
-- everyone; the column keeps its plain foreign key to profiles.
-- =============================================================================

-- The other author desk. Kept as its own predicate so the two rights stay
-- separately readable, the way is_finance() and is_business_exec() are.
create or replace function is_smm()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profile_departments
    where profile_id = auth.uid()
      and department = 'Social Media Marketing'
  );
$$;

-- Who may put words in the Content Bank.
create or replace function can_write_content()
returns boolean language sql stable security definer set search_path = public as $$
  select is_content_writer() or is_smm();
$$;

-- Reading still follows the project - it never depended on the department -
-- with one addition the looser allotment makes necessary: the person a piece is
-- put in the name of can read it even when they hold no task on that project.
-- Without this they would get the 'content_allotted' notification and land on
-- an empty page.
drop policy if exists content_bank_read on content_bank;
create policy content_bank_read on content_bank
  for select to authenticated
  using (can_see_project(project_id) or allotted_to = auth.uid());

-- Re-point the three write policies at the new predicate.
drop policy if exists content_bank_insert on content_bank;
create policy content_bank_insert on content_bank
  for insert to authenticated
  with check (can_write_content() and can_see_project(project_id));

-- An author edits their own entries; nobody else rewrites someone's copy.
drop policy if exists content_bank_update on content_bank;
create policy content_bank_update on content_bank
  for update to authenticated
  using (can_write_content() and created_by = auth.uid())
  with check (can_write_content() and created_by = auth.uid());

drop policy if exists content_bank_delete on content_bank;
create policy content_bank_delete on content_bank
  for delete to authenticated
  using ((can_write_content() and created_by = auth.uid()) or can_delete_crm());

comment on column content_bank.allotted_to is 'The team member this piece is for. Any active member may be named: the person who builds the creative is often not on the project yet.';
