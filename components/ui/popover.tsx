"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cx } from "./primitives";

const VIEWPORT_MARGIN = 8;

/**
 * A floating panel anchored to a trigger, rendered into `document.body` with
 * fixed positioning.
 *
 * Rendering in place clipped dropdowns in two ways: cards form their own
 * stacking contexts, so a later card painted over an open calendar, and the
 * scrolling bodies of modals and drawers cut panels off at their edge. A portal
 * escapes both. The panel flips above the trigger when there is more room
 * there, follows scrolling and resizing, and owns click-outside and Escape
 * (Escape closes only the panel, not the modal around it).
 */
export function Popover({
  anchorRef,
  open,
  onClose,
  children,
  className,
  matchWidth,
  align = "start",
  offset = 6,
  maxHeight,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  /** Make the panel exactly as wide as the trigger. */
  matchWidth?: boolean;
  align?: "start" | "end";
  offset?: number;
  /** Upper bound in px; the panel also never grows past the viewport. */
  maxHeight?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Callers pass an inline onClose; keep the latest without re-binding listeners.
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  // Position is written straight to the element — it changes on every scroll
  // frame, and routing it through state would re-render the whole panel.
  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;

    const rect = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (matchWidth) panel.style.width = `${rect.width}px`;
    const width = panel.offsetWidth;
    const natural = Math.min(panel.scrollHeight, maxHeight ?? Infinity);

    const roomBelow = vh - rect.bottom - offset - VIEWPORT_MARGIN;
    const roomAbove = rect.top - offset - VIEWPORT_MARGIN;
    const above = natural > roomBelow && roomAbove > roomBelow;
    const room = Math.max(120, above ? roomAbove : roomBelow);
    const height = Math.min(natural, room);

    let left = align === "end" ? rect.right - width : rect.left;
    left = Math.min(Math.max(VIEWPORT_MARGIN, left), vw - width - VIEWPORT_MARGIN);

    panel.style.maxHeight = `${Math.min(room, maxHeight ?? Infinity)}px`;
    panel.style.left = `${left}px`;
    panel.style.top = `${above ? rect.top - offset - height : rect.bottom + offset}px`;
    panel.style.transformOrigin = above ? "bottom" : "top";
    panel.style.visibility = "visible";
  }, [anchorRef, matchWidth, align, offset, maxHeight]);

  // Measure before the first paint so the panel never flashes in the wrong spot.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };

    // Capture phase catches scrolling in any ancestor, not just the window.
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const observer = new ResizeObserver(schedule);
    if (panelRef.current) observer.observe(panelRef.current);
    if (anchorRef.current) observer.observe(anchorRef.current);

    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onCloseRef.current();
    };
    // Registered on window in the capture phase so it runs before a parent
    // modal's Escape handler and can stop it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey, true);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, place, anchorRef]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={panelRef}
      style={{ position: "fixed", top: 0, left: 0, visibility: "hidden" }}
      className={cx(
        "animate-fade-up z-[80] overflow-y-auto border border-line bg-surface-2 shadow-pop",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
