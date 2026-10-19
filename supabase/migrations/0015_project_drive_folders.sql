-- A project selling a 3D walkthrough gets a Drive folder: <project name> with
-- two areas inside, CSF (client servicing) and 3D Team. The folders live under
-- the "3D Operation Work" folder of the agency's Google account and are made by
-- /api/drive/project-folders; this records where they are.
--
-- Who sees each area is decided in the PMS (canUseProjectDriveArea), and the
-- upload routes re-check it, so nothing here hides the ids themselves. Making
-- the folder is open to whoever may edit the project and to the 3D Artists'
-- Team Leader, who cannot update projects directly, hence the function.
-- Mirrors canCreateProjectDrive in lib/permissions.ts.

alter table projects
  add column drive_folder_id       text not null default '',
  add column drive_csf_folder_id   text not null default '',
  add column drive_team3d_folder_id text not null default '';

create or replace function can_create_project_drive(p_project_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select exists (
           select 1 from project_services
            where project_id = p_project_id and service = '3D Walkthrough Animation'
         )
     and (
           is_global_manager()
        or leads_project(p_project_id)
        or (is_team_leader()
            and can_see_project(p_project_id)
            and exists (
              select 1 from profile_departments
               where profile_id = auth.uid() and department = '3D Artists'
            ))
     );
$function$;

-- Records the folders once. A project that already has one keeps it, so a
-- second press cannot point the project somewhere else.
create or replace function set_project_drive_folders(
  p_project_id uuid,
  p_folder_id text,
  p_csf_folder_id text,
  p_team3d_folder_id text
)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not can_create_project_drive(p_project_id) then
    raise exception 'You can''t create this project''s Drive folder.' using errcode = '42501';
  end if;
  update projects
     set drive_folder_id        = p_folder_id,
         drive_csf_folder_id    = p_csf_folder_id,
         drive_team3d_folder_id = p_team3d_folder_id
   where id = p_project_id and drive_folder_id = '';
end;
$function$;

revoke all on function set_project_drive_folders(uuid, text, text, text) from public;
grant execute on function set_project_drive_folders(uuid, text, text, text) to authenticated;
grant execute on function can_create_project_drive(uuid) to authenticated;

notify pgrst, 'reload schema';
