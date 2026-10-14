"use client";

import { IconBuilding, IconContact, IconProperty } from "@/components/ui/icons";
import { cx } from "@/components/ui/primitives";
import { useStore } from "@/lib/store";

/**
 * Whose a project is: its company, client contact and property, each with
 * the icon its own page uses. A link that is not set is left out, and the
 * line disappears altogether when none is.
 */
export function CrmChain({
  companyId,
  clientId,
  propertyId,
  fallbackCompany,
  inline = false,
  className,
}: {
  companyId: string | null;
  clientId: string | null;
  propertyId: string | null;
  /** The typed client name of a project raised before Companies existed. */
  fallbackCompany?: string;
  /** Side by side on one line, rather than stacked. */
  inline?: boolean;
  className?: string;
}) {
  const { companyById, clientById, propertyById } = useStore();
  const items = [
    {
      key: "company",
      label: "Company",
      icon: <IconBuilding size={12} />,
      value: companyById(companyId)?.name ?? fallbackCompany,
    },
    {
      key: "client",
      label: "Client",
      icon: <IconContact size={12} />,
      value: clientById(clientId)?.fullName,
    },
    {
      key: "property",
      label: "Property",
      icon: <IconProperty size={12} />,
      value: propertyById(propertyId)?.name,
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
