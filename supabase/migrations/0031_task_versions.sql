-- A fingerprint per task, so the browser downloads only the tasks that changed.
--
-- Supabase egress went over the free plan's 5 GB in October 2026. Most of it was
-- the tasks scope: every task with every timer session, submission, review,
-- remark, assignment and dependency, downloaded whole after each save, each
-- notification and each return to the tab. Now a refresh asks for this first,
-- about 60 bytes a task, and fetches in full only the tasks whose fingerprint
-- differs from the one it holds, or that it has edited itself since.
--
-- The fingerprint covers the task row and all of its child rows, so a stopped
-- timer, a new remark or a deleted dependency each change it. It is computed as
-- the caller (security invoker), so row level security leaves out exactly what
-- the caller couldn't read anyway, and a task that becomes visible or invisible
-- appears in or drops out of the result. One JSON object rather than a row per
-- task, so PostgREST's row cap never truncates it.
--
-- Mirrors loadTasksIncremental in lib/data/db.ts, which falls back to the full
-- load when this function is missing.

create or replace function task_versions()
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  with
    s as (select task_id, string_agg(x::text, '|' order by x.id) as agg from time_sessions x group by task_id),
    b as (select task_id, string_agg(x::text, '|' order by x.id) as agg from submissions x group by task_id),
    r as (select task_id, string_agg(x::text, '|' order by x.id) as agg from reviews x group by task_id),
    m as (select task_id, string_agg(x::text, '|' order by x.id) as agg from remarks x group by task_id),
    a as (select task_id, string_agg(x::text, '|' order by x.id) as agg from task_assignments x group by task_id),
    d as (
      select task_id, string_agg(x.depends_on_task_id::text, '|' order by x.depends_on_task_id) as agg
        from task_dependencies x group by task_id
    )
  select coalesce(
    jsonb_object_agg(
      t.id,
      left(md5(
        t::text
        || '#' || coalesce(s.agg, '')
        || '#' || coalesce(b.agg, '')
        || '#' || coalesce(r.agg, '')
        || '#' || coalesce(m.agg, '')
        || '#' || coalesce(a.agg, '')
        || '#' || coalesce(d.agg, '')
      ), 16)
    ),
    '{}'::jsonb
  )
    from tasks t
    left join s on s.task_id = t.id
    left join b on b.task_id = t.id
    left join r on r.task_id = t.id
    left join m on m.task_id = t.id
    left join a on a.task_id = t.id
    left join d on d.task_id = t.id;
$function$;

revoke all on function task_versions() from public, anon;
grant execute on function task_versions() to authenticated;

notify pgrst, 'reload schema';
