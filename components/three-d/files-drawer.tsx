"use client";

import { useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { IconCheck, IconEdit, IconInbox, IconPlus, IconTrash } from "@/components/ui/icons";
import { Drawer, Modal } from "@/components/ui/modal";
import { Badge, Button, EmptyState, IconButton, Input, ProgressBar, cx } from "@/components/ui/primitives";
import { formatDate } from "@/lib/calendar";
import {
  fileGroupProgress,
  fileLabel,
  filesOf,
  releasedToday,
  stillWaitingOn,
  tasksOnFiles,
  waitsOnNothingElse,
  type FreedTaskDates,
} from "@/lib/files";
import { useStore } from "@/lib/store";
import { taskLabel, type FileGroup, type FileItem, type Project, type Task } from "@/lib/types";

/**
 * Files to receive (0016, 0018): the things a project needs from the client
 * before work can start, in named groups, each file ticked Received or not.
 * Tasks wait on single files and start the day the last of theirs is in.
 * Everyone who can see the project can read this; `mayManage` may change it.
 */
export function FilesDrawer({
  project,
  tasks,
  mayManage,
  onClose,
}: {
  project: Project;
  /** The project's tasks, to say which wait on each file. */
  tasks: Task[];
  mayManage: boolean;
  onClose: () => void;
}) {
  const { db, createFileGroup } = useStore();
  const groups = db.fileGroups.filter((g) => g.projectId === project.id);
  const received = groups.filter((g) => g.receivedOn).length;
  const [newGroup, setNewGroup] = useState("");

  const addGroup = () => {
    const name = newGroup.trim();
    if (!name) return;
    createFileGroup(project.id, name);
    setNewGroup("");
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title="Files to receive"
      subtitle={
        groups.length
          ? `${received} of ${groups.length} group${groups.length === 1 ? "" : "s"} received`
          : project.name
      }
    >
      <div className="flex flex-col gap-4">
        {mayManage ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addGroup();
            }}
          >
            <Input
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              placeholder="New group, e.g. Architectural drawings"
              className="flex-1"
            />
            <Button type="submit" variant="primary" disabled={!newGroup.trim()}>
              <IconPlus size={14} /> Add group
            </Button>
          </form>
        ) : null}

        {groups.length === 0 ? (
          <EmptyState
            icon={<IconInbox size={28} />}
            title="No files listed yet"
            body={
              mayManage
                ? "Add a group for what the client has to send, then the files in it. A task can wait on any of the files and starts the day the last of them is in."
                : "Nobody has listed the files this project needs yet."
            }
          />
        ) : null}

        {groups.map((g) => (
          <FileGroupBlock
            key={g.id}
            group={g}
            items={filesOf(g.id, db.fileItems)}
            tasks={tasks}
            mayManage={mayManage}
          />
        ))}
      </div>
    </Drawer>
  );
}

function FileGroupBlock({
  group,
  items,
  tasks,
  mayManage,
}: {
  group: FileGroup;
  items: FileItem[];
  tasks: Task[];
  mayManage: boolean;
}) {
  const { db, renameFileGroup, deleteFileGroup, addFileItem } = useStore();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newFile, setNewFile] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const progress = fileGroupProgress(group.id, db.fileItems);

  const saveName = () => {
    const name = renaming?.trim();
    if (name && name !== group.name) renameFileGroup(group.id, name);
    setRenaming(null);
  };
  const addFile = () => {
    const name = newFile.trim();
    if (!name) return;
    addFileItem(group.id, name);
    setNewFile("");
  };

  return (
    <section className="rounded-xl border border-line bg-surface-2/40">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-soft px-4 py-3">
        {renaming !== null ? (
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              saveName();
            }}
          >
            <Input
              autoFocus
              value={renaming}
              onChange={(e) => setRenaming(e.target.value)}
              onBlur={saveName}
              className="h-8 flex-1"
            />
          </form>
        ) : (
          <span className="min-w-40 flex-1 truncate text-[14px] font-semibold text-ink">
            {group.name}
          </span>
        )}
        <span className="flex w-28 items-center gap-2">
          <ProgressBar value={progress.total ? (progress.received / progress.total) * 100 : 0} />
          <span className="shrink-0 text-[12px] text-ink-muted">
            {progress.received}/{progress.total}
          </span>
        </span>
        {group.receivedOn ? (
          <Badge className="border-st-approved/40 bg-st-approved/15 text-st-approved">
            Received {formatDate(group.receivedOn)}
          </Badge>
        ) : (
          <Badge className="border-line bg-surface-2 text-ink-muted">Not received</Badge>
        )}
        {mayManage ? (
          <>
            <IconButton label={`Rename ${group.name}`} onClick={() => setRenaming(group.name)}>
              <IconEdit size={14} />
            </IconButton>
            <IconButton label={`Delete ${group.name}`} onClick={() => setConfirmDelete(true)}>
              <IconTrash size={14} />
            </IconButton>
          </>
        ) : null}
      </div>

      <div className="flex flex-col px-2 py-2">
        {items.map((f) => (
          <FileRow key={f.id} item={f} tasks={tasks} mayManage={mayManage} />
        ))}
        {items.length === 0 ? (
          <p className="px-2 py-2 text-[12px] text-ink-faint">
            No files in this group yet. It counts as received once it has files and all are in.
          </p>
        ) : null}
        {mayManage ? (
          <form
            className="mt-1 flex gap-2 px-2 pb-1"
            onSubmit={(e) => {
              e.preventDefault();
              addFile();
            }}
          >
            <Input
              value={newFile}
              onChange={(e) => setNewFile(e.target.value)}
              placeholder="File name, e.g. Site plan (DWG)"
              className="h-8 flex-1"
            />
            <Button type="submit" size="sm" disabled={!newFile.trim()}>
              <IconPlus size={13} /> Add file
            </Button>
          </form>
        ) : null}
      </div>

      {confirmDelete ? (
        <DeleteFilesDialog
          title={`Delete ${group.name}?`}
          intro={`This deletes the group and its ${items.length} file${items.length === 1 ? "" : "s"}.`}
          itemIds={items.map((f) => f.id)}
          tasks={tasks}
          onConfirm={(dates) => deleteFileGroup(group.id, dates)}
          onClose={() => setConfirmDelete(false)}
        />
      ) : null}
    </section>
  );
}

function FileRow({ item, tasks, mayManage }: { item: FileItem; tasks: Task[]; mayManage: boolean }) {
  const { userById, updateFileItem, deleteFileItem } = useStore();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmTick, setConfirmTick] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const by = userById(item.receivedBy);
  const waiting = tasksOnFiles([item.id], tasks);
  // Tasks whose dates a delete touches: anything not yet approved.
  const open = waiting.filter((t) => t.status !== "Approved");

  const saveName = () => {
    const name = renaming?.trim();
    if (name && name !== item.name) updateFileItem(item.id, { name });
    setRenaming(null);
  };
  // Ticking it in always asks, since it cannot be taken back (0020).
  const tick = () => {
    if (!item.received) setConfirmTick(true);
  };
  const remove = () => {
    if (open.length) setConfirmDelete(true);
    else deleteFileItem(item.id);
  };

  return (
    <div className="flex flex-col rounded-lg px-2 py-1.5 hover:bg-surface-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          role="switch"
          aria-checked={item.received}
          disabled={!mayManage || item.received}
          onClick={tick}
          title={
            item.received
              ? "Received files stay received"
              : mayManage
                ? "Mark received"
                : undefined
          }
          className={cx(
            "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
            "disabled:cursor-default",
            item.received
              ? "border-st-approved/40 bg-st-approved/15 text-st-approved"
              : "border-line bg-surface-2 text-ink-muted enabled:hover:border-st-approved/40",
          )}
        >
          {item.received ? <IconCheck size={12} /> : null}
          {item.received ? "Received" : "Not received"}
        </button>

        {renaming !== null ? (
          <form
            className="flex flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              saveName();
            }}
          >
            <Input
              autoFocus
              value={renaming}
              onChange={(e) => setRenaming(e.target.value)}
              onBlur={saveName}
              className="h-8 flex-1"
            />
          </form>
        ) : (
          <span className="min-w-32 flex-1 truncate text-[13px] text-ink">{item.name}</span>
        )}

        {item.received && item.receivedOn ? (
          <span className="text-[11px] text-ink-faint">
            {formatDate(item.receivedOn)}
            {by ? ` · ${by.fullName}` : ""}
          </span>
        ) : null}

        {mayManage && renaming === null ? (
          <span className="flex gap-1">
            <IconButton label={`Rename ${item.name}`} onClick={() => setRenaming(item.name)}>
              <IconEdit size={13} />
            </IconButton>
            <IconButton label={`Delete ${item.name}`} onClick={remove}>
              <IconTrash size={13} />
            </IconButton>
          </span>
        ) : null}
      </div>

      {waiting.length ? (
        <p className="mt-0.5 pl-1 text-[11px] leading-relaxed text-ink-faint">
          {item.received ? "Was waited on by " : "Waited on by "}
          {waiting.map((t) => t.code ?? t.title).join(", ")}
        </p>
      ) : null}

      {confirmTick ? (
        <ReceiveDialog item={item} tasks={open} onClose={() => setConfirmTick(false)} />
      ) : null}
      {confirmDelete ? (
        <DeleteFilesDialog
          title={`Delete ${item.name}?`}
          intro="This file is taken off the list and out of every task that waits on it."
          itemIds={[item.id]}
          tasks={tasks}
          onConfirm={(dates) => deleteFileItem(item.id, dates)}
          onClose={() => setConfirmDelete(false)}
        />
      ) : null}
    </div>
  );
}

/** "T1.1.2, Chirag / DWG": what a task would still be waiting on. */
function useWaitingWords() {
  const { db } = useStore();
  return (task: Task, settled: string[]) => {
    const rest = stillWaitingOn(task, settled);
    return [
      ...rest.fileIds
        .map((id) => db.fileItems.find((f) => f.id === id))
        .filter((f) => !!f)
        .map((f) => fileLabel(f, db.fileGroups)),
      ...rest.taskIds
        .map((id) => db.tasks.find((t) => t.id === id))
        .filter((t) => !!t)
        .map((t) => t.code ?? t.title),
    ].join(", ");
  };
}

/**
 * Before a file is ticked in: which tasks start because of it, and when, and
 * which still wait on something else (follow_file_item, 0018). There is no
 * ticking it back out (0020).
 */
function ReceiveDialog({
  item,
  tasks,
  onClose,
}: {
  item: FileItem;
  /** Tasks waiting on this file that are not yet approved. */
  tasks: Task[];
  onClose: () => void;
}) {
  const { db, userById, updateFileItem } = useStore();
  const waitingWords = useWaitingWords();
  const starting = tasks.filter((t) => waitsOnNothingElse(t, [item.id]));
  const stillWaiting = tasks.filter((t) => !waitsOnNothingElse(t, [item.id]));

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={`Mark ${item.name} as received?`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="success"
            onClick={() => {
              updateFileItem(item.id, { received: true });
              onClose();
            }}
          >
            <IconCheck size={14} />
            Confirm, received
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px] leading-relaxed text-ink-muted">
        <p>
          This can&apos;t be undone: once marked received, the file stays received.
        </p>
        {tasks.length === 0 ? (
          <p>No task waits on this file, so nothing else changes.</p>
        ) : null}

        {starting.length ? (
          <div className="flex flex-col gap-1.5">
            <p>
              {starting.length === 1
                ? "This task is going to start today:"
                : `These ${starting.length} tasks are going to start today:`}
            </p>
            <ul className="flex flex-col gap-1">
              {starting.map((t) => {
                const dates = releasedToday(t, db.calendar);
                return (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-lg border border-line bg-surface-2 px-3 py-1.5"
                  >
                    <span className="font-medium text-ink">{taskLabel(t)}</span>
                    <span className="text-[12px]">
                      {formatDate(dates.startDate)} → {formatDate(dates.dueDate)}
                      {" · "}
                      {userById(t.assigneeId)?.fullName ?? "Nobody yet"}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="text-[12px] text-ink-faint">
              Each runs for its days to complete from today, and its assignee is told it can start.
            </p>
          </div>
        ) : null}

        {stillWaiting.length ? (
          <div className="flex flex-col gap-1.5">
            <p>Still waiting on something else, so these do not start yet:</p>
            <ul className="flex flex-col gap-1">
              {stillWaiting.map((t) => (
                <li
                  key={t.id}
                  className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-[12px]"
                >
                  <span className="font-medium text-ink">{taskLabel(t)}</span>
                  {" - waits on "}
                  {waitingWords(t, [item.id])}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Deleting files that tasks wait on (delete_file_item / delete_file_group,
 * 0018). Each task left waiting on nothing needs a start and a due date, picked
 * here; a task still waiting on something else keeps its projected dates.
 */
function DeleteFilesDialog({
  title,
  intro,
  itemIds,
  tasks,
  onConfirm,
  onClose,
}: {
  title: string;
  intro: string;
  itemIds: string[];
  tasks: Task[];
  onConfirm: (dates: FreedTaskDates) => void;
  onClose: () => void;
}) {
  const { db, userById } = useStore();
  const waitingWords = useWaitingWords();
  const affected = tasksOnFiles(itemIds, tasks).filter((t) => t.status !== "Approved");
  const freed = affected.filter((t) => waitsOnNothingElse(t, itemIds));
  const stillWaiting = affected.filter((t) => !waitsOnNothingElse(t, itemIds));

  // Mounted only while open, so these start from the tasks as they are now: a
  // task held up by these files from today, anything under way where it stands.
  const [dates, setDates] = useState<FreedTaskDates>(() =>
    Object.fromEntries(
      freed.map((t) => [
        t.id,
        t.waitingOnFileItemIds?.some((id) => itemIds.includes(id))
          ? releasedToday(t, db.calendar)
          : { startDate: t.startDate, dueDate: t.dueDate },
      ]),
    ),
  );
  const [touched, setTouched] = useState(false);

  const errorOf = (id: string) => {
    const d = dates[id];
    if (!d?.startDate || !d.dueDate) return "Pick both dates.";
    if (d.dueDate < d.startDate) return "The due date must be on or after the start date.";
    return undefined;
  };
  const valid = freed.every((t) => !errorOf(t.id));
  const setDate = (id: string, key: "startDate" | "dueDate", value: string) =>
    setDates((all) => {
      const d = { ...all[id], [key]: value };
      // Moving the start past the due date takes the due date with it.
      if (key === "startDate" && d.dueDate < value) d.dueDate = value;
      return { ...all, [id]: d };
    });

  return (
    <Modal
      open
      onClose={onClose}
      size={freed.length ? "lg" : "sm"}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              onConfirm(Object.fromEntries(freed.map((t) => [t.id, dates[t.id]])));
              onClose();
            }}
          >
            <IconTrash size={14} /> Delete
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-[13px] leading-relaxed text-ink-muted">
        <p>{intro}</p>

        {freed.length ? (
          <div className="flex flex-col gap-2">
            <p>
              {freed.length === 1
                ? "This task waits on nothing else once it goes, so give it its dates:"
                : `These ${freed.length} tasks wait on nothing else once it goes, so give each its dates:`}
            </p>
            {freed.map((t) => {
              const error = touched ? errorOf(t.id) : undefined;
              return (
                <div
                  key={t.id}
                  className={cx(
                    "flex flex-col gap-2 rounded-lg border bg-surface-2 px-3 py-2.5",
                    error ? "border-st-rejected/40" : "border-line",
                  )}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-medium text-ink">{taskLabel(t)}</span>
                    <span className="text-[12px] text-ink-faint">
                      {userById(t.assigneeId)?.fullName ?? "Nobody yet"} · {t.status}
                      {t.durationDays !== null && t.durationDays !== undefined
                        ? ` · ${t.durationDays} working day${t.durationDays === 1 ? "" : "s"}`
                        : ""}
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-[11px] text-ink-faint">
                      Start date
                      <DatePicker
                        value={dates[t.id]?.startDate ?? ""}
                        onChange={(v) => setDate(t.id, "startDate", v)}
                        config={db.calendar}
                        allowPast
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] text-ink-faint">
                      Due date
                      <DatePicker
                        value={dates[t.id]?.dueDate ?? ""}
                        onChange={(v) => setDate(t.id, "dueDate", v)}
                        config={db.calendar}
                        min={dates[t.id]?.startDate}
                        allowPast
                      />
                    </label>
                  </div>
                  {error ? <p className="text-[11px] text-st-rejected">{error}</p> : null}
                </div>
              );
            })}
            <p className="text-[12px] text-ink-faint">
              Any that were held up by it are released, and their assignees told they can start.
            </p>
          </div>
        ) : null}

        {stillWaiting.length ? (
          <div className="flex flex-col gap-1.5">
            <p>Still waiting on something else, so their dates stay projected from that:</p>
            <ul className="flex flex-col gap-1">
              {stillWaiting.map((t) => (
                <li
                  key={t.id}
                  className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-[12px]"
                >
                  <span className="font-medium text-ink">{taskLabel(t)}</span>
                  {" - waits on "}
                  {waitingWords(t, itemIds)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
