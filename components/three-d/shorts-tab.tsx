"use client";

import { useMemo, useState } from "react";
import { DueDate, OverdueBadge, StatusBadge } from "@/components/task/task-bits";
import { TaskFormModal } from "@/components/task/task-form";
import { ThreeDNotesView } from "@/components/three-d/notes";
import { ShortFormModal } from "@/components/three-d/short-form";
import {
  ShortsFilters,
  applyShortsFilters,
  emptyShortsFilters,
  isFilteringShorts,
} from "@/components/three-d/shorts-filters";
import { ThreeDThumbnailHover } from "@/components/three-d/thumbnail";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconEdit,
  IconEye,
  IconEyeOff,
  IconPlay,
  IconPlus,
  IconTrash,
  IconWarning,
} from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/modal";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  ProgressBar,
  cx,
} from "@/components/ui/primitives";
import { RichText, isRichTextEmpty } from "@/components/ui/rich-text";
import {
  camsOf,
  formatFrames,
  framesUsed,
  camReadiness,
  describeTargets,
  type CamReadiness,
} from "@/lib/shorts";
import { useStore } from "@/lib/store";
import type { Project, Short, ShortFields, Task, TaskGroup } from "@/lib/types";

/** Where a dot is: everything done, some of it, or nothing yet. */
type DotState = "done" | "partial" | "idle";

const DOT_STYLE: Record<DotState, string> = {
  done: "border-st-approved bg-st-approved text-on-brand",
  partial: "border-brand-bright bg-surface text-brand-bright ring-4 ring-brand/15",
  idle: "border-line bg-surface-3 text-ink-faint",
};

const OVER_STYLE = "border-st-rejected/40 bg-st-rejected/15 text-st-rejected";

/**
 * A 3D project's Shorts (0035), drawn top to bottom like the CB journey: a dot
 * for each short, and under it a dot for each of its cams. A cam is a task, so it
 * opens in the usual drawer; it lights up once what it renders is approved.
 */
export function ShortsTab({
  project,
  groups,
  tasks,
  mayManage,
  onOpenTask,
}: {
  project: Project;
  /** The project's groups and sub-groups. */
  groups: TaskGroup[];
  /** Every standard task of the project, cams included. */
  tasks: Task[];
  mayManage: boolean;
  onOpenTask: (id: string) => void;
}) {
  const { db, deleteShort } = useStore();
  const plan = db.shortsPlans.find((p) => p.projectId === project.id);
  const shorts = useMemo(
    () =>
      db.shorts.filter((x) => x.projectId === project.id).sort((a, b) => a.number - b.number),
    [db.shorts, project.id],
  );

  const [editingPlan, setEditingPlan] = useState(false);
  /** "new" while adding one. */
  const [editingShort, setEditingShort] = useState<Short | "new" | null>(null);
  const [deleting, setDeleting] = useState<Short | null>(null);
  const [addingCamTo, setAddingCamTo] = useState<Short | null>(null);
  const [planNotes, setPlanNotes] = useState(false);
  const [filters, setFilters] = useState(emptyShortsFilters);

  const cams = tasks.filter((t) => !!t.shortId);
  const readyCount = cams.filter((c) => camReadiness(c, groups, tasks).ready).length;
  // The filters narrow what is listed; every count still covers all the cams.
  const filtering = isFilteringShorts(filters);
  const shownCams = filtering ? applyShortsFilters(cams, filters, groups, tasks) : cams;
  const shownCamIds = filtering ? new Set(shownCams.map((c) => c.id)) : undefined;
  const shownShorts = filtering
    ? shorts.filter((x) => shownCams.some((c) => c.shortId === x.id))
    : shorts;

  const modals = (
    <>
      {editingPlan ? (
        <ShortFormModal
          projectId={project.id}
          plan={plan}
          onClose={() => setEditingPlan(false)}
        />
      ) : null}
      {editingShort ? (
        <ShortFormModal
          projectId={project.id}
          plan={plan}
          short={editingShort}
          nextNumber={Math.max(0, ...shorts.map((x) => x.number)) + 1}
          onClose={() => setEditingShort(null)}
        />
      ) : null}
      {addingCamTo ? (
        <TaskFormModal
          open
          mode="project"
          project={project}
          defaultShortId={addingCamTo.id}
          onClose={() => setAddingCamTo(null)}
        />
      ) : null}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) deleteShort(deleting.id);
          setDeleting(null);
        }}
        title={deleting ? `Delete SH${deleting.number} ${deleting.title}?` : "Delete short?"}
        body={(() => {
          const n = deleting ? camsOf(deleting, tasks).length : 0;
          return n
            ? `This also deletes its ${n} cam${n === 1 ? "" : "s"}, with their time logs, submissions, reviews and remarks. This cannot be undone. Its number will not be used again.`
            : "Its number will not be used again.";
        })()}
      />
    </>
  );

  if (!plan) {
    return (
      <>
        <Card>
          <EmptyState
            icon={<IconPlay size={30} />}
            title="No Shorts yet"
            body={
              mayManage
                ? "Set up the project's Shorts with its total frames, then add shorts SH1, SH2 and their cams."
                : "The shorts for this project haven't been laid out yet."
            }
            action={
              mayManage ? (
                <Button variant="primary" onClick={() => setEditingPlan(true)}>
                  <IconPlus size={15} /> Set up Shorts
                </Button>
              ) : undefined
            }
          />
        </Card>
        {modals}
      </>
    );
  }

  const given = framesUsed(shorts);
  const over = given > plan.frames;

  return (
    <div className="flex flex-col gap-4">
      {cams.length ? (
        <ShortsFilters
          value={filters}
          onChange={setFilters}
          cams={cams}
          shorts={shorts}
          groups={groups}
          shown={shownCams.length}
        />
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
          <span className="flex min-w-48 flex-1 items-center gap-2">
            <IconPlay size={15} className="shrink-0 text-brand-ink" />
            <span className="truncate text-sm font-semibold text-ink">{plan.title}</span>
            <span className="shrink-0 text-[12px] text-ink-muted">
              {formatFrames(plan.frames)} frames
            </span>
          </span>

          <span className="flex w-52 items-center gap-2" title="Frames given to shorts">
            <ProgressBar
              value={(given / plan.frames) * 100}
              barClassName={over ? "bg-st-rejected" : undefined}
            />
            <span className={cx("shrink-0 text-[12px]", over ? "text-st-rejected" : "text-ink-muted")}>
              {formatFrames(given)}/{formatFrames(plan.frames)}
            </span>
          </span>
          {over ? (
            <Badge className={OVER_STYLE}>
              <IconWarning size={11} /> Over by {formatFrames(given - plan.frames)}
            </Badge>
          ) : null}
          <span className="text-[12px] text-ink-muted">
            {readyCount}/{cams.length} cam{cams.length === 1 ? "" : "s"} ready
          </span>

          <NotesButton of={plan} open={planNotes} onToggle={() => setPlanNotes((v) => !v)} />
          {mayManage ? (
            <>
              <IconButton label="Edit Shorts" onClick={() => setEditingPlan(true)}>
                <IconEdit size={14} />
              </IconButton>
              <Button size="sm" variant="primary" onClick={() => setEditingShort("new")}>
                <IconPlus size={13} /> Add short
              </Button>
            </>
          ) : null}
        </div>
        {planNotes ? (
          <div className="border-t border-line-soft px-4 py-3">
            <NotesPanel of={plan} />
          </div>
        ) : null}
      </Card>

      {shorts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconPlay size={30} />}
            title="No shorts yet"
            body={
              mayManage
                ? "Add the first short, SH1, then its cams: Cam1.1, Cam1.2 and so on."
                : "The shorts for this project haven't been laid out yet."
            }
          />
        </Card>
      ) : filtering && shownShorts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconPlay size={30} />}
            title="No cams match these filters"
            action={<Button onClick={() => setFilters(emptyShortsFilters)}>Clear filters</Button>}
          />
        </Card>
      ) : (
        <Card className="px-4 py-5">
          <ol aria-label="Shorts">
            {shownShorts.map((short, i) => (
              <ShortStep
                key={short.id}
                short={short}
                planFrames={plan.frames}
                last={i === shownShorts.length - 1}
                shownCamIds={shownCamIds}
                groups={groups}
                tasks={tasks}
                onOpenTask={onOpenTask}
                onAddCam={mayManage ? () => setAddingCamTo(short) : undefined}
                onEdit={mayManage ? () => setEditingShort(short) : undefined}
                onDelete={mayManage ? () => setDeleting(short) : undefined}
              />
            ))}
          </ol>
        </Card>
      )}

      {modals}
    </div>
  );
}

/** One short on the line: its dot, its details and its cams. */
function ShortStep({
  short,
  planFrames,
  last,
  shownCamIds,
  groups,
  tasks,
  onOpenTask,
  onAddCam,
  onEdit,
  onDelete,
}: {
  short: Short;
  planFrames: number;
  last: boolean;
  /** What the filters leave. Progress still counts every cam. */
  shownCamIds?: Set<string>;
  groups: TaskGroup[];
  tasks: Task[];
  onOpenTask: (id: string) => void;
  onAddCam?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const cams = camsOf(short, tasks);
  const targets = cams.map((c) => camReadiness(c, groups, tasks));
  const ready = targets.filter((t) => t.ready).length;
  const state: DotState =
    cams.length > 0 && ready === cams.length ? "done" : ready > 0 ? "partial" : "idle";
  const given = framesUsed(cams);
  const over = given > short.frames;
  const rows = cams
    .map((cam, i) => ({ cam, target: targets[i] }))
    .filter(({ cam }) => !shownCamIds || shownCamIds.has(cam.id));

  return (
    <li className="relative pb-6 pl-11 last:pb-0">
      {/* The line down to the next short, drawn from this dot's centre. */}
      {!last ? (
        <span
          aria-hidden
          className={cx(
            "absolute top-[38px] bottom-0 left-[15px] w-0.5",
            state === "done" ? "bg-st-approved" : "bg-line",
          )}
        />
      ) : null}
      <span
        className={cx(
          "absolute top-1.5 left-0 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border text-[11px] font-semibold",
          DOT_STYLE[state],
        )}
        aria-hidden
      >
        {state === "done" ? <IconCheck size={14} /> : `SH${short.number}`}
      </span>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border-l-4 border-l-tint-violet bg-brand-dim/70 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-h-8 min-w-48 flex-1 items-center gap-2 text-left"
        >
          {open ? (
            <IconChevronDown size={14} className="shrink-0 text-ink-faint" />
          ) : (
            <IconChevronRight size={14} className="shrink-0 text-ink-faint" />
          )}
          <span className="shrink-0 rounded-md bg-brand px-1.5 py-0.5 text-[12px] font-semibold text-on-brand">
            SH{short.number}
          </span>
          <span className="shrink-0 text-[10px] font-semibold tracking-wide text-tint-violet uppercase">
            Short
          </span>
          <span className="truncate text-sm font-semibold text-ink">{short.title}</span>
        </button>
        <span className="text-[12px] text-ink-muted">
          {formatFrames(short.frames)}/{formatFrames(planFrames)} frames
        </span>
        <span className="flex w-36 items-center gap-2" title="Cams ready to render">
          <ProgressBar
            value={cams.length ? (ready / cams.length) * 100 : 0}
            barClassName="bg-st-approved"
          />
          <span className="shrink-0 text-[12px] text-ink-muted">
            {ready}/{cams.length} ready
          </span>
        </span>
        {over ? (
          <Badge className={OVER_STYLE}>
            <IconWarning size={11} /> Cams over by {formatFrames(given - short.frames)}
          </Badge>
        ) : null}
        <NotesButton of={short} open={notesOpen} onToggle={() => setNotesOpen((v) => !v)} />
        {onEdit ? (
          <IconButton label={`Edit SH${short.number}`} onClick={onEdit}>
            <IconEdit size={14} />
          </IconButton>
        ) : null}
        {onDelete ? (
          <IconButton label={`Delete SH${short.number}`} onClick={onDelete}>
            <IconTrash size={14} />
          </IconButton>
        ) : null}
      </div>

      {notesOpen && !open ? (
        <div className="mt-2">
          <NotesPanel of={short} />
        </div>
      ) : null}
      {open ? (
        <div className="mt-2 flex flex-col gap-3">
          {notesOpen ? <NotesPanel of={short} /> : null}

          {rows.length ? (
            <ol aria-label={`Cams of SH${short.number}`} className="flex flex-col">
              {rows.map(({ cam, target }, i) => (
                <CamStep
                  key={cam.id}
                  cam={cam}
                  shortFrames={short.frames}
                  target={target}
                  last={i === rows.length - 1}
                  onOpen={() => onOpenTask(cam.id)}
                />
              ))}
            </ol>
          ) : (
            <p className="pl-6 text-[12px] text-ink-faint">No cams in this short yet.</p>
          )}

          {onAddCam ? (
            <Button size="sm" className="ml-6 self-start" onClick={onAddCam}>
              <IconPlus size={13} /> Add cam to SH{short.number}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** One cam under its short. Highlighted once it is ready to render. */
function CamStep({
  cam,
  shortFrames,
  target,
  last,
  onOpen,
}: {
  cam: Task;
  shortFrames: number;
  target: CamReadiness;
  last: boolean;
  onOpen: () => void;
}) {
  const { userById } = useStore();
  const assignee = userById(cam.assigneeId);
  const ready = target.ready;
  const state: DotState = ready ? "done" : target.approved > 0 ? "partial" : "idle";

  return (
    <li className="relative pb-2 pl-8 last:pb-0">
      {!last ? (
        <span
          aria-hidden
          className={cx(
            "absolute top-6 -bottom-0 left-[9px] w-0.5",
            ready ? "bg-st-approved" : "bg-line",
          )}
        />
      ) : null}
      <span
        aria-hidden
        className={cx(
          "absolute top-3 left-0 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full border",
          DOT_STYLE[state],
        )}
      >
        {ready ? <IconCheck size={11} /> : null}
      </span>

      <button
        type="button"
        onClick={onOpen}
        className={cx(
          "flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-left transition-colors",
          ready
            ? "border-st-approved/50 bg-st-approved/10 hover:bg-st-approved/15"
            : "border-tint-blue/30 bg-tint-blue/6 hover:bg-tint-blue/12",
        )}
      >
        <span className="shrink-0 rounded-md bg-tint-blue/15 px-1.5 py-0.5 text-[12px] font-semibold text-tint-blue">
          {cam.code}
        </span>
        {cam.thumbnailFileId ? (
          <ThreeDThumbnailHover
            key={cam.thumbnailFileId}
            fileId={cam.thumbnailFileId}
            alt=""
            className="block h-8 w-12 rounded border border-line object-cover"
          />
        ) : null}
        <span className="flex min-w-40 flex-1 flex-col">
          <span className="truncate text-[13px] text-ink">{cam.title}</span>
          <span className="truncate text-[11px] text-ink-faint">
            {formatFrames(cam.frames ?? 0)}/{formatFrames(shortFrames)} frames
            {" · "}
            Renders {describeTargets(target.targets)}
          </span>
        </span>
        {ready ? (
          <Badge className="border-st-approved/50 bg-st-approved/20 text-st-approved">
            <IconCheck size={11} /> Ready to render
          </Badge>
        ) : target.targets.length ? (
          <span className="text-[11px] text-ink-faint">
            {target.approved}/{target.total} approved
          </span>
        ) : null}
        {assignee ? (
          <span className="flex items-center gap-1.5 text-[12px] text-ink-muted">
            <Avatar name={assignee.fullName} size={20} />
            {assignee.fullName}
          </span>
        ) : (
          <span className="text-[12px] text-ink-faint">Nobody yet</span>
        )}
        <StatusBadge status={cam.status} task={cam} />
        <OverdueBadge task={cam} />
        <DueDate task={cam} />
      </button>
    </li>
  );
}

type WithNotes = Pick<ShortFields, "description" | "clientSupeNotes" | "leadNote" | "generalNotes">;

/** How many of the description and three notes have something in them. */
const filledNotes = (x: WithNotes) =>
  [x.description, x.clientSupeNotes, x.leadNote, x.generalNotes].filter(
    (v) => !isRichTextEmpty(v ?? ""),
  ).length;

/** Opens the description and notes, which stay out of the way until asked for. */
function NotesButton({
  of,
  open,
  onToggle,
}: {
  of: WithNotes;
  open: boolean;
  onToggle: () => void;
}) {
  const filled = filledNotes(of);
  if (!filled) return null;
  return (
    <Button size="sm" onClick={onToggle} aria-expanded={open}>
      {open ? <IconEyeOff size={13} /> : <IconEye size={13} />}
      {open ? " Hide notes" : ` View notes (${filled})`}
    </Button>
  );
}

function NotesPanel({ of }: { of: WithNotes }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line-soft bg-surface-2/60 px-4 py-3">
      {!isRichTextEmpty(of.description) ? (
        <div>
          <p className="text-[10px] font-medium tracking-wide text-ink-faint uppercase">
            Description
          </p>
          <RichText html={of.description} className="mt-0.5" />
        </div>
      ) : null}
      <ThreeDNotesView notes={of} />
    </div>
  );
}
