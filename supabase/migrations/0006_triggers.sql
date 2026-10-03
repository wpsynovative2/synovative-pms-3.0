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

create trigger tasks_content_slots after insert or update of kind, content_count, assignee_id, title on tasks for each row execute function tasks_sync_content_slots();

create trigger tasks_drop_content_slots before delete on tasks for each row execute function tasks_drop_empty_slots();

create trigger content_bank_guard_slot_delete before delete on content_bank for each row execute function guard_content_slot_delete();

