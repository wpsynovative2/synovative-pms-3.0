-- =============================================================================
-- OBC lines carry the brief, not the money.
-- Run after 0014_crm_modules.sql.
--
-- A quoted line is pulled from Zoho to tell the delivery team what was sold and
-- what it has to contain, so the two description fields Zoho keeps on each line
-- matter and the pricing does not. Rate and amount go; billing stays in Zoho,
-- which is the system of record for it.
-- =============================================================================

alter table obc_items
  drop column if exists rate,
  drop column if exists amount,
  -- Zoho's line-level "Description" — the short one.
  add column if not exists description       text not null default '',
  -- Zoho's line-level "Brief Description" — the long brief.
  add column if not exists brief_description text not null default '';
