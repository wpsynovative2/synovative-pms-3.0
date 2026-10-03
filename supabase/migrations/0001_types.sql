-- =============================================================================
-- Synovative PMS — baseline 1/8: extensions, enums, sequences
--
-- The consolidated schema for a fresh Supabase project. Run the files in this
-- folder in order, 0001 to 0008, in the SQL editor. Together they build exactly
-- what the original 0001-0028 chain built (kept in supabase/archive/ for
-- databases created from it). New changes go in the next numbered file here.
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

create type output_location as enum ('Google Drive', 'WhatsApp');

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
  'content_allotted'
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
  'Brochure Content'
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

-- ------------------------------------------------------------- sequences ---

create sequence obc_code_seq;

-- ---------------------------------------------- needed by column defaults ---

create or replace function ist_today()
 returns date
 language sql
 stable
as $function$
  select (now() at time zone 'Asia/Kolkata')::date;
$function$;
