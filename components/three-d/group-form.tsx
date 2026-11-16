"use client";

import { useState } from "react";
import { ThreeDNotesFields } from "@/components/three-d/notes";
import { Modal } from "@/components/ui/modal";
import { Button, Field, Input } from "@/components/ui/primitives";
import { RichTextEditor } from "@/components/ui/rich-text";
import { useStore } from "@/lib/store";
import type { TaskGroup, ThreeDNotes } from "@/lib/types";

/**
 * Adds a group or a sub-group to a 3D project, or edits one (0022, 0033). A group
 * asks for its name and notes; a sub-group, which holds the tasks, also asks for a
 * description. Numbers are the database's.
 */
export function GroupFormModal({
  projectId,
  group,
  parent,
  nextNumber,
  onClose,
}: {
  projectId: string;
  /** Present → edit, absent → add. */
  group?: TaskGroup;
  /** The group a new sub-group goes in. Found from `group` when editing one. */
  parent?: TaskGroup | null;
  /** What the new one will probably be numbered, to show in the title. */
  nextNumber?: number;
  onClose: () => void;
}) {
  const { db, createTaskGroup, updateTaskGroup } = useStore();
  const parentGroup =
    parent ?? (group?.parentId ? db.taskGroups.find((g) => g.id === group.parentId) : undefined);
  const isSub = !!parentGroup;
  const noun = isSub ? "sub-group" : "group";

  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [notes, setNotes] = useState<ThreeDNotes>({
    clientSupeNotes: group?.clientSupeNotes ?? "",
    leadNote: group?.leadNote ?? "",
    generalNotes: group?.generalNotes ?? "",
  });
  const [touched, setTouched] = useState(false);
  const error = name.trim() ? undefined : `Give the ${noun} a title.`;

  const prefix = parentGroup ? `T${parentGroup.number}.` : "T";
  const title = group
    ? `Edit ${prefix}${group.number}`
    : `Add ${noun} ${prefix}${nextNumber ?? ""}`;

  const save = () => {
    setTouched(true);
    if (error) return;
    const input = {
      name: name.trim(),
      description: isSub ? description : (group?.description ?? ""),
      ...notes,
    };
    if (group) updateTaskGroup(group.id, input);
    else createTaskGroup(projectId, input, parentGroup?.id ?? null);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            {group ? "Save changes" : `Add ${noun}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {parentGroup && !group ? (
          <p className="text-[12px] text-ink-muted">
            In T{parentGroup.number} {parentGroup.name}
          </p>
        ) : null}
        <Field
          label={isSub ? "Title" : "Group name"}
          required
          htmlFor="task-group-name"
          error={touched ? error : undefined}
        >
          <Input
            id="task-group-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isSub ? "e.g. Tower exterior" : "e.g. Environment"}
          />
        </Field>
        {isSub ? (
          <Field label="Description">
            <RichTextEditor
              value={description}
              onChange={setDescription}
              placeholder="What this sub-group covers…"
              minHeight={96}
            />
          </Field>
        ) : null}
        <ThreeDNotesFields
          value={notes}
          onChange={(patch) => setNotes((n) => ({ ...n, ...patch }))}
        />
      </div>
    </Modal>
  );
}
