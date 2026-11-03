"use client";

import { IconContact, IconCrane, IconProperty } from "@/components/ui/icons";
import { cx } from "@/components/ui/primitives";
import { canSeeClients } from "@/lib/permissions";
import { useStore } from "@/lib/store";
import type { Project, Task } from "@/lib/types";

/**
 * Whose work a task is. A project task is its project's, so it follows the
 * project; an individual task holds its own (0019).
 */
export const taskCrm = (task: Task, project: Project | null | undefined) =>
  project
    ? {
        companyId: project.companyId,
        propertyId: project.propertyId,
        clientIds: project.clientIds,
        fallbackCompany: project.clientName as string | undefined,
      }
    : {
        companyId: task.companyId ?? null,
        propertyId: task.propertyId ?? null,
        clientIds: task.clientIds ?? [],
        fallbackCompany: undefined,
      };

/**
 * Whose a project is: its company, property and client contact, each with
 * the icon its own page uses. A link that is not set is left out, and the
 * line disappears altogether when none is.
 */
export function CrmChain({
  companyId,
  clientId,
  clientIds,
  propertyId,
  fallbackCompany,
  inline = false,
  className,
}: {
  companyId: string | null;
  clientId: string | null;
  /** Several contacts, shown together; clientId is used when not given. */
  clientIds?: string[];
  propertyId: string | null;
  /** The typed client name of a project raised before Companies existed. */
  fallbackCompany?: string;
  /** Side by side on one line, rather than stacked. */
  inline?: boolean;
  className?: string;
}) {
  const { currentUser, companyById, clientById, propertyById } = useStore();
  const items = [
    {
      key: "company",
      label: "Company",
      icon: <IconCrane size={12} />,
      value: companyById(companyId)?.name ?? fallbackCompany,
    },
    {
      key: "property",
      label: "Property",
      icon: <IconProperty size={12} />,
      value: propertyById(propertyId)?.name,
    },
    {
      key: "client",
      label: "Client",
      icon: <IconContact size={12} />,
      value:
        currentUser && canSeeClients(currentUser)
          ? (clientIds ?? (clientId ? [clientId] : []))
              .map((id) => clientById(id)?.fullName)
              .filter(Boolean)
              .join(", ") || undefined
          : undefined,
    },
  ].filter((i) => !!i.value);
  if (items.length === 0) return null;

  return (
    <div
      className={cx(
        "flex min-w-0 text-[11px] text-ink-faint",
        inline ? "flex-wrap items-center gap-x-3 gap-y-0.5" : "flex-col gap-0.5",
        className,
      )}
    >
      {items.map((i) => (
        <span
          key={i.key}
          className="flex min-w-0 items-center gap-1.5"
          title={`${i.label}: ${i.value}`}
        >
          <span className="shrink-0 text-ink-muted">{i.icon}</span>
          <span className="truncate">{i.value}</span>
        </span>
      ))}
    </div>
  );
}
