-- =============================================================================
-- Synovative PMS — baseline 6/8: triggers
--
-- Server-side notifications and invariants. Do not duplicate a trigger's
-- notification in lib/store.tsx.
-- =============================================================================

create trigger projects_guard_recurrence before insert or update on projects for each row execute function guard_recurrence();

create trigger tasks_guard_recurrence before insert or update on tasks for each row execute function guard_recurrence();

create trigger profiles_guard_update before update on profiles for each row execute function guard_profile_update();

create trigger profiles_guard_insert before insert on profiles for each row execute function guard_profile_insert();

create trigger tasks_notify_assignment after insert or update of assignee_id on tasks for each row execute function notify_task_assignment();

create trigger remarks_notify after insert on remarks for each row execute function notify_remark();

create trigger expenses_notify_added after insert on expenses for each row execute function notify_expense_added();

create trigger operational_links_touch before update on operational_links for each row execute function touch_operational_link();

create trigger obcs_guard_conversion before update on obcs for each row execute function guard_obc_conversion();

create trigger companies_touch before update on companies for each row execute function touch_updated_at();

create trigger clients_touch before update on clients for each row execute function touch_updated_at();

create trigger properties_touch before update on properties for each row execute function touch_updated_at();

create trigger obcs_touch before update on obcs for each row execute function touch_updated_at();

create trigger content_bank_touch before update on content_bank for each row execute function touch_updated_at();

create trigger minutes_touch before update on minutes for each row execute function touch_updated_at();

create trigger content_bank_notify_allotment after insert or update on content_bank for each row execute function notify_content_allotment();

create trigger obc_services_guard_allotment before insert or update on obc_services for each row execute function guard_obc_service_allotment();

create trigger obc_services_relax_status after insert or delete or update on obc_services for each row execute function relax_obc_on_unallotment();

create trigger content_bank_guard_allotment before insert or update on content_bank for each row execute function guard_content_allotment();

create trigger tasks_content_slots after insert or update of kind, content_count, content_types, content_placements, assignee_id, title on tasks for each row execute function tasks_sync_content_slots();

create trigger tasks_drop_content_slots before delete on tasks for each row execute function tasks_drop_empty_slots();

create trigger content_bank_guard_slot_delete before delete on content_bank for each row execute function guard_content_slot_delete();

create trigger tasks_follow_assignee after update of assignee_id on tasks for each row when ((new.assignee_id is distinct from old.assignee_id)) execute function follow_task_assignee();

create trigger content_bank_journey before insert or update on content_bank for each row execute function stamp_content_journey();

create trigger websites_renewal_default before insert or update on websites for each row execute function websites_default_renewal();

create trigger content_bank_guard_placement before insert or update on content_bank for each row execute function guard_content_placement();

create trigger projects_sync_clients before insert or update of client_id, client_ids on projects for each row execute function sync_project_clients();

create trigger clients_leave_projects after delete on clients for each row execute function drop_deleted_client_from_projects();

create trigger inventory_items_guard before insert or update on inventory_items for each row execute function inventory_guard_item();

create trigger workstations_guard before insert or update on workstations for each row execute function inventory_guard_workstation();

create trigger inventory_items_log after insert or delete or update on inventory_items for each row execute function inventory_log_item();

create trigger workstations_log after insert or delete or update on workstations for each row execute function inventory_log_workstation();

create trigger tasks_schedule_dependent before update on tasks for each row execute function schedule_dependent_task();

create trigger tasks_follow_dependency after update on tasks for each row when (((new.status is distinct from old.status) or (new.due_date is distinct from old.due_date))) execute function follow_task_dependency();

create trigger time_sessions_guard_waiting before insert on time_sessions for each row execute function guard_waiting_task();

create trigger submissions_guard_waiting before insert on submissions for each row execute function guard_waiting_task();

create trigger tasks_record_assignment after insert or update of assignee_id on tasks for each row execute function record_task_assignment();

create trigger clients_leave_tasks after delete on clients for each row execute function drop_deleted_client_from_tasks();

create trigger task_dependencies_guard before insert on task_dependencies for each row execute function guard_task_dependency();

create trigger task_dependencies_follow after insert or delete on task_dependencies for each row execute function follow_task_dependency_link();

create trigger task_groups_assign_number before insert on task_groups for each row execute function assign_group_number();

create trigger tasks_assign_group_number before insert or update of group_id, group_number on tasks for each row execute function assign_task_group_number();

create trigger tasks_place_in_chain after insert or update of group_id on tasks for each row when ((new.group_id is not null)) execute function place_task_in_chain();

create trigger tasks_close_chain_gap before delete on tasks for each row execute function close_chain_gap();

create trigger tasks_guard_3d_content before insert on tasks for each row when (((new.kind = 'content'::text) and (new.project_id is not null))) execute function guard_3d_content_task();

create trigger tasks_guard_3d_department before insert or update of department, project_id on tasks for each row when (((new.project_id is not null) and (new.department <> '3D Artists'::text))) execute function guard_3d_task_department();

create trigger shorts_plans_guard before insert on shorts_plans for each row execute function guard_shorts_plan();

create trigger shorts_assign_number before insert on shorts for each row execute function assign_short_number();

create trigger tasks_assign_cam_number before insert or update of short_id, short_number on tasks for each row execute function assign_cam_number();

create trigger tasks_guard_cam_render before insert or update of render_group_ids, render_task_ids on tasks for each row when (((new.render_group_ids <> '{}'::uuid[]) or (new.render_task_ids <> '{}'::uuid[]))) execute function guard_cam_render();

create trigger task_groups_drop_cam_renders after delete on task_groups for each row execute function drop_cam_render_links();

create trigger tasks_drop_cam_renders after delete on tasks for each row execute function drop_cam_render_links();

create trigger tasks_complete_content_design after update of status on tasks for each row when (((new.status = 'Approved'::task_status) and (old.status is distinct from 'Approved'::task_status))) execute function complete_content_design();

create trigger content_bank_guard_allottee before insert or update of allotted_to, allotted_task_id, motion_allotted_to, motion_allotted_task_id on content_bank for each row execute function guard_content_allottee();

create trigger content_bank_guard_design_completed before insert or update of stage on content_bank for each row execute function guard_content_design_completed();

create trigger content_bank_guard_stage_forward before update of stage on content_bank for each row execute function guard_content_stage_forward();

create trigger content_bank_scheduled_delivery before insert or update of stage, scheduled_on, delivery_date on content_bank for each row execute function content_scheduled_delivery();

create trigger tasks_reopen_content_design after update of status on tasks for each row when (((old.status = 'Approved'::task_status) and (new.status is distinct from 'Approved'::task_status))) execute function reopen_content_design();

create trigger projects_log_change after insert or delete or update on projects for each row execute function log_change('project');

create trigger tasks_log_change after insert or delete or update on tasks for each row execute function log_change('task');

create trigger content_bank_log_change after insert or delete or update on content_bank for each row execute function log_change('content');

create trigger content_bank_guard_one_per_task before insert or update of allotted_task_id, motion_allotted_task_id on content_bank for each row execute function guard_content_one_per_task();
