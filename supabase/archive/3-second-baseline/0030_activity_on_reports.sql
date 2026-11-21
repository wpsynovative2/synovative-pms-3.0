-- A person's activity moves from their page to the Reports page, and to the
-- operations heads only: Super Admin and Admin. Managers and HR Admin, who could
-- read it under 0028, no longer can. Nothing else about task_opens changes.
--
-- Mirrors canViewUserActivity in lib/permissions.ts.

create or replace function can_view_user_activity()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select auth_role() in ('super_admin', 'admin');
$function$;

notify pgrst, 'reload schema';
