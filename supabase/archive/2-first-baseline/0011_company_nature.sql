-- =============================================================================
-- Nature of company. Run after 0010_rls_performance.sql.
--
-- Not every company on the books is a developer: the agency also works with
-- mandate companies and channel partners. The value is one of the app's
-- choices (lib/types.ts COMPANY_NATURES) or, under "Others", whatever was typed;
-- empty means nobody has said yet. Kept as text rather than an enum so the
-- typed answers fit, and so a new choice is an app change, not a migration.
-- =============================================================================

alter table companies
  add column if not exists nature text not null default '';

comment on column companies.nature is
  'Real Estate Developer, Mandate Company, Channel Partner, or a typed name under Others. Empty when not set.';

notify pgrst, 'reload schema';
