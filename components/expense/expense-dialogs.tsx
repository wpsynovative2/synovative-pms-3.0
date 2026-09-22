"use client";

import { useMemo, useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { IconCheck, IconClose, IconWallet } from "@/components/ui/icons";
import { ButtonLoader, Loader } from "@/components/ui/loader";
import { Modal } from "@/components/ui/modal";
import { Button, Field, Input, cx } from "@/components/ui/primitives";
import { SearchSelect } from "@/components/ui/selects";
import { formatINR } from "@/lib/analytics";
import { formatDate, todayISO } from "@/lib/calendar";
import { useStore } from "@/lib/store";
import type { Expense, Project } from "@/lib/types";
import { uploadBill } from "@/lib/uploads";

/** Project Leader adds or edits an expense — only while it is Pending (§8). */
export function ExpenseFormModal({
  open,
  onClose,
  project,
  expense,
  projectOptions,
}: {
  open: boolean;
  onClose: () => void;
  /** Fixed project (from the project page), or null to choose one. */
  project: Project | null;
  expense?: Expense;
  projectOptions?: Project[];
}) {
  const { db, createExpense, updateExpense } = useStore();

  const [projectId, setProjectId] = useState(
    expense?.projectId ?? project?.id ?? projectOptions?.[0]?.id ?? "",
  );
  const [vendorId, setVendorId] = useState(expense?.vendorId ?? "");
  const [description, setDescription] = useState(expense?.description ?? "");
  const [amount, setAmount] = useState(expense ? String(expense.amount) : "");
  const [expenseDate, setExpenseDate] = useState(expense?.expenseDate ?? todayISO());
  const [attachment, setAttachment] = useState<{ name: string; url?: string } | null>(
    expense?.attachmentName
      ? { name: expense.attachmentName, url: expense.attachmentUrl }
      : null,
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      setAttachment(await uploadBill(file));
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };
  const [touched, setTouched] = useState(false);

  const vendorOptions = useMemo(
    () =>
      db.vendors.map((v) => ({
        value: v.id,
        label: v.name,
        hint: `${v.serviceType} · ${formatINR(v.rate)} typical`,
      })),
    [db.vendors],
  );

  const numericAmount = Number(amount);
  const errors = {
    projectId: !projectId ? "Pick a project." : undefined,
    vendorId: !vendorId ? "Pick a vendor." : undefined,
    description: !description.trim() ? "Describe the expense." : undefined,
    amount:
      !amount || Number.isNaN(numericAmount) || numericAmount <= 0
        ? "Enter an amount above zero."
        : undefined,
    expenseDate: !expenseDate ? "Pick the expense date." : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);

  const save = () => {
    setTouched(true);
    if (!valid || uploading) return;
    const payload = {
      projectId,
      vendorId,
      description: description.trim(),
      amount: numericAmount,
      expenseDate,
      attachmentName: attachment?.name,
      attachmentUrl: attachment?.url,
    };
    if (expense) updateExpense(expense.id, payload);
    else createExpense(payload);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={expense ? "Edit expense" : "Add project expense"}
      subtitle="Goes to Accounts & Finance for verification."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={uploading}>
            {uploading ? (
              <>
                <ButtonLoader /> Uploading…
              </>
            ) : expense ? (
              "Save changes"
            ) : (
              "Submit for verification"
            )}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {project ? (
          <Field label="Project">
            <div className="flex h-9.5 items-center gap-2 rounded-[10px] border border-line bg-surface-3 px-3 text-[13px] text-ink">
              <span
                className="h-2.5 w-2.5 rounded-[3px]"
                style={{ background: project.color }}
              />
              {project.name}
            </div>
          </Field>
        ) : (
          <Field label="Project" required error={touched ? errors.projectId : undefined}>
            <SearchSelect
              options={(projectOptions ?? db.projects).map((p) => ({
                value: p.id,
                label: p.name,
                hint: p.clientName,
              }))}
              value={projectId}
              onChange={setProjectId}
              placeholder="Which project is this for?"
            />
          </Field>
        )}

        <Field
          label="Vendor"
          required
          hint="From the Vendors directory."
          error={touched ? errors.vendorId : undefined}
        >
          <SearchSelect
            options={vendorOptions}
            value={vendorId}
            onChange={setVendorId}
            placeholder="Select a vendor"
          />
        </Field>

        <Field
          label="Expense description"
          required
          error={touched ? errors.description : undefined}
        >
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Drone video shoot — 2 days incl. edit-ready plates"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount (₹)" required error={touched ? errors.amount : undefined}>
            <Input
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="18000"
            />
          </Field>

          <Field label="Expense date" required error={touched ? errors.expenseDate : undefined}>
            <DatePicker
              value={expenseDate}
              onChange={setExpenseDate}
              config={db.calendar}
              ignoreWorkingRules
              allowPast
            />
          </Field>
        </div>

        <Field
          label="Bill / attachment"
          hint="Optional — an image or PDF up to 10 MB."
          error={uploadError ?? undefined}
        >
          <input
            type="file"
            accept="image/*,.pdf"
            disabled={uploading}
            onChange={(e) => void pickFile(e.target.files?.[0])}
            className="w-full rounded-[10px] border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink-muted file:mr-3 file:rounded-md file:border-0 file:bg-surface-3 file:px-3 file:py-1.5 file:text-[12px] file:text-ink hover:file:bg-brand/30"
          />
          {uploading ? (
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-faint">
              <Loader size={10} label="Uploading" /> Uploading…
            </p>
          ) : attachment ? (
            <p className="mt-1 flex items-center gap-2 text-[11px] text-ink-faint">
              Attached: <AttachmentLink name={attachment.name} url={attachment.url} />
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="text-st-rejected hover:underline"
              >
                Remove
              </button>
            </p>
          ) : null}
        </Field>
      </div>
    </Modal>
  );
}

/** Accounts & Finance verifies: approve, or reject with remarks. */
export function ExpenseReviewModal({
  open,
  onClose,
  expense,
}: {
  open: boolean;
  onClose: () => void;
  expense: Expense;
}) {
  const { reviewExpense, projectById, vendorById } = useStore();
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [remarks, setRemarks] = useState("");
  const [touched, setTouched] = useState(false);

  const project = projectById(expense.projectId);
  const vendor = vendorById(expense.vendorId);
  const remarksRequired = decision === "reject";
  const valid = !remarksRequired || remarks.trim().length > 0;

  const close = () => {
    setDecision("approve");
    setRemarks("");
    setTouched(false);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Verify expense"
      subtitle={`${formatINR(expense.amount)} · ${vendor?.name ?? "Unknown vendor"}`}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant={decision === "approve" ? "success" : "danger"}
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              reviewExpense(expense.id, decision === "approve", remarks.trim() || undefined);
              close();
            }}
          >
            {decision === "approve" ? (
              <>
                <IconCheck size={14} /> Approve
              </>
            ) : (
              <>
                <IconClose size={14} /> Reject
              </>
            )}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-st-submitted/15 text-st-submitted">
              <IconWallet size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">{expense.description}</p>
              <p className="mt-0.5 text-[11px] text-ink-faint">
                {project?.name ?? "Unknown project"} · {formatDate(expense.expenseDate)}
              </p>
              {expense.attachmentName ? (
                <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-surface-3 px-2 py-1 text-[11px] text-ink-muted">
                  <AttachmentLink name={expense.attachmentName} url={expense.attachmentUrl} />
                </p>
              ) : (
                <p className="mt-1.5 text-[11px] text-st-submitted">
                  No bill attached.
                </p>
              )}
            </div>
            <span className="shrink-0 font-mono text-[15px] text-ink">
              {formatINR(expense.amount)}
            </span>
          </div>
        </div>

        <Field label="Decision" required>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { id: "approve", label: "Approve", tone: "border-st-approved bg-st-approved/15" },
                { id: "reject", label: "Reject", tone: "border-st-rejected bg-st-rejected/15" },
              ] as const
            ).map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setDecision(o.id)}
                className={cx(
                  "rounded-xl border px-3 py-2.5 text-[13px] font-medium transition-colors",
                  decision === o.id
                    ? `${o.tone} text-ink`
                    : "border-line bg-surface-2 text-ink-muted hover:bg-surface-3",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="Finance remarks"
          required={remarksRequired}
          hint={remarksRequired ? undefined : "Optional on approval."}
          error={touched && !valid ? "Tell the project leader why this was rejected." : undefined}
        >
          <Input
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder={
              remarksRequired
                ? "e.g. Invoice is missing the GSTIN — get a revised copy."
                : "Anything worth noting"
            }
          />
        </Field>
      </div>
    </Modal>
  );
}

/** A bill attachment: opens the Cloudinary file when there is one. */
export function AttachmentLink({ name, url }: { name: string; url?: string }) {
  if (!url) return <span>📎 {name}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand-ink hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      📎 {name}
    </a>
  );
}
