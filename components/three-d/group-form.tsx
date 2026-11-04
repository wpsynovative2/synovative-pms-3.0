"use client";

import { useState } from "react";
import { ThreeDNotesFields } from "@/components/three-d/notes";
import { Modal } from "@/components/ui/modal";
import { Button, Field, Input } from "@/components/ui/primitives";
import { useStore } from "@/lib/store";
import type { TaskGroup, ThreeDNotes } from "@/lib/types";

/** Adds a task group to a 3D project, or edits one. Its number is the database's (0022). */
export function GroupFormModal({
  projectId,
  group,
  nextNumber,
  onClose,
}: {
  projectId: string;
  /** Present → edit, absent → add. */
  group?: TaskGroup;
  /** What the new group will probably be numbered, to show in the title. */
  nextNumber?: number;
  onClose: () => void;
}) {
  const { createTaskGroup, updateTaskGroup } = useStore();
  const [name, setName] = useState(group?.name ?? "");
  const [notes, setNotes] = useState<ThreeDNotes>({
    clientSupeNotes: group?.clientSupeNotes ?? "",
    leadNote: group?.leadNote ?? "",
    generalNotes: group?.generalNotes ?? "",
  });
  const [touched, setTouched] = useState(false);
  const error = name.trim() ? undefined : "Give the group a name.";

  const save = () => {
    setTouched(true);
    if (error) return;
    const input = { name: name.trim(), ...notes };
    if (group) updateTaskGroup(group.id, input);
    else createTaskGroup(projectId, input);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={group ? `Edit T${group.number}` : `Add group T${nextNumber ?? ""}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            {group ? "Save changes" : "Add group"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
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
            placeholder="e.g. Environment"
          />
        </Field>
        <ThreeDNotesFields
          value={notes}
          onChange={(patch) => setNotes((n) => ({ ...n, ...patch }))}
        />
      </div>
    </Modal>
  );
}
