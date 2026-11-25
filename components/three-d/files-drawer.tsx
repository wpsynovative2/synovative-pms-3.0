"use client";

import { useState } from "react";
import { IconCheck, IconEdit, IconInbox, IconPlus, IconTrash } from "@/components/ui/icons";
import { ConfirmDialog, Drawer } from "@/components/ui/modal";
import { Badge, Button, EmptyState, IconButton, Input, ProgressBar, cx } from "@/components/ui/primitives";
import { formatDate } from "@/lib/calendar";
import { fileGroupProgress, filesOf } from "@/lib/files";
import { useStore } from "@/lib/store";
import { taskLabel, type FileGroup, type FileItem, type Project, type Task } from "@/lib/types";

/**
 * Files to receive (0016): the things a project needs from the client before
 * work can start, in named groups, each file ticked Received or not. A group is
 * received once every file in it is, and tasks waiting on it start that day.
 * Everyone who can see the project can read this; `mayManage` may change it.
 */
export function FilesDrawer({
  project,
  tasks,
  mayManage,
  onClose,
}: {
  project: Project;
  /** The project's tasks, to say which wait on each group. */
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
                ? "Add a group for what the client has to send, then the files in it. Tasks can wait on a group and start the day it is all in."
                : "Nobody has listed the files this project needs yet."
            }
          />
        ) : null}

        {groups.map((g) => (
          <FileGroupBlock
            key={g.id}
            group={g}
            items={filesOf(g.id, db.fileItems)}
            waiting={tasks.filter((t) => t.fileGroupIds?.includes(g.id))}
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
  waiting,
  mayManage,
}: {
  group: FileGroup;
  items: FileItem[];
  /** Tasks that wait on this group, released or not. */
  waiting: Task[];
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
          <FileRow key={f.id} item={f} mayManage={mayManage} />
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

      {waiting.length ? (
        <p className="border-t border-line-soft px-4 py-2 text-[11px] leading-relaxed text-ink-faint">
          {group.receivedOn ? "Released: " : "Waiting on it: "}
          {waiting.map((t) => taskLabel(t)).join(", ")}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => deleteFileGroup(group.id)}
        title={`Delete ${group.name}?`}
        body={`This deletes its ${items.length} file${items.length === 1 ? "" : "s"}.${
          waiting.length
            ? ` ${waiting.length} task${waiting.length === 1 ? " stops" : "s stop"} waiting on it.`
            : ""
        }`}
      />
    </section>
  );
}

function FileRow({ item, mayManage }: { item: FileItem; mayManage: boolean }) {
  const { userById, updateFileItem, deleteFileItem } = useStore();
  const [renaming, setRenaming] = useState<string | null>(null);
  const by = userById(item.receivedBy);

  const saveName = () => {
    const name = renaming?.trim();
    if (name && name !== item.name) updateFileItem(item.id, { name });
    setRenaming(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 hover:bg-surface-2">
      <button
        type="button"
        role="switch"
        aria-checked={item.received}
        disabled={!mayManage}
        onClick={() => updateFileItem(item.id, { received: !item.received })}
        title={mayManage ? (item.received ? "Mark not received" : "Mark received") : undefined}
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
          <IconButton label={`Delete ${item.name}`} onClick={() => deleteFileItem(item.id)}>
            <IconTrash size={13} />
          </IconButton>
        </span>
      ) : null}
    </div>
  );
}
