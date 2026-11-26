/**
 * Invoices from Zoho Books (0009): what the sync asks Books for, and how one
 * invoice as Books returns it reads on screen.
 *
 * The database keeps each invoice exactly as Books sent it (`invoices.details`)
 * and this file is the only place that interprets it. Books leaves fields out
 * when they are empty and names a few differently by edition, so every read
 * here is defensive: a missing field shows as blank, never as an error.
 *
 * Shared by the server routes and the browser — nothing secret in here.
 */

import { daysBetween, todayISO } from "./calendar";

/* ------------------------------------------------------------------ sync */

/**
 * The views a sync reads, named as Books' Invoices filter menu names them.
 * `filterBy` is the list endpoint's `filter_by`, where Books has one: it
 * accepts Status.OverDue, Status.Unpaid and Status.PartiallyPaid but refuses
 * any filter_by for Pending Approval or Payment Initiated, so those are asked
 * for with the plain `status` parameter instead.
 */
export const SYNC_FILTERS: readonly { label: string; filterBy?: string; status: string }[] = [
  { label: "Pending Approval", status: "pending_approval" },
  { label: "Partially Paid", filterBy: "Status.PartiallyPaid", status: "partially_paid" },
  { label: "Unpaid", filterBy: "Status.Unpaid", status: "unpaid" },
  { label: "Overdue", filterBy: "Status.OverDue", status: "overdue" },
  { label: "Payment Initiated", status: "payment_initiated" },
];

/**
 * The statuses those views stand for. A sync keeps only invoices whose status
 * is one of these, so a filter Books quietly ignored (answering with every
 * invoice) cannot pull in paid, void or draft ones. The Unpaid view holds sent
 * invoices not yet paid, including ones the customer has viewed.
 */
export const SYNC_STATUSES: ReadonlySet<string> = new Set([
  "pending_approval",
  "partially_paid",
  "unpaid",
  "sent",
  "viewed",
  "overdue",
  "payment_initiated",
]);

/** One line of a sync's report: how many invoices a view held, or why it failed. */
export interface SyncFilterResult {
  label: string;
  count: number;
  error?: string;
}

/** A new invoice the sync found, before it is fetched in full. */
export interface SyncCandidate {
  zohoId: string;
  number: string;
  customer: string;
  status: string;
}

export interface SyncReport {
  filters: SyncFilterResult[];
  /** Distinct invoices across the views. */
  matched: number;
  alreadyHere: number;
  fresh: SyncCandidate[];
}

/** One invoice the import route was asked for. */
export type ImportResult =
  | { ref: string; ok: true; id: string; number: string; created: boolean }
  | { ref: string; ok: false; error: string };

/** How many invoices the import route takes per request, so each stays well inside a timeout. */
export const IMPORT_BATCH = 8;

/* ---------------------------------------------------------------- status */

export const INVOICE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  payment_initiated: "Payment Initiated",
  sent: "Sent",
  viewed: "Viewed",
  overdue: "Overdue",
  partially_paid: "Partially Paid",
  unpaid: "Unpaid",
  paid: "Paid",
  void: "Void",
};

export const invoiceStatusLabel = (status: string) =>
  INVOICE_STATUS_LABEL[status] ??
  (status ? status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—");

/** Badge classes for a status, from the theme's status tokens. */
export function invoiceStatusTone(status: string): string {
  switch (status) {
    case "paid":
      return "border-st-approved/30 bg-st-approved/15 text-st-approved";
    case "overdue":
      return "border-st-rejected/30 bg-st-rejected/15 text-st-rejected";
    case "partially_paid":
      return "border-st-changes/30 bg-st-changes/15 text-st-changes";
    case "sent":
    case "viewed":
    case "unpaid":
      return "border-st-inprogress/30 bg-st-inprogress/15 text-st-inprogress";
    case "pending_approval":
      return "border-st-submitted/30 bg-st-submitted/15 text-st-submitted";
    case "payment_initiated":
    case "approved":
      return "border-st-waiting/30 bg-st-waiting/15 text-st-waiting";
    default:
      return "border-line bg-surface-2 text-ink-muted";
  }
}

/** The statuses offered as a list filter, in the order Books shows them. */
export const INVOICE_STATUS_FILTERS = [
  "pending_approval",
  "approved",
  "sent",
  "viewed",
  "partially_paid",
  "unpaid",
  "overdue",
  "payment_initiated",
  "paid",
  "void",
  "draft",
];

/* -------------------------------------------------------------- customer */

/**
 * The line under a customer's Display Name: their Company Name and Primary
 * Contact, leaving out either when it only repeats the Display Name.
 */
export function customerSubline(i: { customerName: string; customerCompany: string; contactPerson: string }) {
  const same = (a: string) => a.trim().toLowerCase() === i.customerName.trim().toLowerCase();
  return [i.customerCompany, i.contactPerson].filter((x) => x && !same(x)).join(" · ");
}

/**
 * The company an invoice bills: Books' Company Name, or the Display Name when
 * the customer has none. Follow-ups filter and bulk-select by it, so one call
 * to a developer can be logged against all their unpaid invoices at once.
 */
export const invoiceCompany = (i: { customerName: string; customerCompany: string }) =>
  i.customerCompany.trim() || i.customerName.trim();

/** invoiceCompany as a key: the same company however Books capitalised it. */
export const invoiceCompanyKey = (i: { customerName: string; customerCompany: string }) =>
  invoiceCompany(i).toLowerCase();

/** Everything a customer search should match. */
export const customerSearchText = (i: { customerName: string; customerCompany: string; contactPerson: string }) =>
  [i.customerName, i.customerCompany, i.contactPerson];

/* ------------------------------------------------------------------- age */

/** Days from the invoice date to today; null for an invoice without a date. */
export function invoiceAgeDays(i: { invoiceDate: string | null }): number | null {
  if (!i.invoiceDate) return null;
  return Math.max(0, daysBetween(i.invoiceDate, todayISO()));
}

export const formatAge = (days: number | null) =>
  days === null ? "—" : `${days} Day${days === 1 ? "" : "s"}`;

/** The age filter's ranges, in days since the invoice date (both ends included). */
export const AGE_BUCKETS = [
  { id: "0-30", label: "0–30 days", min: 0, max: 30 },
  { id: "31-60", label: "31–60 days", min: 31, max: 60 },
  { id: "61-90", label: "61–90 days", min: 61, max: 90 },
  { id: "91-180", label: "91–180 days", min: 91, max: 180 },
  { id: "181+", label: "Over 180 days", min: 181, max: Infinity },
] as const;

/* -------------------------------------------------------------- grouping */

/**
 * Grouping by who the customer is. Grouping by status is a control of its own
 * (the statuses to group by are picked), and only one grouping applies at once.
 */
export type InvoiceGroupBy = "none" | "display" | "company" | "contact";
/** What a group is keyed by: one of the customer's names, or the status. */
export type InvoiceGroupKey = Exclude<InvoiceGroupBy, "none"> | "status";

export const INVOICE_GROUP_BY: { id: InvoiceGroupBy; label: string }[] = [
  { id: "none", label: "No grouping" },
  { id: "display", label: "Group by display name" },
  { id: "company", label: "Group by company name" },
  { id: "contact", label: "Group by primary contact" },
];

export interface InvoiceGroup<T> {
  key: string;
  label: string;
  invoices: T[];
}

/**
 * Invoices in groups, each keeping the list's own order. Groups run A–Z,
 * except status, which follows Books' order; blanks ("No company name") last.
 */
export function groupInvoices<
  T extends { customerName: string; customerCompany: string; contactPerson: string; status: string },
>(list: T[], by: InvoiceGroupKey): InvoiceGroup<T>[] {
  const empty = { display: "No display name", company: "No company name", contact: "No primary contact", status: "No status" }[by];
  const keyOf = (i: T) =>
    (by === "display" ? i.customerName : by === "company" ? i.customerCompany : by === "contact" ? i.contactPerson : i.status).trim();
  const groups = new Map<string, InvoiceGroup<T>>();
  for (const i of list) {
    const raw = keyOf(i);
    const key = raw.toLowerCase();
    const label = !raw ? empty : by === "status" ? invoiceStatusLabel(raw) : raw;
    const g = groups.get(key) ?? { key, label, invoices: [] };
    g.invoices.push(i);
    groups.set(key, g);
  }
  const order = (g: InvoiceGroup<T>) => (by === "status" ? INVOICE_STATUS_FILTERS.indexOf(g.key) : -1);
  return Array.from(groups.values()).sort((a, b) => {
    if (!a.key !== !b.key) return a.key ? -1 : 1;
    if (by === "status") {
      const x = order(a);
      const y = order(b);
      if (x !== y) return (x < 0 ? 99 : x) - (y < 0 ? 99 : y);
    }
    return a.label.localeCompare(b.label);
  });
}

/* ----------------------------------------------------------------- money */

/** Amounts to the paisa, as Books prints them: ₹16,992.00. */
export function formatMoney(n: number, currency = "INR"): string {
  const value = Number.isFinite(n) ? n : 0;
  const body = Math.abs(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const symbol = currency === "INR" ? "₹" : `${currency} `;
  return `${value < 0 ? "-" : ""}${symbol}${body}`;
}

/* ------------------------------------------------------------------- GST */

/** Books' gst_treatment codes, as its invoice form words them. */
const GST_TREATMENT: Record<string, string> = {
  business_gst: "Registered Business - Regular",
  business_registered_composition: "Registered Business - Composition",
  business_none: "Unregistered Business",
  consumer: "Consumer",
  overseas: "Overseas",
  business_sez: "Special Economic Zone",
  sez: "Special Economic Zone",
  sez_developer: "SEZ Developer",
  deemed_export: "Deemed Export",
  tax_deductor: "Tax Deductor",
  out_of_scope: "Out of Scope",
  non_gst_supply: "Non-GST Supply",
};

/** Place of supply arrives as a state code ("MH"); the form shows "[MH] - Maharashtra". */
const STATES: Record<string, string> = {
  AN: "Andaman and Nicobar Islands",
  AP: "Andhra Pradesh",
  AR: "Arunachal Pradesh",
  AS: "Assam",
  BR: "Bihar",
  CH: "Chandigarh",
  CG: "Chhattisgarh",
  DN: "Dadra and Nagar Haveli and Daman and Diu",
  DD: "Daman and Diu",
  DL: "Delhi",
  GA: "Goa",
  GJ: "Gujarat",
  HR: "Haryana",
  HP: "Himachal Pradesh",
  JK: "Jammu and Kashmir",
  JH: "Jharkhand",
  KA: "Karnataka",
  KL: "Kerala",
  LA: "Ladakh",
  LD: "Lakshadweep",
  MP: "Madhya Pradesh",
  MH: "Maharashtra",
  MN: "Manipur",
  ML: "Meghalaya",
  MZ: "Mizoram",
  NL: "Nagaland",
  OD: "Odisha",
  OR: "Odisha",
  PY: "Puducherry",
  PB: "Punjab",
  RJ: "Rajasthan",
  SK: "Sikkim",
  TN: "Tamil Nadu",
  TS: "Telangana",
  TG: "Telangana",
  TR: "Tripura",
  UP: "Uttar Pradesh",
  UK: "Uttarakhand",
  UT: "Uttarakhand",
  WB: "West Bengal",
};

/* ------------------------------------------------------------ the reader */

export interface InvoiceAddress {
  attention: string;
  lines: string[];
  phone: string;
}

export interface InvoiceLine {
  id: string;
  name: string;
  description: string;
  /** SAC for a service, HSN for goods. */
  code: string;
  kind: "Service" | "Goods" | "";
  quantity: number;
  unit: string;
  rate: number;
  /** "10%" or an amount, as entered in Books; "" for none. */
  discount: string;
  /** "GST18 [18%]" */
  tax: string;
  amount: number;
}

export interface InvoiceCharge {
  label: string;
  amount: number;
}

export interface InvoicePayment {
  id: string;
  number: string;
  date: string;
  mode: string;
  reference: string;
  amount: number;
}

export interface InvoiceDetails {
  number: string;
  status: string;
  /** Books' Display Name for the customer. */
  customerName: string;
  /** The customer's Primary Contact, first and last name. */
  contactPerson: string;
  date: string | null;
  dueDate: string | null;
  terms: string;
  orderNumber: string;
  subject: string;
  salesperson: string;
  currencyCode: string;
  gstTreatment: string;
  gstNo: string;
  placeOfSupply: string;
  billing: InvoiceAddress | null;
  shipping: InvoiceAddress | null;
  lines: InvoiceLine[];
  subTotal: number;
  /**
   * Everything between the sub total and the total, in Books' order: an
   * invoice discount, each tax (CGST, SGST or IGST), shipping, TDS (negative),
   * TCS, the adjustment and any rounding. Rows that are zero are left out,
   * except the adjustment, which the form always shows.
   */
  charges: InvoiceCharge[];
  total: number;
  paid: number;
  credits: number;
  writtenOff: number;
  balance: number;
  customerNotes: string;
  termsAndConditions: string;
  payments: InvoicePayment[];
  /** The customer-facing link Books generates, if it has one. */
  portalUrl: string;
  lastModified: string;
}

type Raw = Record<string, unknown>;

const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.map(obj) : []);

/** Text, treating Books' literal "null" (it writes that into empty notes) as nothing. */
function text(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return s === "null" || s === "undefined" ? "" : s;
}

function amount(v: unknown): number {
  if (typeof v === "number") return v;
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** The first of several names Books might use for one field. */
const firstText = (r: Raw, keys: string[]) => keys.map((k) => text(r[k])).find(Boolean) ?? "";
const firstAmount = (r: Raw, keys: string[]) => {
  for (const k of keys) if (r[k] !== undefined && r[k] !== null && r[k] !== "") return amount(r[k]);
  return 0;
};

const dateOrNull = (v: unknown) => {
  const s = text(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

function address(v: unknown): InvoiceAddress | null {
  const a = obj(v);
  const cityLine = [text(a.city), text(a.state), text(a.zip) || text(a.zipcode)]
    .filter(Boolean)
    .join(", ");
  const lines = [text(a.address), text(a.street2), cityLine, text(a.country)].filter(Boolean);
  const attention = text(a.attention);
  const phone = text(a.phone);
  return lines.length || attention ? { attention, lines, phone } : null;
}

function placeOfSupply(code: string): string {
  if (!code) return "";
  const name = STATES[code.toUpperCase()];
  return name ? `[${code.toUpperCase()}] - ${name}` : code;
}

function lineDiscount(l: Raw): string {
  const d = text(l.discount);
  if (d.endsWith("%")) return amount(d) ? d : "";
  const value = amount(l.discount_amount) || amount(d);
  return value ? String(value) : "";
}

function lineTax(l: Raw): string {
  const name = text(l.tax_name);
  const pct = text(l.tax_percentage);
  if (!name && !pct) return "";
  return pct && !name.includes("[") ? `${name || "Tax"} [${amount(pct)}%]` : name;
}

/** One invoice as Books returned it, read for the screen. */
export function readInvoice(raw: unknown): InvoiceDetails {
  const r = obj(raw);

  const lines: InvoiceLine[] = list(r.line_items).map((l, at) => {
    const kind = text(l.product_type).toLowerCase();
    return {
      id: text(l.line_item_id) || String(at),
      name: text(l.name) || text(l.item_name) || "Item",
      description: text(l.description),
      code: text(l.hsn_or_sac) || text(l.sac) || text(l.hsn),
      kind: kind === "service" ? "Service" : kind === "goods" ? "Goods" : "",
      quantity: amount(l.quantity),
      unit: text(l.unit),
      rate: amount(l.rate),
      discount: lineDiscount(l),
      tax: lineTax(l),
      amount: amount(l.item_total),
    };
  });

  const charges: InvoiceCharge[] = [];
  const add = (label: string, value: number, always = false) => {
    if (value || always) charges.push({ label, amount: value });
  };

  const discountTotal = firstAmount(r, ["discount_total"]);
  if (discountTotal) {
    const pct = text(r.discount_percent) || (text(r.discount).endsWith("%") ? text(r.discount) : "");
    add(pct ? `Discount [${amount(pct)}%]` : "Discount", -Math.abs(discountTotal));
  }
  for (const t of list(r.taxes)) {
    add(text(t.tax_name) || "Tax", amount(t.tax_amount));
  }
  add("Shipping charges", firstAmount(r, ["shipping_charge"]));

  const tds = firstAmount(r, ["tds_amount", "tds_total", "tax_amount_withheld"]);
  if (tds) add(firstText(r, ["tds_tax_name", "tds_name"]) || "TDS", -Math.abs(tds));
  const tcs = firstAmount(r, ["tcs_amount", "tcs_total"]);
  if (tcs) add(firstText(r, ["tcs_tax_name", "tcs_name"]) || "TCS", tcs);

  add(text(r.adjustment_description) || "Adjustment", firstAmount(r, ["adjustment"]), true);
  add("Rounding", firstAmount(r, ["roundoff_value", "rounding_off"]));

  const payments: InvoicePayment[] = list(r.payments).map((p, at) => ({
    id: text(p.payment_id) || String(at),
    number: text(p.payment_number),
    date: text(p.date).slice(0, 10),
    mode: text(p.payment_mode),
    reference: text(p.reference_number),
    amount: amount(p.amount),
  }));

  const treatment = text(r.gst_treatment);

  // The primary contact person, else the first listed.
  const people = list(r.contact_persons_details);
  const primary = people.find((p) => p.is_primary_contact === true) ?? people[0];
  const contactPerson = primary ? [text(primary.first_name), text(primary.last_name)].filter(Boolean).join(" ") : "";

  return {
    number: text(r.invoice_number),
    status: text(r.status),
    customerName: text(r.customer_name),
    contactPerson,
    date: dateOrNull(r.date),
    dueDate: dateOrNull(r.due_date),
    terms: firstText(r, ["payment_terms_label"]),
    orderNumber: text(r.reference_number),
    subject: firstText(r, ["subject_content", "subject"]),
    salesperson: text(r.salesperson_name),
    currencyCode: text(r.currency_code) || "INR",
    gstTreatment: GST_TREATMENT[treatment] ?? treatment,
    gstNo: text(r.gst_no),
    placeOfSupply: placeOfSupply(text(r.place_of_supply)),
    billing: address(r.billing_address),
    shipping: address(r.shipping_address),
    lines,
    subTotal: amount(r.sub_total),
    charges,
    total: amount(r.total),
    paid: amount(r.payment_made),
    credits: amount(r.credits_applied),
    writtenOff: amount(r.write_off_amount),
    balance: amount(r.balance),
    customerNotes: text(r.notes),
    termsAndConditions: text(r.terms),
    payments,
    portalUrl: text(r.invoice_url),
    lastModified: text(r.last_modified_time),
  };
}

/** The summary columns stored beside the full invoice, so the list never reads `details`. */
export function invoiceColumns(raw: unknown) {
  const d = readInvoice(raw);
  return {
    invoice_number: d.number,
    status: d.status,
    customer_name: d.customerName,
    contact_person: d.contactPerson,
    zoho_customer_id: text(obj(raw).customer_id),
    salesperson_name: d.salesperson,
    invoice_date: d.date,
    due_date: d.dueDate,
    currency_code: d.currencyCode,
    total: d.total,
    balance: d.balance,
  };
}

/* ------------------------------------------------------- contact persons */

/** One of a customer's contact persons, as customer_contacts stores it (0014). */
export interface ContactPersonRow {
  zohoContactPersonId: string;
  /** Books' Last Name, where this organisation keeps the whole name; else the First Name. */
  name: string;
  /** Empty when read from an invoice, which does not carry it. */
  designation: string;
  /** Work Phone and Mobile, comma separated. */
  phones: string;
  isPrimary: boolean;
}

/**
 * A Books contact-person list — the customer record's `contact_persons` or an
 * invoice's `contact_persons_details`, which share these fields — as rows.
 */
export function contactPersonRows(raw: unknown): ContactPersonRow[] {
  return list(raw)
    .map((p) => ({
      zohoContactPersonId: text(p.contact_person_id),
      name: text(p.last_name) || text(p.first_name) || "Contact",
      designation: text(p.designation),
      phones: joinPhones([text(p.phone), text(p.mobile)]),
      isPrimary: p.is_primary_contact === true,
    }))
    .filter((p) => p.zohoContactPersonId);
}

/** Numbers in the one comma-separated field, blanks and repeats left out. */
export function joinPhones(numbers: string[]): string {
  return Array.from(new Set(numbers.map((n) => n.trim()).filter(Boolean))).join(", ");
}

/** The numbers in a contact's phone field, one by one. */
export const splitPhones = (phones: string) =>
  phones
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
