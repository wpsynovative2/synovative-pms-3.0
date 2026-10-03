-- =============================================================================
-- Synovative PMS — baseline 5/8: views
--
-- Aggregates (§19). Nothing in the client reads them today - project
-- statistics are computed in lib/analytics.ts (ARCHITECTURE.md §12).
-- =============================================================================

create view task_totals as
select t.id as task_id,
    coalesce(sum(EXTRACT(epoch from coalesce(s.ended_at, now()) - s.started_at)), 0::numeric)::bigint as seconds_logged
   from tasks t
     left join time_sessions s on s.task_id = t.id
  group by t.id;

create view project_stats as
select p.id as project_id,
    count(t.id) as total_tasks,
    count(t.id) filter (where t.status = 'Approved'::task_status) as approved_tasks,
        case
            when count(t.id) = 0 then 0::numeric
            else round(100.0 * count(t.id) filter (where t.status = 'Approved'::task_status)::numeric / count(t.id)::numeric)
        end as progress_pct,
    count(t.id) filter (where task_is_overdue(t.id, t.status, t.due_date)) as overdue_tasks,
    coalesce(sum(tt.seconds_logged), 0::numeric) as seconds_logged,
    coalesce(sum(t.estimated_hours), 0::numeric) as estimated_hours
   from projects p
     left join tasks t on t.project_id = p.id
     left join task_totals tt on tt.task_id = t.id
  group by p.id;

create view project_expense_totals as
select project_id,
    coalesce(sum(amount) filter (where status = 'Approved'::expense_status), 0::numeric) as approved_total,
    coalesce(sum(amount) filter (where status = 'Pending'::expense_status), 0::numeric) as pending_total,
    coalesce(sum(amount) filter (where status = 'Rejected'::expense_status), 0::numeric) as rejected_total
   from expenses
  group by project_id;

