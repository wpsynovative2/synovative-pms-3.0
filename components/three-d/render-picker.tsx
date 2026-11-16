"use client";

import { useMemo, useState } from "react";
import { IconCheck, IconChevronDown, IconChevronRight, IconClose } from "@/components/ui/icons";
import { Badge, SearchInput, cx } from "@/components/ui/primitives";
import { camReadiness, tasksInGroup, type RenderKind } from "@/lib/shorts";
import { groupTree } from "@/lib/task-groups";
import type { Task, TaskGroup } from "@/lib/types";

export interface RenderPick {
  groupIds: string[];
  taskIds: string[];
}

const KIND_STYLE: Record<RenderKind, string> = {
  group: "border-brand/30 bg-brand/10 text-brand-ink",
  "sub-group": "border-st-inprogress/30 bg-st-inprogress/10 text-st-inprogress",
  task: "border-line bg-surface-2 text-ink-muted",
};
const KIND_LABEL: Record<RenderKind, string> = {
  group: "Group",
  "sub-group": "Sub-group",
  task: "Task",
};

/**
 * Picks what a cam renders (0036): any mix of groups, sub-groups and tasks, from
 * the project's tree. Picking a group takes in everything under it, which shows
 * as ticked and greyed, so nothing is picked twice.
 */
export function RenderPicker({
  projectId,
  groups,
  tasks,
  value,
  onChange,
  invalid,
}: {
  projectId: string;
  /** The project's groups and sub-groups. */
  groups: TaskGroup[];
  /** The project's tasks; only those filed in a sub-group can be picked. */
  tasks: Task[];
  value: RenderPick;
  onChange: (next: RenderPick) => void;
  invalid?: boolean;
}) {
  const tree = useMemo(() => groupTree(groups, projectId), [groups, projectId]);
  const [query, setQuery] = useState("");
  /** Sub-groups opened onto their tasks; groups start open. */
  const [openSubs, setOpenSubs] = useState<Set<string>>(() => new Set());
  const [closedGroups, setClosedGroups] = useState<Set<string>>(() => new Set());

  const tasksOf = (subId: string) =>
    tasks
      .filter((t) => t.groupId === subId)
      .sort((a, b) => (a.groupNumber ?? 0) - (b.groupNumber ?? 0));

  const picked = new Set([...value.groupIds, ...value.taskIds]);
  const readiness = camReadiness(
    { renderGroupIds: value.groupIds, renderTaskIds: value.taskIds },
    groups,
    tasks,
  );

  // ------------------------------------------------------------ picking --
  const toggleGroup = (g: TaskGroup) => {
    if (value.groupIds.includes(g.id)) {
      onChange({ ...value, groupIds: value.groupIds.filter((x) => x !== g.id) });
      return;
    }
    // What it takes in no longer needs picking on its own.
    const under = new Set([
      ...groups.filter((s) => s.parentId === g.id).map((s) => s.id),
      ...tasksInGroup(g, groups, tasks).map((t) => t.id),
    ]);
    onChange({
      groupIds: [...value.groupIds.filter((x) => !under.has(x)), g.id],
      taskIds: value.taskIds.filter((x) => !under.has(x)),
    });
  };
  const toggleTask = (t: Task) =>
    onChange({
      ...value,
      taskIds: value.taskIds.includes(t.id)
        ? value.taskIds.filter((x) => x !== t.id)
        : [...value.taskIds, t.id],
    });
  const remove = (id: string) =>
    onChange({
      groupIds: value.groupIds.filter((x) => x !== id),
      taskIds: value.taskIds.filter((x) => x !== id),
    });

  // ------------------------------------------------------------ search --
  const q = query.trim().toLowerCase();
  const hit = (code: string, name: string) =>
    !q || `${code} ${name}`.toLowerCase().includes(q);

  const rows = tree.flatMap(({ group, subGroups }) => {
    const gCode = `T${group.number}`;
    const subs = subGroups.map((s) => {
      const sCode = `${gCode}.${s.number}`;
      const subTasks = tasksOf(s.id);
      const shownTasks = subTasks.filter((t) => hit(t.code ?? "", t.title));
      return { s, sCode, subTasks, shownTasks, match: hit(sCode, s.name) };
    });
    const groupMatch = hit(gCode, group.name);
    const visibleSubs = subs.filter((x) => !q || groupMatch || x.match || x.shownTasks.length);
    if (q && !groupMatch && !visibleSubs.length) return [];
    return [{ group, gCode, subs: visibleSubs, total: tasksInGroup(group, groups, tasks) }];
  });

  const toggleSet = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  return (
    <div className="flex flex-col gap-2">
      {/* What is picked, as chips that can be taken off. */}
      <div
        className={cx(
          "flex min-h-11 flex-wrap items-center gap-1.5 rounded-[10px] border px-2.5 py-2",
          invalid ? "border-st-rejected/60" : "border-line",
        )}
      >
        {readiness.targets.length ? (
          readiness.targets.map((t) => (
            <span
              key={t.id}
              className={cx(
                "inline-flex max-w-full items-center gap-1.5 rounded-full border py-0.5 pr-1 pl-2 text-[12px]",
                KIND_STYLE[t.kind],
              )}
            >
              <span className="text-[10px] font-semibold tracking-wide uppercase opacity-80">
                {KIND_LABEL[t.kind]}
              </span>
              <span className="font-medium">{t.code}</span>
              <span className="truncate">{t.name}</span>
              {t.ready ? <IconCheck size={11} className="text-st-approved" /> : null}
              <button
                type="button"
                onClick={() => remove(t.id)}
                aria-label={`Remove ${t.code}`}
                className="rounded-full p-0.5 hover:bg-surface-3"
              >
                <IconClose size={11} />
              </button>
            </span>
          ))
        ) : (
          <span className="px-1 text-[12px] text-ink-faint">
            Nothing picked yet. Tick groups, sub-groups or tasks below.
          </span>
        )}
      </div>
      {readiness.targets.length ? (
        <p className="text-[11px] text-ink-muted">
          {readiness.ready ? (
            <Badge className="mr-1.5 border-st-approved/50 bg-st-approved/20 text-st-approved">
              Ready to render
            </Badge>
          ) : null}
          Covers {readiness.total} task{readiness.total === 1 ? "" : "s"}, {readiness.approved}{" "}
          approved. Ready to render once all are.
        </p>
      ) : null}

      <SearchInput
        value={query}
        active={!!query.trim()}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search T1.2, a sub-group or a task…"
      />

      <div className="max-h-80 overflow-y-auto rounded-[10px] border border-line bg-surface">
        {rows.length === 0 ? (
          <p className="px-3 py-4 text-center text-[12px] text-ink-faint">
            {tree.length ? "Nothing matches." : "This project has no groups yet, in the Tasks tab."}
          </p>
        ) : (
          rows.map(({ group, gCode, subs, total }) => {
            const groupPicked = picked.has(group.id);
            const groupOpen = !!q || !closedGroups.has(group.id);
            return (
              <div key={group.id} className="border-b border-line-soft last:border-b-0">
                <Row
                  depth={0}
                  kind="group"
                  code={gCode}
                  name={group.name}
                  meta={`${subs.length} sub-group${subs.length === 1 ? "" : "s"} · ${progress(total)}`}
                  state={groupPicked ? "on" : "off"}
                  open={groupOpen}
                  onToggleOpen={() => setClosedGroups((s) => toggleSet(s, group.id))}
                  onPick={() => toggleGroup(group)}
                />
                {groupOpen
                  ? subs.map(({ s, sCode, subTasks, shownTasks }) => {
                      const subPicked = picked.has(s.id);
                      const subOpen = !!q || openSubs.has(s.id);
                      return (
                        <div key={s.id}>
                          <Row
                            depth={1}
                            kind="sub-group"
                            code={sCode}
                            name={s.name}
                            meta={progress(subTasks)}
                            state={groupPicked ? "inherited" : subPicked ? "on" : "off"}
                            inheritedFrom={groupPicked ? gCode : undefined}
                            open={subOpen}
                            onToggleOpen={
                              subTasks.length
                                ? () => setOpenSubs((x) => toggleSet(x, s.id))
                                : undefined
                            }
                            onPick={() => toggleGroup(s)}
                          />
                          {subOpen
                            ? (q ? shownTasks : subTasks).map((t) => (
                                <Row
                                  key={t.id}
                                  depth={2}
                                  kind="task"
                                  code={t.code ?? ""}
                                  name={t.title}
                                  meta={t.status}
                                  approved={t.status === "Approved"}
                                  state={
                                    groupPicked || subPicked
                                      ? "inherited"
                                      : picked.has(t.id)
                                        ? "on"
                                        : "off"
                                  }
                                  inheritedFrom={groupPicked ? gCode : subPicked ? sCode : undefined}
                                  onPick={() => toggleTask(t)}
                                />
                              ))
                            : null}
                          {subOpen && subTasks.length === 0 ? (
                            <p className="py-1.5 pl-[76px] text-[11px] text-ink-faint">No tasks yet.</p>
                          ) : null}
                        </div>
                      );
                    })
                  : null}
                {groupOpen && subs.length === 0 && !q ? (
                  <p className="py-1.5 pl-[52px] text-[11px] text-ink-faint">No sub-groups yet.</p>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const progress = (covered: Task[]) => {
  const approved = covered.filter((t) => t.status === "Approved").length;
  return covered.length
    ? `${covered.length} task${covered.length === 1 ? "" : "s"} · ${approved}/${covered.length} approved`
    : "no tasks";
};

/** One line of the tree: open/close, a tick-box, the code and name, what kind it is. */
function Row({
  depth,
  kind,
  code,
  name,
  meta,
  state,
  inheritedFrom,
  approved,
  open,
  onToggleOpen,
  onPick,
}: {
  depth: 0 | 1 | 2;
  kind: RenderKind;
  code: string;
  name: string;
  meta: string;
  /** "inherited": taken in by a group picked above it. */
  state: "on" | "off" | "inherited";
  inheritedFrom?: string;
  approved?: boolean;
  open?: boolean;
  onToggleOpen?: () => void;
  onPick: () => void;
}) {
  const inherited = state === "inherited";
  return (
    <div
      className={cx(
        "flex items-center gap-2 pr-3",
        depth === 0 ? "bg-surface-2/60 py-2 pl-2" : "py-1.5",
        depth === 1 && "pl-7",
        depth === 2 && "pl-[52px]",
        state === "on" && "bg-brand/8",
      )}
    >
      {kind === "task" ? (
        <span className="w-5 shrink-0" />
      ) : (
        <button
          type="button"
          onClick={onToggleOpen}
          disabled={!onToggleOpen}
          aria-label={open ? `Close ${code}` : `Open ${code}`}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint hover:bg-surface-3 disabled:opacity-30"
        >
          {open ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
        </button>
      )}

      <button
        type="button"
        role="checkbox"
        aria-checked={state !== "off"}
        disabled={inherited}
        onClick={onPick}
        title={inherited ? `Included with ${inheritedFrom}` : undefined}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-0.5 text-left disabled:cursor-default"
      >
        <span
          aria-hidden
          className={cx(
            "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border",
            state === "on"
              ? "border-brand bg-brand text-on-brand"
              : inherited
                ? "border-brand/40 bg-brand/30 text-on-brand"
                : "border-ink-faint/60 bg-surface",
          )}
        >
          {state !== "off" ? <IconCheck size={11} /> : null}
        </span>
        <span
          className={cx(
            "shrink-0 text-[12px] font-semibold",
            kind === "task" ? "text-ink-muted" : "text-brand-ink",
          )}
        >
          {code}
        </span>
        <span
          className={cx(
            "min-w-0 truncate text-[13px]",
            kind === "group" ? "font-medium text-ink" : "text-ink",
            inherited && "text-ink-muted",
          )}
        >
          {name}
        </span>
        <span
          className={cx(
            "shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium",
            KIND_STYLE[kind],
          )}
        >
          {KIND_LABEL[kind]}
        </span>
        <span
          className={cx(
            "ml-auto shrink-0 text-[11px]",
            approved ? "text-st-approved" : "text-ink-faint",
          )}
        >
          {inherited ? `In ${inheritedFrom}` : meta}
        </span>
      </button>
    </div>
  );
}
