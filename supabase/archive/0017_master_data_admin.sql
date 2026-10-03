-- =============================================================================
-- Departments and services become editable by a Super Admin.
-- Run after 0016_obc_quote_name.sql.
--
-- Both tables were seeded in 0001 and read-only ever since, so the agency could
-- not take on a new service line without a migration. Adding one is now a
-- Super Admin job — and only theirs, because every project, task, profile and
-- vendor points at these names.
--
-- Deleting stays honest without any extra code: `department` and `service`
-- columns across projects, tasks, profiles, templates and vendors are real
-- foreign keys, so Postgres refuses to remove a name that is still in use.
-- Renaming is deliberately not offered — those foreign keys have no
-- ON UPDATE CASCADE, so a rename would fail anyway; add the new name and
-- retire the old one once nothing points at it.
-- =============================================================================

create policy departments_write on departments
  for all to authenticated
  using (is_super_admin())
  with check (is_super_admin());

create policy services_write on services
  for all to authenticated
  using (is_super_admin())
  with check (is_super_admin());
