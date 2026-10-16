-- =============================================================================
-- Synovative PMS — baseline 7/8: row level security
--
-- The real permission boundary (ARCHITECTURE.md §5): every browser read and
-- write runs as the signed-in user. lib/permissions.ts mirrors these rules for
-- what the UI shows - change both together.
-- =============================================================================

alter table departments enable row level security;
alter table services enable row level security;
alter table profiles enable row level security;
alter table profile_departments enable row level security;
alter table projects enable row level security;
alter table project_services enable row level security;
alter table project_members enable row level security;
alter table tasks enable row level security;
alter table time_sessions enable row level security;
alter table submissions enable row level security;
alter table reviews enable row level security;
alter table remarks enable row level security;
alter table vendors enable row level security;
alter table expenses enable row level security;
alter table project_templates enable row level security;
alter table project_template_services enable row level security;
alter table project_template_tasks enable row level security;
alter table task_templates enable row level security;
alter table holidays enable row level security;
alter table working_overrides enable row level security;
alter table notifications enable row level security;
alter table link_groups enable row level security;
alter table operational_links enable row level security;
alter table companies enable row level security;
alter table clients enable row level security;
alter table properties enable row level security;
alter table property_configs enable row level security;
alter table property_drive_folders enable row level security;
alter table obcs enable row level security;
alter table obc_items enable row level security;
alter table content_bank enable row level security;
alter table comments enable row level security;
alter table minutes enable row level security;
alter table obc_services enable row level security;
alter table property_clients enable row level security;

-- departments
create policy departments_read on departments for select to authenticated
  using (is_active_member());
create policy departments_write on departments for all to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- services
create policy services_read on services for select to authenticated
  using (is_active_member());
create policy services_write on services for all to authenticated
  using (is_super_admin())
  with check (is_super_admin());

-- profiles
create policy profiles_delete on profiles for delete to authenticated
  using (is_super_admin());
create policy profiles_insert on profiles for insert to authenticated
  with check ((auth_role() = any (array['super_admin'::app_role, 'admin'::app_role, 'hr_admin'::app_role])));
create policy profiles_read on profiles for select to authenticated
  using ((is_active_member() or (id = auth.uid())));
create policy profiles_update on profiles for update to authenticated
  using (((auth_role() = any (array['super_admin'::app_role, 'admin'::app_role, 'hr_admin'::app_role])) or (id = auth.uid())))
  with check (((auth_role() = any (array['super_admin'::app_role, 'admin'::app_role, 'hr_admin'::app_role])) or (id = auth.uid())));

-- profile_departments
create policy profile_departments_read on profile_departments for select to authenticated
  using (is_active_member());
create policy profile_departments_write on profile_departments for all to authenticated
  using ((auth_role() = any (array['super_admin'::app_role, 'admin'::app_role, 'hr_admin'::app_role])))
  with check ((auth_role() = any (array['super_admin'::app_role, 'admin'::app_role, 'hr_admin'::app_role])));

-- projects
create policy projects_delete on projects for delete to authenticated
  using ((is_global_manager() or (leader_id = auth.uid())));
create policy projects_insert on projects for insert to authenticated
  with check (is_global_manager());
create policy projects_read on projects for select to authenticated
  using (can_see_project(id));
create policy projects_update on projects for update to authenticated
  using ((is_global_manager() or (leader_id = auth.uid())))
  with check ((is_global_manager() or (leader_id = auth.uid())));

-- project_services
create policy project_services_read on project_services for select to authenticated
  using (can_see_project(project_id));
create policy project_services_write on project_services for all to authenticated
  using ((is_global_manager() or leads_project(project_id)))
  with check ((is_global_manager() or leads_project(project_id)));

-- project_members
create policy project_members_read on project_members for select to authenticated
  using (can_see_project(project_id));
create policy project_members_write on project_members for all to authenticated
  using ((is_global_manager() or leads_project(project_id)))
  with check ((is_global_manager() or leads_project(project_id)));

-- tasks
create policy tasks_delete on tasks for delete to authenticated
  using (can_edit_task(id));
create policy tasks_insert on tasks for insert to authenticated
  with check (
case
    when (project_id is null) then (is_global_manager() or is_team_leader())
    else (is_global_manager() or leads_project(project_id) or is_team_leader())
end);
create policy tasks_read on tasks for select to authenticated
  using ((is_global_manager() or (assignee_id = auth.uid()) or (created_by = auth.uid()) or ((project_id is not null) and can_see_project(project_id))));
create policy tasks_update on tasks for update to authenticated
  using (can_edit_task(id))
  with check (can_edit_task(id));

-- time_sessions
create policy time_sessions_insert on time_sessions for insert to authenticated
  with check (((profile_id = auth.uid()) and (exists ( select 1
   from tasks t
  where ((t.id = time_sessions.task_id) and (t.assignee_id = auth.uid()))))));
create policy time_sessions_read on time_sessions for select to authenticated
  using (((profile_id = auth.uid()) or can_see_task(task_id)));
create policy time_sessions_update on time_sessions for update to authenticated
  using ((profile_id = auth.uid()))
  with check ((profile_id = auth.uid()));

-- submissions
create policy submissions_insert on submissions for insert to authenticated
  with check (((by_profile_id = auth.uid()) and (exists ( select 1
   from tasks t
  where ((t.id = submissions.task_id) and (t.assignee_id = auth.uid()))))));
create policy submissions_read on submissions for select to authenticated
  using (can_see_task(task_id));

-- reviews
create policy reviews_insert on reviews for insert to authenticated
  with check (((by_profile_id = auth.uid()) and can_review_task(task_id)));
create policy reviews_read on reviews for select to authenticated
  using (can_see_task(task_id));

-- remarks
create policy remarks_insert on remarks for insert to authenticated
  with check (((by_profile_id = auth.uid()) and can_see_task(task_id)));
create policy remarks_read on remarks for select to authenticated
  using (can_see_task(task_id));

-- vendors
create policy vendors_read on vendors for select to authenticated
  using (is_active_member());
create policy vendors_write on vendors for all to authenticated
  using ((is_global_manager() or is_finance()))
  with check ((is_global_manager() or is_finance()));

-- expenses
create policy expenses_delete on expenses for delete to authenticated
  using ((leads_project(project_id) and (status = 'Pending'::expense_status)));
create policy expenses_insert on expenses for insert to authenticated
  with check ((leads_project(project_id) and (status = 'Pending'::expense_status)));
create policy expenses_read on expenses for select to authenticated
  using ((is_finance() or can_see_project(project_id)));
create policy expenses_update_finance on expenses for update to authenticated
  using (is_finance())
  with check (is_finance());
create policy expenses_update_leader on expenses for update to authenticated
  using ((leads_project(project_id) and (status = 'Pending'::expense_status)))
  with check ((leads_project(project_id) and (status = 'Pending'::expense_status)));

-- project_templates
create policy project_templates_read on project_templates for select to authenticated
  using (is_active_member());
create policy project_templates_write on project_templates for all to authenticated
  using ((auth_role() = any (array['super_admin'::app_role, 'admin'::app_role])))
  with check ((auth_role() = any (array['super_admin'::app_role, 'admin'::app_role])));

-- project_template_services
create policy pts_read on project_template_services for select to authenticated
  using (is_active_member());
create policy pts_write on project_template_services for all to authenticated
  using ((auth_role() = any (array['super_admin'::app_role, 'admin'::app_role])))
  with check ((auth_role() = any (array['super_admin'::app_role, 'admin'::app_role])));

-- project_template_tasks
create policy ptt_read on project_template_tasks for select to authenticated
  using (is_active_member());
create policy ptt_write on project_template_tasks for all to authenticated
  using ((auth_role() = any (array['super_admin'::app_role, 'admin'::app_role])))
  with check ((auth_role() = any (array['super_admin'::app_role, 'admin'::app_role])));

-- task_templates
create policy task_templates_read on task_templates for select to authenticated
  using (is_active_member());
create policy task_templates_write on task_templates for all to authenticated
  using ((auth_role() = any (array['super_admin'::app_role, 'admin'::app_role])))
  with check ((auth_role() = any (array['super_admin'::app_role, 'admin'::app_role])));

-- holidays
create policy holidays_read on holidays for select to authenticated
  using (is_active_member());
create policy holidays_write on holidays for all to authenticated
  using (is_hr_admin())
  with check (is_hr_admin());

-- working_overrides
create policy overrides_read on working_overrides for select to authenticated
  using (is_active_member());
create policy overrides_write on working_overrides for all to authenticated
  using (is_hr_admin())
  with check (is_hr_admin());

-- notifications
create policy notifications_read on notifications for select to authenticated
  using ((profile_id = auth.uid()));
create policy notifications_update on notifications for update to authenticated
  using ((profile_id = auth.uid()))
  with check ((profile_id = auth.uid()));

-- link_groups
create policy link_groups_read on link_groups for select to authenticated
  using (is_active_member());
create policy link_groups_write on link_groups for all to authenticated
  using (is_global_manager())
  with check (is_global_manager());

-- operational_links
create policy operational_links_read on operational_links for select to authenticated
  using (is_active_member());
create policy operational_links_write on operational_links for all to authenticated
  using (is_global_manager())
  with check (is_global_manager());

-- companies
create policy companies_delete on companies for delete to authenticated
  using (can_delete_crm());
create policy companies_insert on companies for insert to authenticated
  with check (can_manage_crm());
create policy companies_read on companies for select to authenticated
  using (is_active_member());
create policy companies_update on companies for update to authenticated
  using (can_manage_crm())
  with check (can_manage_crm());

-- clients
create policy clients_delete on clients for delete to authenticated
  using (can_delete_crm());
create policy clients_insert on clients for insert to authenticated
  with check (can_manage_crm());
create policy clients_read on clients for select to authenticated
  using (is_active_member());
create policy clients_update on clients for update to authenticated
  using (can_manage_crm())
  with check (can_manage_crm());

-- properties
create policy properties_delete on properties for delete to authenticated
  using (can_delete_crm());
create policy properties_insert on properties for insert to authenticated
  with check (can_manage_crm());
create policy properties_read on properties for select to authenticated
  using (is_active_member());
create policy properties_update on properties for update to authenticated
  using (can_manage_crm())
  with check (can_manage_crm());

-- property_configs
create policy property_configs_read on property_configs for select to authenticated
  using (is_active_member());
create policy property_configs_write on property_configs for all to authenticated
  using (can_manage_crm())
  with check (can_manage_crm());

-- property_drive_folders
create policy property_drive_folders_read on property_drive_folders for select to authenticated
  using (is_active_member());
create policy property_drive_folders_write on property_drive_folders for all to authenticated
  using (can_manage_crm())
  with check (can_manage_crm());

-- obcs
create policy obcs_delete on obcs for delete to authenticated
  using (can_delete_crm());
create policy obcs_insert on obcs for insert to authenticated
  with check (can_manage_crm());
create policy obcs_read on obcs for select to authenticated
  using (is_active_member());
create policy obcs_update on obcs for update to authenticated
  using (can_manage_crm())
  with check (can_manage_crm());

-- obc_items
create policy obc_items_read on obc_items for select to authenticated
  using (is_active_member());
create policy obc_items_write on obc_items for all to authenticated
  using (can_manage_crm())
  with check (can_manage_crm());

-- content_bank
create policy content_bank_delete on content_bank for delete to authenticated
  using (((can_write_content() and (created_by = auth.uid())) or can_delete_crm()));
create policy content_bank_insert on content_bank for insert to authenticated
  with check ((can_write_content() and can_see_project(project_id)));
create policy content_bank_read on content_bank for select to authenticated
  using ((can_see_project(project_id) or (allotted_to = auth.uid())));
create policy content_bank_update on content_bank for update to authenticated
  using ((can_write_content() and (created_by = auth.uid())))
  with check ((can_write_content() and (created_by = auth.uid())));

-- comments
create policy comments_delete on comments for delete to authenticated
  using (((created_by = auth.uid()) or can_delete_crm()));
create policy comments_insert on comments for insert to authenticated
  with check ((can_see_entity(entity_type, entity_id) and (created_by = auth.uid())));
create policy comments_read on comments for select to authenticated
  using (can_see_entity(entity_type, entity_id));
create policy comments_update on comments for update to authenticated
  using ((created_by = auth.uid()))
  with check ((created_by = auth.uid()));

-- minutes
create policy minutes_delete on minutes for delete to authenticated
  using (((created_by = auth.uid()) or can_delete_crm()));
create policy minutes_insert on minutes for insert to authenticated
  with check ((can_see_entity(entity_type, entity_id) and (created_by = auth.uid())));
create policy minutes_read on minutes for select to authenticated
  using (can_see_entity(entity_type, entity_id));
create policy minutes_update on minutes for update to authenticated
  using (((created_by = auth.uid()) or is_global_manager()))
  with check (((created_by = auth.uid()) or is_global_manager()));

-- obc_services
create policy obc_services_read on obc_services for select to authenticated
  using (is_active_member());
create policy obc_services_write on obc_services for all to authenticated
  using (can_manage_crm())
  with check (can_manage_crm());

-- property_clients
create policy property_clients_read on property_clients for select to authenticated
  using (is_active_member());
create policy property_clients_write on property_clients for all to authenticated
  using (can_manage_crm())
  with check (can_manage_crm());

