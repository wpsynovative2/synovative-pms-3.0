"use client";

import { useState } from "react";
import { ThreeDNotesFields } from "@/components/three-d/notes";
import { Modal } from "@/components/ui/modal";
import { Button, Field, Input } from "@/components/ui/primitives";
import { RichTextEditor } from "@/components/ui/rich-text";
import { formatFrames } from "@/lib/shorts";
import { useStore } from "@/lib/store";
import type { Short, ShortFields, ShortsPlan, ThreeDNotes } from "@/lib/types";

/**
 * A 3D project's Shorts, or one short in it (0035). Both ask for a title, frames,
 * a description and the three notes. Shorts' frames are the whole project's; a
 * short's are its share of them, and going over is a warning, not a refusal.
 */
export function ShortFormModal({
  projectId,
  plan,
  short,
  nextNumber,
  onClose,
}: {
  projectId: string;
  /** The project's Shorts. Absent: setting them up. */
  plan?: ShortsPlan;
  /** "short" mode: present → edit, absent → add. */
  short?: Short | "new";
  /** What a new short will probably be numbered, to show in the title. */
  nextNumber?: number;
  onClose: () => void;
}) {
  const { db, saveShortsPlan, createShort, updateShort } = useStore();
  const isShort = short !== undefined;
  const editing: ShortFields | undefined = isShort ? (short === "new" ? undefined : short) : plan;

  const [title, setTitle] = useState(editing?.title ?? "");
  const [frames, setFrames] = useState(editing ? String(editing.frames) : "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [notes, setNotes] = useState<ThreeDNotes>({
    clientSupeNotes: editing?.clientSupeNotes ?? "",
    leadNote: editing?.leadNote ?? "",
    generalNotes: editing?.generalNotes ?? "",
  });
  const [touched, setTouched] = useState(false);

  const framesValue = Number(frames);
  const errors = {
    title: title.trim() ? undefined : "Give it a title.",
    frames:
      Number.isInteger(framesValue) && framesValue > 0
        ? undefined
        : "Enter the number of frames, a whole number above 0.",
  };

  // A short's share, against what the other shorts already have.
  const othersFrames = isShort
    ? db.shorts
        .filter((x) => x.projectId === projectId && (short === "new" || x.id !== short.id))
        .reduce((sum, x) => sum + x.frames, 0)
    : 0;
  const framesHint =
    isShort && plan
      ? (() => {
          const free = plan.frames - othersFrames;
          return free >= 0
            ? `Of the project's ${formatFrames(plan.frames)}; ${formatFrames(free)} not yet given to a short.`
            : `The project's ${formatFrames(plan.frames)} are already over-given by ${formatFrames(-free)}.`;
        })()
      : isShort
        ? undefined
        : "Every frame of the project's shorts together.";

  const save = () => {
    setTouched(true);
    if (errors.title || errors.frames) return;
    const input: ShortFields = { title: title.trim(), frames: framesValue, description, ...notes };
    if (!isShort) saveShortsPlan(projectId, input);
    else if (short === "new") createShort(projectId, input);
    else updateShort(short.id, input);
    onClose();
  };

  const heading = !isShort
    ? plan
      ? "Edit Shorts"
      : "Set up Shorts"
    : short === "new"
      ? `Add short SH${nextNumber ?? ""}`
      : `Edit SH${short.number}`;

  return (
    <Modal
      open
      onClose={onClose}
      title={heading}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            {editing ? "Save changes" : isShort ? "Add short" : "Set up Shorts"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Title"
            required
            htmlFor="short-title"
            className="sm:col-span-2"
            error={touched ? errors.title : undefined}
          >
            <Input
              id="short-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={isShort ? "e.g. Arrival sequence" : "e.g. Walkthrough reels"}
            />
          </Field>
          <Field
            label="Number of frames"
            required
            htmlFor="short-frames"
            hint={framesHint}
            error={touched ? errors.frames : undefined}
          >
            <Input
              id="short-frames"
              type="number"
              min="1"
              step="1"
              value={frames}
              onChange={(e) => setFrames(e.target.value)}
              placeholder={isShort ? "e.g. 300" : "e.g. 6000"}
            />
          </Field>
        </div>
        <Field label="Description">
          <RichTextEditor
            value={description}
            onChange={setDescription}
            placeholder={isShort ? "What this short shows…" : "What the shorts are for…"}
            minHeight={96}
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
