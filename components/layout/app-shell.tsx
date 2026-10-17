"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconBell,
  IconChip,
  IconCrane,
  IconCalendar,
  IconChart,
  IconChevronDown,
  IconChevronLeft,
  IconClock,
  IconContact,
  IconContent,
  IconDashboard,
  IconGlobe,
  IconLink,
  IconLogout,
  IconMenu,
  IconPause,
  IconProjects,
  IconProperty,
  IconQuote,
  IconRepeat,
  IconSend,
  IconTasks,
  IconTemplate,
  IconTruck,
  IconUser,
  IconUsers,
  IconWallet,
} from "@/components/ui/icons";
import { Avatar, cx } from "@/components/ui/primitives";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { FirstSignInPassword } from "./first-sign-in";
import { relativeTime } from "@/lib/calendar";
import { navGate } from "@/lib/permissions";
import { useStore } from "@/lib/store";
import { usePersistentFlag } from "@/lib/use-persistent-flag";
import { findRunningTaskForUser, formatClock, taskElapsedMs } from "@/lib/time";
import { ROLE_LABEL, type User } from "@/lib/types";
import { PauseDialog, SubmitDialog } from "@/components/task/task-dialogs";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  show: boolean;
  /** The sidebar section it sits under; none for Dashboard, which leads. */
  group?: NavGroup;
}

/** Sidebar sections, in the order they appear. */
type NavGroup = "Work" | "CRM" | "Operations" | "Insights" | "Admin";

/** Each section's header icon. */
const GROUP_ICON: Record<NavGroup, React.ReactNode> = {
  Work: <IconTasks size={18} />,
  CRM: <IconCrane size={18} />,
  Operations: <IconGlobe size={18} />,
  Insights: <IconChart size={18} />,
  Admin: <IconUser size={18} />,
};

/** Items grouped by section, keeping their order; a section nobody can see is dropped. */
function groupNav(items: NavItem[]) {
  const sections: { group: NavGroup | null; items: NavItem[] }[] = [];
  for (const item of items) {
    const group = item.group ?? null;
    const last = sections[sections.length - 1];
    if (last && last.group === group) last.items.push(item);
    else sections.push({ group, items: [item] });
  }
  return sections;
}

function useNavItems(user: User): NavItem[] {
  const gate = navGate(user);
  return ([
    {
      href: "/dashboard",
      label: "Dashboard",
      icon: <IconDashboard size={18} />,
      show: true,
    },
    {
      href: "/projects",
      label: "Projects",
      icon: <IconProjects size={18} />,
      show: gate.projects,
      group: "Work",
    },
    {
      href: "/tasks",
      label: "Tasks",
      icon: <IconTasks size={18} />,
      show: gate.tasks,
      group: "Work",
    },
    {
      href: "/recurrence",
      label: "Recurrence",
      icon: <IconRepeat size={18} />,
      show: gate.recurrence,
      group: "Work",
    },
    {
      href: "/content-bank",
      label: "Content Bank",
      icon: <IconContent size={18} />,
      show: gate.contentBank,
      group: "Work",
    },
    {
      href: "/templates",
      label: "Templates",
      icon: <IconTemplate size={18} />,
      show: gate.templates,
      group: "Work",
    },
    {
      href: "/companies",
      label: "Companies",
      icon: <IconCrane size={18} />,
      show: gate.companies,
      group: "CRM",
    },
    {
      href: "/clients",
      label: "Clients",
      icon: <IconContact size={18} />,
      show: gate.clients,
      group: "CRM",
    },
    {
      href: "/properties",
      label: "Properties",
      icon: <IconProperty size={18} />,
      show: gate.properties,
      group: "CRM",
    },
    {
      href: "/obcs",
      label: "New OBCs",
      icon: <IconQuote size={18} />,
      show: gate.obcs,
      group: "CRM",
    },
    {
      href: "/websites",
      label: "Websites",
      icon: <IconGlobe size={18} />,
      show: gate.websites,
      group: "Operations",
    },
    {
      href: "/links",
      label: "Operational Links",
      icon: <IconLink size={18} />,
      show: gate.links,
      group: "Operations",
    },
    {
      href: "/vendors",
      label: "Vendors",
      icon: <IconTruck size={18} />,
      show: gate.vendors,
      group: "Operations",
    },
    {
      href: "/expenses",
      label: "Expenses",
      icon: <IconWallet size={18} />,
      show: gate.expenses,
      group: "Operations",
    },
    {
      href: "/workload",
      label: "Workload",
      icon: <IconUsers size={18} />,
      show: gate.workload,
      group: "Insights",
    },
    {
      href: "/reports",
      label: "Reports",
      icon: <IconChart size={18} />,
      show: gate.reports,
      group: "Insights",
    },
    {
      href: "/inventory",
      label: "System Inventory",
      icon: <IconChip size={18} />,
      show: gate.inventory,
      group: "Admin",
    },
    {
      href: "/calendar",
      label: "Working Calendar",
      icon: <IconCalendar size={18} />,
      show: gate.calendar,
      group: "Admin",
    },
    {
      href: "/users",
      label: "Users",
      icon: <IconUser size={18} />,
      show: gate.users,
      group: "Admin",
    },
    {
      href: "/master-data",
      label: "Departments & Services",
      icon: <IconTemplate size={18} />,
      show: gate.masterData,
      group: "Admin",
    },
  ] satisfies NavItem[]).filter((i) => i.show);
}

/**
 * The Synovative wordmark, in the colourway each theme was drawn for: violet
 * on light, yellow on dark. Both files ship and CSS picks one, so the right
 * one is on screen at first paint with no flash and no JavaScript.
 *
 * Both images are decorative; the name lives on the wrapper, so a screen
 * reader hears it once rather than twice.
 */
function BrandWordmark() {
  return (
    <span role="img" aria-label="Synovative" className="min-w-0">
      <Image
        src="/Synovative-logo-Violet.png"
        alt=""
        width={2730}
        height={560}
        className="h-7 w-auto dark:hidden"
        priority
      />
      <Image
        src="/Synovative-logo-yellow.png"
        alt=""
        width={499}
        height={104}
        className="hidden h-7 w-auto dark:block"
        priority
      />
    </span>
  );
}

/* --------------------------------------------------------------- Sidebar */

function Sidebar({
  user,
  collapsed,
  onToggle,
  mobileOpen,
  onMobileClose,
}: {
  user: User;
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const pathname = usePathname();
  const items = useNavItems(user);
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  // Sections open and close on a click, and stay as the user left them. The
  // one holding the current page is always open, so the active item shows.
  const activeGroup = items.find((i) => isActive(i.href))?.group ?? null;
  const [opened, setOpened] = useState<NavGroup[]>([]);
  const [closed, setClosed] = useState<NavGroup[]>([]);
  const isOpen = (g: NavGroup) =>
    opened.includes(g) || (g === activeGroup && !closed.includes(g));
  const toggle = (g: NavGroup) => {
    if (isOpen(g)) {
      setOpened((list) => list.filter((x) => x !== g));
      setClosed((list) => [...list.filter((x) => x !== g), g]);
    } else {
      setClosed((list) => list.filter((x) => x !== g));
      setOpened((list) => [...list.filter((x) => x !== g), g]);
    }
  };

  const renderItem = (item: NavItem) => (
    <Link
      key={item.href}
      href={item.href}
      onClick={onMobileClose}
      title={collapsed ? item.label : undefined}
      className={cx(
        "flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[13px] font-medium transition-colors",
        collapsed && "justify-center px-0",
        isActive(item.href)
          ? "bg-brand text-white shadow-lg shadow-brand/25"
          : "text-ink-muted hover:bg-surface-2 hover:text-ink",
      )}
    >
      <span className="shrink-0">{item.icon}</span>
      {!collapsed ? <span className="truncate">{item.label}</span> : null}
    </Link>
  );

  const content = (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cx(
          "flex items-center gap-2.5 px-3 py-4",
          collapsed && "flex-col justify-center gap-2 px-0",
        )}
      >
        {collapsed ? (
          // The wordmark has nowhere to go in a collapsed rail, so the square
          // mark — the same one used as the favicon — stands in for it.
          <Image
            src="/Synovative-mark.png"
            alt="Synovative"
            width={256}
            height={256}
            className="h-9 w-9 shrink-0"
            priority
          />
        ) : (
          <BrandWordmark />
        )}
        {/* Desktop only: below lg the sidebar is a drawer with its own close. */}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cx(
            "hidden h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface-2 text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink lg:inline-flex",
            !collapsed && "ml-auto",
          )}
        >
          <IconChevronLeft
            size={15}
            className={cx("transition-transform", collapsed && "rotate-180")}
          />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {groupNav(items).map((section, si) => {
          const { group } = section;
          // The collapsed rail has no headers to hover, so every icon shows.
          if (!group || collapsed) {
            return (
              <div key={group ?? "top"} className={cx("space-y-0.5", si > 0 && "mt-3")}>
                {group ? (
                  <div aria-hidden className="mx-3 mb-2 border-t border-line-soft" />
                ) : null}
                {section.items.map(renderItem)}
              </div>
            );
          }
          const open = isOpen(group);
          const panelId = `nav-${group.toLowerCase()}`;
          const holdsActive = group === activeGroup;
          return (
            <div key={group} className={cx(si > 0 && "mt-0.5")}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => toggle(group)}
                className={cx(
                  "flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-[13px] font-medium transition-colors hover:bg-surface-2 hover:text-ink",
                  open || holdsActive ? "text-ink" : "text-ink-muted",
                )}
              >
                <span className="shrink-0">{GROUP_ICON[group]}</span>
                <span className="flex-1 truncate text-left">{group}</span>
                <IconChevronDown
                  size={14}
                  className={cx(
                    "shrink-0 text-ink-faint transition-transform duration-200",
                    !open && "-rotate-90",
                  )}
                />
              </button>
              <div
                id={panelId}
                inert={!open}
                className={cx(
                  "grid transition-[grid-template-rows] duration-200",
                  open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                )}
              >
                {/* Indented under its header, with a guide line, so a section's
                    items read as belonging to it. */}
                <div className="min-h-0 overflow-hidden">
                  <div className="mt-0.5 mb-1 ml-5 space-y-0.5 border-l border-line-soft pl-2">
                    {section.items.map(renderItem)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-line-soft p-2">
        <Link
          href="/profile"
          onClick={onMobileClose}
          className={cx(
            "flex items-center gap-2.5 rounded-[10px] px-2 py-2 transition-colors hover:bg-surface-2",
            collapsed && "justify-center px-0",
          )}
        >
          <Avatar name={user.fullName} size={30} />
          {!collapsed ? (
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium text-ink">
                {user.fullName}
              </div>
              <div className="truncate text-[10px] text-ink-faint">
                {ROLE_LABEL[user.role]}
              </div>
            </div>
          ) : null}
        </Link>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop rail */}
      <aside
        className={cx(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-surface/60 transition-[width] duration-200 lg:flex",
          collapsed ? "w-[68px]" : "w-60",
        )}
      >
        {content}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-scrim/80"
            onClick={onMobileClose}
            aria-hidden="true"
          />
          <aside className="animate-fade-up absolute inset-y-0 left-0 flex w-64 flex-col border-r border-line bg-surface">
            {content}
          </aside>
        </div>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------- Notification bell */

function NotificationBell({ user }: { user: User }) {
  const { db, markNotificationRead, markAllNotificationsRead } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const mine = useMemo(
    () =>
      db.notifications
        .filter((n) => n.userId === user.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [db.notifications, user.id],
  );
  const unread = mine.filter((n) => !n.read).length;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-line bg-surface-2 text-ink-muted transition-colors hover:text-ink"
      >
        <IconBell size={17} />
        {unread > 0 ? (
          <span className="absolute -top-1 -right-1 inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-st-rejected px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="animate-fade-up absolute right-0 z-40 mt-2 w-[22rem] overflow-hidden rounded-xl border border-line bg-surface-2 shadow-pop">
          <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
            <span className="text-[13px] font-semibold">Notifications</span>
            {unread > 0 ? (
              <button
                onClick={markAllNotificationsRead}
                className="text-[11px] text-brand-bright hover:underline"
              >
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {mine.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-ink-faint">
                Nothing here yet.
              </p>
            ) : (
              mine.slice(0, 12).map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    markNotificationRead(n.id);
                    setOpen(false);
                    router.push(n.href);
                  }}
                  className={cx(
                    "flex w-full gap-3 border-b border-line-soft px-4 py-3 text-left transition-colors last:border-0 hover:bg-surface-3",
                    !n.read && "bg-brand/8",
                  )}
                >
                  <span
                    className={cx(
                      "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                      n.read ? "bg-transparent" : "bg-brand-bright",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-medium text-ink">
                      {n.title}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-muted">
                      {n.body}
                    </span>
                    <span className="mt-1 block text-[10px] text-ink-faint">
                      {relativeTime(n.createdAt)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-line-soft px-4 py-2.5 text-center text-[12px] text-brand-bright hover:bg-surface-3"
          >
            View all notifications
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------- Running timer strip */

/**
 * §11.4 — the running task follows the user across every page so a forgotten
 * timer is obvious well before the 11:59 PM auto-stop.
 */
function RunningTimerStrip({ user }: { user: User }) {
  const { db, projectById } = useStore();
  const [tick, setTick] = useState(0);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);

  const task = findRunningTaskForUser(db.tasks, user.id);

  useEffect(() => {
    if (!task) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [task]);

  if (!task) return null;
  void tick;

  const project = task.projectId ? projectById(task.projectId) : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-brand/12 px-4 py-2 sm:px-6">
        <span className="inline-flex items-center gap-2 text-[11px] font-medium tracking-wide text-brand-ink uppercase">
          <span className="animate-pulse-dot h-2 w-2 rounded-full bg-brand-bright" />
          Timer running
        </span>
        <Link
          href={
            project
              ? `/projects/${project.id}?task=${task.id}`
              : `/tasks?type=individual&task=${task.id}`
          }
          className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink hover:underline"
        >
          {task.title}
          <span className="ml-2 text-[11px] text-ink-muted">
            {project ? project.name : "Individual task"}
          </span>
        </Link>
        <span className="font-mono text-[13px] tabular-nums text-ink">
          {formatClock(taskElapsedMs(task))}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setPauseOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-3"
          >
            <IconPause size={13} /> Pause
          </button>
          <button
            onClick={() => setSubmitOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-bright/40 bg-brand px-2.5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-brand-bright"
          >
            <IconSend size={13} /> Submit
          </button>
        </div>
      </div>

      <PauseDialog
        open={pauseOpen}
        onClose={() => setPauseOpen(false)}
        task={task}
      />
      <SubmitDialog
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        task={task}
      />
    </>
  );
}

/* ------------------------------------------------------------- AppShell */

export function AppShell({ children }: { children: React.ReactNode }) {
  const { currentUser } = useStore();
  // Remembered between visits (§ nav ergonomics — see the reference screens).
  const [collapsed, setCollapsed] = usePersistentFlag("pms:sidebar-collapsed");
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!currentUser) return null;

  return (
    <div className="flex min-h-screen">
      <Sidebar
        user={currentUser}
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <RunningTimerStrip user={currentUser} />

        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-canvas/85 px-4 py-3 backdrop-blur-md sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-line bg-surface-2 text-ink-muted lg:hidden"
          >
            <IconMenu size={17} />
          </button>

          <div className="min-w-0 flex-1" />

          <Link
            href="/tasks?view=mine"
            className="hidden items-center gap-1.5 rounded-[10px] border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink-muted transition-colors hover:text-ink sm:inline-flex"
          >
            <IconClock size={14} /> My work
          </Link>

          <ThemeToggle />

          <NotificationBell user={currentUser} />
          <UserMenu user={currentUser} />
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>

      <FirstSignInPassword user={currentUser} />
    </div>
  );
}

function UserMenu({ user }: { user: User }) {
  const { logout } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-[10px] border border-line bg-surface-2 py-1 pr-2.5 pl-1 transition-colors hover:bg-surface-3"
      >
        <Avatar name={user.fullName} size={26} />
        <span className="hidden text-[12px] font-medium text-ink sm:block">
          {user.fullName.split(" ")[0]}
        </span>
      </button>

      {open ? (
        <div className="animate-fade-up absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-surface-2 shadow-pop">
          <div className="border-b border-line-soft px-4 py-3">
            <div className="text-[13px] font-medium text-ink">
              {user.fullName}
            </div>
            <div className="text-[11px] text-ink-muted">{user.email}</div>
            <div className="mt-1.5 inline-flex rounded-full border border-brand-bright/30 bg-brand/20 px-2 py-0.5 text-[10px] text-brand-ink">
              {ROLE_LABEL[user.role]}
            </div>
          </div>

          <button
            onClick={() => {
              setOpen(false);
              router.push("/profile");
            }}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[12px] text-ink-muted hover:bg-surface-3 hover:text-ink"
          >
            <IconUser size={15} /> My profile
          </button>

          <button
            onClick={async () => {
              setOpen(false);
              await logout();
              router.replace("/login");
            }}
            className="flex w-full items-center gap-2.5 border-t border-line-soft px-4 py-2.5 text-left text-[12px] text-st-rejected hover:bg-st-rejected/10"
          >
            <IconLogout size={15} /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
