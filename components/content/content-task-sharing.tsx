"use client";

import { useMemo, useState } from "react";
import { DatePicker, dateUnavailableReason } from "@/components/ui/date-picker";
import { DurationField } from "@/components/ui/duration-field";
import { IconUser } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { SearchSelect } from "@/components/ui/selects";
import { formatDate } from "@/lib/calendar";
import { CONTENT_WRITER_DEPARTMENT, PRIORITIES, SMM_DEPARTMENT } from "@/lib/master-data";
import { isGlobalManager, isProjectLeader, onContentDesk } from "@/lib/permissions";
import { useStore } from "@/lib/store";
import { contentLabel, type ContentEntry, type Priority, type Project, type Task } from "@/lib/types";

/*
 * Sharing out a content task within the writers' desk (0024): the Content
 * Writers' Team Leader gives an unassigned one to a writer, and pieces of any
 * content task can be moved onto a new task for someone else.
 */

/** Active people in the Content Writers department, as picker options. */
function useWriterOptions(everyone = false) {
  const { db } = useStore();
  return useMemo(
    () =>
      db.users
        // Content Writers and Social Media Marketing both take content tasks (0028).
        .filter((u) => u.active && (everyone || onContentDesk(u)))
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
        .map((u) => ({
          value: u.id,
          label: u.fullName,
          hint:
            u.departments.find((d) => d === CONTENT_WRITER_DEPARTMENT || d === SMM_DEPARTMENT) ??
            u.departments[0],
          avatarName: u.fullName,
        })),
    [db.users, everyone],
  );
}

/** Shown on an unassigned content task to the Content Writers' Team Leader. */
export function AssignContentTaskBox({ task }: { task: Task }) {
  const { assignContentTask } = useStore();
  const writers = useWriterOptions();
  const [userId, setUserId] = useState("");

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-card border border-st-submitted/40 bg-st-submitted/10 p-3">
      <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <IconUser size={14} /> Nobody is writing this yet
      </p>
      <p className="text-[12px] text-ink-muted">
        Give it to someone on your team; its {task.contentCount} piece
        {task.contentCount === 1 ? "" : "s"} become theirs.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 sm:max-w-xs">
          <SearchSelect
            options={writers}
            value={userId}
            onChange={setUserId}
            placeholder="Pick a writer…"
          />
        </div>
        <Button
          variant="primary"
          disabled={!userId}
          onClick={() => {
            assignContentTask(task.id, userId);
            setUserId("");
          }}
        >
          Assign
        </Button>
      </div>
    </div>
  );
}

/** Moves the picked pieces onto a new content task for one person. */
export function SplitContentTaskDialog({
  task,
  project,
  pieces,
  onClose,
  onDone,
}: {
  task: Task;
  project: Project;
  pieces: ContentEntry[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { db, currentUser, splitContentTask } = useStore();
  const user = currentUser!;
  // A Team Leader shares within their own desk; managers and the Project
  // Leader may give it to anyone.
  const anyone = isGlobalManager(user) || isProjectLeader(user, project);
  const people = useWriterOptions(anyone);

  const targets = pieces.filter((p) => p.slot !== null).length;
  const [title, setTitle] = useState(`${task.title} – part 2`);
  const [assigneeId, setAssigneeId] = useState("");
  const [startDate, setStartDate] = useState(task.startDate);
  const [dueDate, setDueDate] = useState(task.dueDate);
  const [hours, setHours] = useState(task.estimatedHours);
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const bounds = { config: db.calendar, min: project.startDate, max: project.deadline };
  const errors = {
    title: !title.trim() ? "The new task needs a title." : undefined,
    assignee: !assigneeId ? "Pick who writes it." : undefined,
    startDate: dateUnavailableReason(startDate, bounds) ?? undefined,
    dueDate:
      dueDate < startDate
        ? "The due date must be on or after the start date."
        : (dateUnavailableReason(dueDate, bounds) ?? undefined),
    pieces:
      targets >= task.contentCount
        ? "Leave at least one piece on this task - to hand all of it over, reassign it instead."
        : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);

  const save = async () => {
    setTouched(true);
    if (!valid) return;
    setSaving(true);
    const ok = await splitContentTask(task.id, {
      pieceIds: pieces.map((p) => p.id),
      title: title.trim(),
      assigneeId,
      startDate,
      dueDate,
      estimatedHours: hours,
      priority,
    });
    setSaving(false);
    if (ok) {
      onDone();
      onClose();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="New content task from selected"
      subtitle={`${pieces.length} piece${pieces.length === 1 ? "" : "s"} move from "${task.title}"`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "Creating…" : "Create task & move pieces"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-ink-muted">
          <p className="mb-1.5">
            Moving with everything already written in them.{" "}
            <span className="font-medium text-ink">&ldquo;{task.title}&rdquo;</span> drops from{" "}
            {task.contentCount} to {Math.max(0, task.contentCount - targets)} piece
            {task.contentCount - targets === 1 ? "" : "s"}.
          </p>
          <ul className="flex max-h-32 flex-col gap-0.5 overflow-y-auto">
            {pieces.map((p) => (
              <li key={p.id} className="truncate text-ink">
                · {contentLabel(p)}
                <span className="text-ink-faint">
                  {" "}
                  ({p.type}
                  {p.slot === null ? ", extra" : ""})
                </span>
              </li>
            ))}
          </ul>
          {touched && errors.pieces ? (
            <p className="mt-1.5 text-st-rejected">{errors.pieces}</p>
          ) : null}
        </div>

        <Field label="New task title" required error={touched ? errors.title : undefined}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field
          label="Assign to"
          required
          hint={anyone ? undefined : "Someone on the Content Writers or Social Media Marketing team."}
          error={touched ? errors.assignee : undefined}
        >
          <SearchSelect
            options={people}
            value={assigneeId}
            onChange={setAssigneeId}
            placeholder="Pick a writer…"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date" required error={touched ? errors.startDate : undefined}>
            <DatePicker
              value={startDate}
              onChange={(v) => {
                setStartDate(v);
                if (dueDate < v) setDueDate(v);
              }}
              config={db.calendar}
              min={bounds.min}
              max={bounds.max}
            />
          </Field>
          <Field
            label="Due date"
            required
            hint={`Project runs to ${formatDate(project.deadline)}.`}
            error={touched ? errors.dueDate : undefined}
          >
            <DatePicker
              value={dueDate}
              onChange={setDueDate}
              config={db.calendar}
              min={startDate > bounds.min ? startDate : bounds.min}
              max={bounds.max}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Estimated time">
            <DurationField valueHours={hours} onChange={(h) => setHours(h ?? 0)} />
          </Field>
          <Field label="Priority">
            <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}
