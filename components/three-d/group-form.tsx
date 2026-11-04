"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button, Field, Input } from "@/components/ui/primitives";
import { useStore } from "@/lib/store";
import type { TaskGroup } from "@/lib/types";

/** Adds a task group to a 3D project, or renames one. Its number is the database's (0022). */
export function GroupFormModal({
  projectId,
  group,
  nextNumber,
  onClose,
}: {
  projectId: string;
  /** Present → rename, absent → add. */
  group?: TaskGroup;
  /** What the new group will probably be numbered, to show in the title. */
  nextNumber?: number;
  onClose: () => void;
}) {
  const { createTaskGroup, renameTaskGroup } = useStore();
  const [name, setName] = useState(group?.name ?? "");
  const [touched, setTouched] = useState(false);
  const error = name.trim() ? undefined : "Give the group a name.";

  const save = () => {
    setTouched(true);
    if (error) return;
    if (group) renameTaskGroup(group.id, name.trim());
    else createTaskGroup(projectId, name.trim());
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={group ? `Rename T${group.number}` : `Add group T${nextNumber ?? ""}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            {group ? "Save changes" : "Add group"}
          </Button>
        </>
      }
    >
      <Field
        label="Group name"
        required
        htmlFor="task-group-name"
        error={touched ? error : undefined}
      >
        <Input
          id="task-group-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
          placeholder="e.g. Modelling"
        />
      </Field>
    </Modal>
  );
}
