import type {
  ConfigStatus,
  ObcStatus,
  PartyStatus,
  Priority,
  ProjectStatus,
  TaskStatus,
} from "./types";

/** PRD §5.1 */
export const DEPARTMENTS = [
  "Graphic Designers",
  "Videographers / Video Editors / Motion Graphics",
  "Social Media Marketing",
  "Project Managers",
  "Performance Marketers",
  "3D Artists",
  "Website Developers",
  "Business Development Executives",
  "Inside Sales Executives",
  "Accounts & Finance",
  "Human Resources & Admin",
  "Content Writers / Copywriters / Brand Strategists",
] as const;

/** Department that approves expenses (§4.1, §8). */
export const FINANCE_DEPARTMENT = "Accounts & Finance";

/**
 * Two more departments carry rights of their own, the same way Finance does.
 * Business Development Executives keep the CRM master records; Content Writers
 * are the only people who may write in the Content Bank.
 */
export const BUSINESS_DEV_DEPARTMENT = "Business Development Executives";
export const CONTENT_WRITER_DEPARTMENT =
  "Content Writers / Copywriters / Brand Strategists";

/** PRD §5.2 — de-duplicated list. */
export const SERVICES = [
  "Social Media Management Services",
  "Facebook Ads Campaign",
  "Google Ads",
  "YouTube Ads",
  "Static Creative Design",
  "Video Editing",
  "Brochure Design and Conceptualization",
  "Drone Shoot and Edit",
  "Hosting",
  "Logo Design",
  "Website Design and Development",
  "Drone Rental",
  "Leads Automation",
  "Site Branding and Conceptualization",
  "Campaign Design",
  "Hoarding Printing and Installation",
  "Motion Graphics",
  "Hoarding Design and Conceptualization",
  "Hoarding Design and Edits",
  "SEO Service",
  "Brand PPT Creation",
  "Creative Post",
  "Festival and Event Creative",
  "Reel Editing",
  "Video Shoot & Editing",
  "Design and Conceptualization",
  "Storyboard Video",
  "Voice-Over",
  "Videography & Photography",
  "Channel Partner Kit",
  "Website Annual Renewal",
  "Domain",
  "Website Maintenance",
  "CP Meet Campaign",
  "Landing Page",
  "Social Account Setup",
  "Licensed Images",
  "Performance Marketing",
  "Influencer Artist",
  "3D Walkthrough Animation",
  "CGI Video",
  "Monthly Retainer",
  "Pamphlet Design",
  "Newspaper Insertion",
  "AI Video Production & Digital Presenter Creation",
  "Project Launch Campaign Design",
  "General Campaign Design",
  "Online Reputation Management (ORM)",
  "Bhoomi Pooja Event",
  "Corporate Brand Identity & Communication",
] as const;

/** PRD §5.3 */
export const PROJECT_STATUSES: ProjectStatus[] = [
  "Planning",
  "Active",
  "On Hold",
  "Completed",
  "Cancelled",
  "Archived",
];

/**
 * A standard working day. It is the default capacity for a new account, and
 * the fixed rate the estimate picker converts days and weeks at — so an
 * estimate means the same thing no matter who the task is assigned to.
 */
export const WORKDAY_HOURS = 8;

export const PRIORITIES: Priority[] = ["Low", "Medium", "High", "Critical"];

export const TASK_STATUSES: TaskStatus[] = [
  "Not Started",
  "In Progress",
  "Submitted",
  "Waiting for Client Response",
  "Changes Required",
  "Rejected",
  "Approved",
];

/** Statuses a reviewer sets; assignees can never select these (§9.4). */
export const REVIEWER_ONLY_STATUSES: TaskStatus[] = [
  "Approved",
  "Changes Required",
  "Rejected",
  "Waiting for Client Response",
];

interface StatusStyle {
  dot: string;
  chip: string;
  text: string;
  bar: string;
}

/** Status → Tailwind classes, keyed off the semantic tokens in globals.css. */
export const TASK_STATUS_STYLE: Record<TaskStatus, StatusStyle> = {
  "Not Started": {
    dot: "bg-st-notstarted",
    chip: "bg-st-notstarted/15 text-st-notstarted border-st-notstarted/30",
    text: "text-st-notstarted",
    bar: "bg-st-notstarted",
  },
  "In Progress": {
    dot: "bg-st-inprogress",
    chip: "bg-st-inprogress/15 text-st-inprogress border-st-inprogress/30",
    text: "text-st-inprogress",
    bar: "bg-st-inprogress",
  },
  Submitted: {
    dot: "bg-st-submitted",
    chip: "bg-st-submitted/15 text-st-submitted border-st-submitted/30",
    text: "text-st-submitted",
    bar: "bg-st-submitted",
  },
  "Changes Required": {
    dot: "bg-st-changes",
    chip: "bg-st-changes/15 text-st-changes border-st-changes/30",
    text: "text-st-changes",
    bar: "bg-st-changes",
  },
  Rejected: {
    dot: "bg-st-rejected",
    chip: "bg-st-rejected/15 text-st-rejected border-st-rejected/30",
    text: "text-st-rejected",
    bar: "bg-st-rejected",
  },
  Approved: {
    dot: "bg-st-approved",
    chip: "bg-st-approved/15 text-st-approved border-st-approved/30",
    text: "text-st-approved",
    bar: "bg-st-approved",
  },
  "Waiting for Client Response": {
    dot: "bg-st-waiting",
    chip: "bg-st-waiting/15 text-st-waiting border-st-waiting/30",
    text: "text-st-waiting",
    bar: "bg-st-waiting",
  },
};

export const PRIORITY_STYLE: Record<Priority, string> = {
  Low: "bg-pr-low/15 text-pr-low border-pr-low/30",
  Medium: "bg-pr-medium/15 text-pr-medium border-pr-medium/30",
  High: "bg-pr-high/15 text-pr-high border-pr-high/30",
  Critical: "bg-pr-critical/15 text-pr-critical border-pr-critical/30",
};

export const PROJECT_STATUS_STYLE: Record<ProjectStatus, string> = {
  Planning: "bg-st-notstarted/15 text-st-notstarted border-st-notstarted/30",
  Active: "bg-st-approved/15 text-st-approved border-st-approved/30",
  "On Hold": "bg-st-submitted/15 text-st-submitted border-st-submitted/30",
  Completed: "bg-st-inprogress/15 text-st-inprogress border-st-inprogress/30",
  Cancelled: "bg-st-rejected/15 text-st-rejected border-st-rejected/30",
  Archived: "bg-ink-faint/15 text-ink-faint border-ink-faint/30",
};

export const EXPENSE_STATUS_STYLE: Record<string, string> = {
  Pending: "bg-st-submitted/15 text-st-submitted border-st-submitted/30",
  Approved: "bg-st-approved/15 text-st-approved border-st-approved/30",
  Rejected: "bg-st-rejected/15 text-st-rejected border-st-rejected/30",
};

/* --------------------------------------------------------------- CRM --- */

/** Draft → Submitted → Converted, the OBC's whole life. */
export const OBC_STATUS_STYLE: Record<ObcStatus, string> = {
  Draft: "bg-ink-faint/15 text-ink-faint border-ink-faint/30",
  Submitted: "bg-st-submitted/15 text-st-submitted border-st-submitted/30",
  Converted: "bg-st-approved/15 text-st-approved border-st-approved/30",
};

export const PARTY_STATUS_STYLE: Record<PartyStatus, string> = {
  active: "bg-st-approved/15 text-st-approved border-st-approved/30",
  inactive: "bg-ink-faint/15 text-ink-faint border-ink-faint/30",
};

export const CONFIG_STATUS_STYLE: Record<ConfigStatus, string> = {
  Open: "bg-st-approved/15 text-st-approved border-st-approved/30",
  "Sold out": "bg-st-rejected/15 text-st-rejected border-st-rejected/30",
};

/**
 * The media folders "Create Directory" makes under a property. Changing this
 * list only affects properties whose directory has not been created yet.
 */
export const PROPERTY_MEDIA_FOLDERS = [
  "Property Brochure",
  "3D Walkthrough Video",
  "Drone Video",
] as const;

/** Preset project colours for the colour picker (§7.1). */
export const PROJECT_COLORS = [
  "#5F3CA7",
  "#7C55D6",
  "#4B8FE6",
  "#35B37E",
  "#E0A325",
  "#EC7C2A",
  "#E04B4B",
  "#D14FA0",
  "#2AA9B5",
  "#8B8299",
];
