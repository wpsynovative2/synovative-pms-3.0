"use client";

import { useMemo, useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import {
  IconCheck,
  IconClose,
  IconContent,
  IconLink,
  IconWarning,
  IconWhatsApp,
} from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { Badge, Button, Field, Input, cx } from "@/components/ui/primitives";
import { RichTextEditor, isRichTextEmpty } from "@/components/ui/rich-text";
import { SearchSelect } from "@/components/ui/selects";
import { CONTENT_STAGE_STYLE } from "@/lib/master-data";
import { useStore } from "@/lib/store";
import {
  contentLabel,
  type ContentEntry,
  type OutputLocation,
  type ReviewDecision,
  type ReviewSource,
  type Task,
} from "@/lib/types";

/* ------------------------------------------------------- Pause dialog */

/** §11.2 — the two ways a running timer can stop without submitting. */
export function PauseDialog({
  open,
  onClose,
  task,
}: {
  open: boolean;
  onClose: () => void;
  task: Task;
}) {
  const { db, currentUser, pauseTimer, switchTimer } = useStore();
  const [mode, setMode] = useState<"choose" | "switch">("choose");
  const [projectId, setProjectId] = useState("");
  const [targetTaskId, setTargetTaskId] = useState("");

  const reset = () => {
    setMode("choose");
    setProjectId("");
    setTargetTaskId("");
  };

  const close = () => {
    reset();
    onClose();
  };

  // Only the user's own open tasks are valid switch targets.
  const myOpenTasks = useMemo(
    () =>
      db.tasks.filter(
        (t) =>
          t.assigneeId === currentUser?.id &&
          t.id !== task.id &&
          t.status !== "Approved" &&
          t.status !== "Submitted" &&
          t.status !== "Waiting for Client Response",
      ),
    [db.tasks, currentUser?.id, task.id],
  );

  const switchableProjects = useMemo(() => {
    const ids = new Set(myOpenTasks.map((t) => t.projectId ?? "individual"));
    const options = db.projects
      .filter((p) => ids.has(p.id))
      .map((p) => ({ value: p.id, label: p.name, hint: p.clientName }));
    if (ids.has("individual")) {
      options.push({
        value: "individual",
        label: "Individual tasks",
        hint: "No parent project",
      });
    }
    return options;
  }, [db.projects, myOpenTasks]);

  const targetOptions = useMemo(
    () =>
      myOpenTasks
        .filter((t) =>
          projectId === "individual"
            ? t.projectId === null
            : t.projectId === projectId,
        )
        .map((t) => ({ value: t.id, label: t.title, hint: t.status })),
    [myOpenTasks, projectId],
  );

  return (
    <Modal
      open={open}
      onClose={close}
      title="Pause the timer"
      subtitle={task.title}
      size="md"
      footer={
        mode === "switch" ? (
          <>
            <Button onClick={() => setMode("choose")}>Back</Button>
            <Button
              variant="primary"
              disabled={!targetTaskId}
              onClick={() => {
                switchTimer(task.id, targetTaskId);
                close();
              }}
            >
              Stop here &amp; start there
            </Button>
          </>
        ) : null
      }
    >
      {mode === "choose" ? (
        <div className="flex flex-col gap-3">
          <button
            onClick={() => {
              pauseTimer(task.id);
              close();
            }}
            className="rounded-xl border border-line bg-surface-2 p-4 text-left transition-colors hover:border-brand-bright/50 hover:bg-surface-3"
          >
            <div className="text-[13px] font-semibold text-ink">Done for the day</div>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
              This session stops with the reason <em>End of day</em>. The task stays
              <span className="text-st-inprogress"> In Progress (Paused)</span> and you
              pick it back up on the next working day.
            </p>
          </button>

          <button
            onClick={() => setMode("switch")}
            className="rounded-xl border border-line bg-surface-2 p-4 text-left transition-colors hover:border-brand-bright/50 hover:bg-surface-3"
          >
            <div className="text-[13px] font-semibold text-ink">
              Working on a different project
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
              Pick the project and the task you are moving to. This session stops with
              the reason <em>Switched</em>, and the new task&apos;s timer starts
              immediately.
            </p>
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Project" required>
            <SearchSelect
              options={switchableProjects}
              value={projectId}
              onChange={(v) => {
                setProjectId(v);
                setTargetTaskId("");
              }}
              placeholder="Which project are you moving to?"
            />
          </Field>

          <Field
            label="Task"
            required
            hint="Only tasks assigned to you are listed."
          >
            <SearchSelect
              options={targetOptions}
              value={targetTaskId}
              onChange={setTargetTaskId}
              placeholder={projectId ? "Select a task" : "Pick a project first"}
              disabled={!projectId}
            />
          </Field>

          {projectId && targetOptions.length === 0 ? (
            <p className="flex items-center gap-2 rounded-lg border border-st-submitted/30 bg-st-submitted/10 px-3 py-2 text-[12px] text-st-submitted">
              <IconWarning size={14} /> You have no open tasks in that project.
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------ Submit dialog */

/** §12.1 — submission form. The timer stops and the task becomes Submitted. */
export function SubmitDialog({
  open,
  onClose,
  task,
}: {
  open: boolean;
  onClose: () => void;
  task: Task;
}) {
  const { db, submitTask } = useStore();
  /*
   * A content task is delivered as its pieces in the Content Bank (0013): the
   * submission carries a link to each one, and every piece the task asked for
   * must have a status first - extras need not.
   */
  const isBatch = task.kind === "content";
  const pieces = isBatch
    ? db.contentEntries
        .filter((e) => e.taskId === task.id)
        .sort(
          (a, b) =>
            (a.slot ?? Number.MAX_SAFE_INTEGER) - (b.slot ?? Number.MAX_SAFE_INTEGER) ||
            a.createdAt.localeCompare(b.createdAt),
        )
    : [];
  const unset = pieces.filter((e) => e.slot !== null && !e.stage);

  const [location, setLocation] = useState<OutputLocation>(
    isBatch ? "Content Bank" : "Google Drive",
  );
  const [link, setLink] = useState("");
  const [description, setDescription] = useState("");
  const [touched, setTouched] = useState(false);

  const linkValid = /^https?:\/\/\S+$/i.test(link.trim());
  const needsLink = location === "Google Drive";
  const descriptionOk = isBatch || !isRichTextEmpty(description);
  const valid = descriptionOk && (!needsLink || linkValid) && unset.length === 0;

  const close = () => {
    setLocation(isBatch ? "Content Bank" : "Google Drive");
    setLink("");
    setDescription("");
    setTouched(false);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Submit for review"
      subtitle={task.title}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            disabled={unset.length > 0}
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              submitTask(task.id, {
                outputLocation: location,
                driveLink: needsLink ? link.trim() : undefined,
                description,
                links: isBatch
                  ? pieces.map((e) => `${window.location.origin}/content-bank?entry=${e.id}`)
                  : undefined,
              });
              close();
            }}
          >
            Stop timer &amp; submit
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {isBatch ? (
          <ContentBankOutput pieces={pieces} unset={unset} />
        ) : (
        <Field label="Where is the output?" required>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { id: "Google Drive", icon: <IconLink size={15} />, hint: "Link + description" },
                { id: "WhatsApp", icon: <IconWhatsApp size={15} />, hint: "Description only" },
              ] as const
            ).map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setLocation(o.id)}
                className={cx(
                  "flex flex-col gap-1 rounded-xl border p-3 text-left transition-colors",
                  location === o.id
                    ? "border-brand-bright bg-brand/15"
                    : "border-line bg-surface-2 hover:bg-surface-3",
                )}
              >
                <span className="flex items-center gap-2 text-[13px] font-medium text-ink">
                  {o.icon} {o.id}
                </span>
                <span className="text-[11px] text-ink-faint">{o.hint}</span>
              </button>
            ))}
          </div>
        </Field>
        )}

        {needsLink ? (
          <Field
            label="Google Drive link"
            required
            error={touched && !linkValid ? "Enter a valid https:// link." : undefined}
          >
            <Input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/…"
              spellCheck={false}
            />
          </Field>
        ) : null}

        <Field
          label="Description"
          required={!isBatch}
          hint={isBatch ? "Optional — the links already say what was delivered." : undefined}
          error={
            touched && !descriptionOk ? "Tell the reviewer what you delivered." : undefined
          }
        >
          <RichTextEditor
            value={description}
            onChange={setDescription}
            placeholder="What did you deliver? Anything the reviewer should know?"
          />
        </Field>
      </div>
    </Modal>
  );
}

/**
 * What a content task hands over: every piece, linked, with its status. The
 * pieces the task asked for must each have a status before it can go.
 */
function ContentBankOutput({
  pieces,
  unset,
}: {
  pieces: ContentEntry[];
  unset: ContentEntry[];
}) {
  return (
    <Field label="Output" hint="A link to each piece goes to the reviewer with the submission.">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 rounded-xl border border-brand-bright bg-brand/15 p-3 text-[13px] font-medium text-ink">
          <IconContent size={15} /> Content Bank
          <span className="ml-auto text-[11px] font-normal text-ink-faint">
            {pieces.length} piece{pieces.length === 1 ? "" : "s"}
          </span>
        </div>
        {unset.length ? (
          <p className="rounded-lg border border-st-rejected/30 bg-st-rejected/10 px-3 py-2 text-[12px] leading-relaxed text-st-rejected">
            Give every piece a status before submitting. Still not set:{" "}
            {unset.map((e) => contentLabel(e)).join(", ")}.
          </p>
        ) : null}
        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
          {pieces.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[12px]"
            >
              <span className="min-w-0 flex-1 truncate text-ink">{contentLabel(e)}</span>
              {e.stage ? (
                <Badge className={CONTENT_STAGE_STYLE[e.stage]}>{e.stage}</Badge>
              ) : e.slot !== null ? (
                <Badge className="border-st-rejected/30 bg-st-rejected/15 text-st-rejected">
                  Not set
                </Badge>
              ) : (
                <span className="text-[11px] text-ink-faint">extra</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Field>
  );
}

/* ------------------------------------------------------ Review dialog */

/**
 * §12.2 — Approve / Changes Required / Reject (which reassigns), plus
 * "Waiting for Client Response", which parks the task until the client
 * answers and leaves it for the same reviewer to settle.
 */
export function ReviewDialog({
  open,
  onClose,
  task,
}: {
  open: boolean;
  onClose: () => void;
  task: Task;
}) {
  const { db, reviewTask, projectById } = useStore();
  const [decision, setDecision] = useState<ReviewDecision>("Approved");
  const [source, setSource] = useState<ReviewSource>("Client");
  const [remarks, setRemarks] = useState("");
  const [department, setDepartment] = useState(task.department);
  const [newAssigneeId, setNewAssigneeId] = useState(task.assigneeId ?? "");
  const [newDueDate, setNewDueDate] = useState(task.dueDate);
  const [touched, setTouched] = useState(false);

  const project = task.projectId ? projectById(task.projectId) : null;

  const assigneeOptions = useMemo(
    () =>
      db.users
        .filter((u) => u.active && u.departments.includes(department))
        .map((u) => ({
          value: u.id,
          label: u.fullName,
          hint: u.email,
          avatarName: u.fullName,
        })),
    [db.users, department],
  );

  const remarksOk = !isRichTextEmpty(remarks);
  const rejectOk = decision !== "Rejected" || !!newAssigneeId;
  const valid = remarksOk && rejectOk;

  const close = () => {
    setDecision("Approved");
    setSource("Client");
    setRemarks("");
    setDepartment(task.department);
    setNewAssigneeId(task.assigneeId ?? "");
    setNewDueDate(task.dueDate);
    setTouched(false);
    onClose();
  };

  const options: { id: ReviewDecision; blurb: string; tone: string }[] = [
    {
      id: "Approved",
      blurb: "Accepted — the task is complete.",
      tone: "border-st-approved bg-st-approved/15",
    },
    {
      id: "Waiting for Client Response",
      blurb: "Sent to the client — come back once they reply.",
      tone: "border-st-waiting bg-st-waiting/15",
    },
    {
      id: "Changes Required",
      blurb: "Back to the same assignee for rework.",
      tone: "border-st-changes bg-st-changes/15",
    },
    {
      id: "Rejected",
      blurb: "Reassign the task and reset it to Not Started.",
      tone: "border-st-rejected bg-st-rejected/15",
    },
  ];

  return (
    <Modal
      open={open}
      onClose={close}
      title="Review submission"
      subtitle={task.title}
      size="md"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant={decision === "Approved" ? "success" : "primary"}
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              reviewTask(task.id, {
                decision,
                // Neither an approval nor a hand-off to the client is
                // feedback, so neither carries a source.
                source:
                  decision === "Approved" || decision === "Waiting for Client Response" ? undefined : source,
                remarks,
                newAssigneeId: decision === "Rejected" ? newAssigneeId : undefined,
                newDueDate: decision === "Rejected" ? newDueDate : undefined,
              });
              close();
            }}
          >
            {decision === "Approved" ? (
              <>
                <IconCheck size={14} /> Approve
              </>
            ) : decision === "Waiting for Client Response" ? (
              "Park with the client"
            ) : decision === "Changes Required" ? (
              "Send back for changes"
            ) : (
              <>
                <IconClose size={14} /> Reject &amp; reassign
              </>
            )}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Decision" required>
          <div className="grid gap-2 sm:grid-cols-2">
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setDecision(o.id)}
                className={cx(
                  "rounded-xl border p-3 text-left transition-colors",
                  decision === o.id
                    ? o.tone
                    : "border-line bg-surface-2 hover:bg-surface-3",
                )}
              >
                <div className="text-[13px] font-medium text-ink">{o.id}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-ink-muted">
                  {o.blurb}
                </div>
              </button>
            ))}
          </div>
        </Field>

        {decision !== "Approved" && decision !== "Waiting for Client Response" ? (
          <Field label="Source of the feedback" required>
            <div className="flex gap-2">
              {(["Client", "Project Leader"] as ReviewSource[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSource(s)}
                  className={cx(
                    "flex-1 rounded-[10px] border px-3 py-2 text-[13px] transition-colors",
                    source === s
                      ? "border-brand-bright bg-brand/15 text-ink"
                      : "border-line bg-surface-2 text-ink-muted hover:bg-surface-3",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </Field>
        ) : null}

        <Field
          label="Remarks"
          required
          error={touched && !remarksOk ? "Remarks are required." : undefined}
        >
          <RichTextEditor
            value={remarks}
            onChange={setRemarks}
            placeholder={
              decision === "Approved"
                ? "Anything worth noting for the record?"
                : decision === "Waiting for Client Response"
                  ? "What was sent to the client, and what are we waiting on?"
                  : "What exactly needs to change?"
            }
          />
        </Field>

        {decision === "Rejected" ? (
          <div className="flex flex-col gap-4 rounded-xl border border-st-rejected/25 bg-st-rejected/8 p-4">
            <p className="text-[12px] leading-relaxed text-ink-muted">
              Rejecting reassigns the task and resets it to{" "}
              <span className="text-st-notstarted">Not Started</span>. All earlier
              submissions, reviews and time logs stay in the task history.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Department">
                <SearchSelect
                  options={db.departments.map((dpt) => ({ value: dpt, label: dpt }))}
                  value={department}
                  onChange={(v) => {
                    setDepartment(v);
                    setNewAssigneeId("");
                  }}
                />
              </Field>

              <Field
                label="New assignee"
                required
                hint="Can be the same person."
                error={touched && !rejectOk ? "Pick who takes this on." : undefined}
              >
                <SearchSelect
                  options={assigneeOptions}
                  value={newAssigneeId}
                  onChange={setNewAssigneeId}
                  placeholder="Select a team member"
                />
              </Field>
            </div>

            <Field label="Revised due date" hint="Leave as-is to keep the current date.">
              <DatePicker
                value={newDueDate}
                onChange={setNewDueDate}
                config={db.calendar}
                min={project?.startDate}
                max={project?.deadline}
              />
            </Field>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
