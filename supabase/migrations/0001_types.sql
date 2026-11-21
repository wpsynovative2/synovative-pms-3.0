-- =============================================================================
-- Synovative PMS — baseline 1/8: extensions, enums, sequences
--
-- The consolidated schema for a fresh Supabase project. Run the files in this
-- folder in order, 0001 to 0008, in the SQL editor. Together they build exactly
-- what the full chain of earlier migrations built (kept in supabase/archive/
-- for databases created from it). New changes go in the next numbered file here.
-- =============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists pg_cron;

-- ----------------------------------------------------------------- enums ---

create type app_role as enum (
  'super_admin',
  'admin',
  'manager',
  'hr_admin',
  'team_leader',
  'team_member'
);

create type project_status as enum (
  'Planning',
  'Active',
  'On Hold',
  'Completed',
  'Cancelled',
  'Archived'
);

create type priority_level as enum ('Low', 'Medium', 'High', 'Critical');

create type task_status as enum (
  'Not Started',
  'In Progress',
  'Submitted',
  'Changes Required',
  'Rejected',
  'Approved',
  'Waiting for Client Response'
);

create type session_end_reason as enum (
  'End of day',
  'Switched',
  'Submitted',
  'Auto-stopped'
);

create type output_location as enum (
  'Google Drive',
  'WhatsApp',
  'Content Bank'
);

create type review_decision as enum (
  'Approved',
  'Changes Required',
  'Rejected',
  'Waiting for Client Response'
);

create type review_source as enum ('Client', 'Project Leader');

create type expense_status as enum ('Pending', 'Approved', 'Rejected');

create type notification_type as enum (
  'task_assigned',
  'task_submitted',
  'review_decision',
  'remark_added',
  'expense_added',
  'expense_reviewed',
  'due_soon',
  'overdue',
  'timer_autostop',
  'content_allotted',
  'website_renewal',
  'inventory_assigned'
);

create type party_status as enum ('active', 'inactive');

create type client_role as enum ('Decision Maker', 'Influencer', 'Coordinator');

create type config_status as enum ('Open', 'Sold out');

create type obc_status as enum ('Draft', 'Submitted', 'Converted');

create type cb_billing as enum ('Count', 'Extra');

create type cb_type as enum (
  'Static Design',
  'Reel Editing',
  'Influencer Script',
  'Drone Script',
  'OOH',
  'Site Branding',
  'Website Content',
  'Brochure Content',
  'Static to Motion',
  'Festival STM',
  'Festival Static'
);

-- Everything a comment or a set of minutes can be filed against.
create type collab_entity as enum (
  'company',
  'client',
  'property',
  'obc',
  'project',
  'task'
);

create type content_stage as enum (
  'Ready To Design',
  'Design Completed',
  'Scheduled',
  'Cancelled',
  'Carry Forwarded'
);

create type content_placement as enum ('SMM', 'WhatsApp Share');

-- ------------------------------------------------------------- sequences ---

create sequence obc_code_seq;
create sequence workstation_code_seq;

-- ------------------------------------ needed by tables (defaults, checks) ---

set check_function_bodies = off;

create or replace function ist_today()
 returns date
 language sql
 stable
as $function$
  select (now() at time zone 'Asia/Kolkata')::date;
$function$;

-- The asset ID prefix of each category; null for anything not on the list.
create or replace function inventory_category_prefix(p_category text)
 returns text
 language sql
 immutable
as $function$
  select case p_category
    when 'Processor'    then 'CPU'
    when 'Motherboard'  then 'MBD'
    when 'RAM'          then 'RAM'
    when 'Storage'      then 'STO'
    when 'GPU'          then 'GPU'
    when 'Power supply' then 'PSU'
    when 'Cabinet'      then 'CAB'
    when 'Monitor'      then 'MON'
    when 'Keyboard'     then 'KBD'
    when 'Mouse'        then 'MOU'
    when 'UPS'          then 'UPS'
    when 'Accessory'    then 'ACC'
    when 'Other'        then 'OTH'
  end;
$function$;

create or replace function text_array_distinct(p text[])
 returns boolean
 language sql
 immutable
as $function$
  select cardinality(p) = (select count(distinct x) from unnest(p) x);
$function$;
