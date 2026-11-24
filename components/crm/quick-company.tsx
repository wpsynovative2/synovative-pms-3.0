"use client";

import { Button, Field, Input, Select } from "@/components/ui/primitives";
import type { CompanyInput } from "@/lib/store";
import { COMPANY_NATURES, type Company } from "@/lib/types";

/**
 * A company typed inside another form (client, property) instead of picked.
 * Only what is needed to tell it apart; GSTIN, address, owner and the rest
 * are filled in later from Companies.
 */
export interface QuickCompany {
  name: string;
  nature: string;
  city: string;
}

export const blankQuickCompany = (): QuickCompany => ({ name: "", nature: "", city: "" });

/** The same rule the full company form applies: names are unique, ignoring case. */
export const quickCompanyDuplicate = (q: QuickCompany, companies: Company[]) => {
  const name = q.name.trim().toLowerCase();
  return !!name && companies.some((c) => c.name.trim().toLowerCase() === name);
};

export const quickCompanyValid = (q: QuickCompany, companies: Company[]) =>
  !!q.name.trim() && !quickCompanyDuplicate(q, companies);

export const quickCompanyInput = (q: QuickCompany): CompanyInput => ({
  name: q.name.trim(),
  nature: q.nature,
  legalName: "",
  gstin: "",
  pan: "",
  reraPromoterId: "",
  address: "",
  city: q.city.trim(),
  website: "",
  phone: "",
  email: "",
  logoUrl: "",
  accountOwnerId: null,
  status: "active",
});

export function QuickCompanyFields({
  value,
  onChange,
  onCancel,
  companies,
  touched,
}: {
  value: QuickCompany;
  onChange: (next: QuickCompany) => void;
  onCancel: () => void;
  companies: Company[];
  touched: boolean;
}) {
  const duplicate = quickCompanyDuplicate(value, companies);
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line-soft bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium tracking-wide text-ink-muted uppercase">
          New company
        </span>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Pick an existing one instead
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label="Company name"
          required
          error={
            touched && !value.name.trim()
              ? "Required."
              : duplicate
                ? "Already exists — pick it from the list."
                : undefined
          }
        >
          <Input
            autoFocus
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            placeholder="e.g. Anant Developers"
          />
        </Field>
        <Field label="Nature">
          <Select
            value={value.nature}
            onChange={(e) => onChange({ ...value, nature: e.target.value })}
          >
            <option value="">Not set</option>
            {COMPANY_NATURES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="City">
          <Input
            value={value.city}
            onChange={(e) => onChange({ ...value, city: e.target.value })}
            placeholder="Mumbai"
          />
        </Field>
      </div>
      <p className="text-[11px] text-ink-faint">
        GSTIN, address and the rest can be filled in later from Companies.
      </p>
    </div>
  );
}
