"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ButtonLoader } from "@/components/ui/loader";
import { Button, Field, Input, cx } from "@/components/ui/primitives";
import {
  blobToDataUrl,
  compressThumbnail,
  formatBytes,
  uploadThumbnail,
} from "@/lib/thumbnail";

const thumbnailSrc = (fileId: string) => `/api/drive/thumbnails/${encodeURIComponent(fileId)}`;

/** A task on screen may not have reached the database yet, and the route looks there. */
const RETRIES = 3;
const RETRY_AFTER_MS = 1500;

/**
 * A task's thumbnail, served through our route because the file on Drive is private
 * (0026).
 */
export function ThreeDThumbnail({
  fileId,
  alt,
  className,
}: {
  fileId: string;
  alt: string;
  className?: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // Next's image optimiser can't sign in to fetch this route as the viewer.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={attempt ? `${thumbnailSrc(fileId)}?retry=${attempt}` : thumbnailSrc(fileId)}
      alt={alt}
      loading="lazy"
      className={cx("bg-surface-2", className)}
      onError={() => {
        if (attempt < RETRIES) setTimeout(() => setAttempt((a) => a + 1), RETRY_AFTER_MS);
        else setFailed(true);
      }}
    />
  );
}

const PREVIEW_W = 420;
const PREVIEW_H = 315;
const PREVIEW_GAP = 12;
const VIEWPORT_MARGIN = 8;

/**
 * A small thumbnail that shows the image large beside it while hovered. The
 * preview goes into `document.body` so the card around a row can't clip it, and
 * it ignores the pointer so it never steals the hover or a click on the row.
 */
export function ThreeDThumbnailHover({
  fileId,
  alt,
  className,
}: {
  fileId: string;
  alt: string;
  className?: string;
}) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!at) return;
    // It is placed once on entering, so any scroll would leave it behind.
    const close = () => setAt(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [at]);

  const show = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // To the right of the thumbnail, or to its left when the right has no room.
    let left = rect.right + PREVIEW_GAP;
    if (left + PREVIEW_W > vw - VIEWPORT_MARGIN) left = rect.left - PREVIEW_GAP - PREVIEW_W;
    left = Math.max(VIEWPORT_MARGIN, left);
    const top = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.top + rect.height / 2 - PREVIEW_H / 2),
      vh - PREVIEW_H - VIEWPORT_MARGIN,
    );
    setAt({ left, top });
  };

  return (
    <span
      className="shrink-0"
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={() => setAt(null)}
    >
      <ThreeDThumbnail fileId={fileId} alt={alt} className={className} />
      {at && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-hidden
              style={{ left: at.left, top: at.top, width: PREVIEW_W, height: PREVIEW_H }}
              className="animate-fade-up pointer-events-none fixed z-[90] overflow-hidden rounded-lg border border-line bg-surface-2 p-1 shadow-pop"
            >
              <ThreeDThumbnail
                fileId={fileId}
                alt=""
                className="h-full w-full rounded object-contain"
              />
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

/** Picks, compresses and uploads a thumbnail, for the task form. It is optional. */
export function ThreeDThumbnailField({
  projectId,
  taskTitle,
  fileId,
  name,
  onChange,
  onNameChange,
  onBusyChange,
}: {
  projectId: string;
  taskTitle: string;
  fileId: string;
  name: string;
  onChange: (thumbnail: { fileId: string; url: string }) => void;
  onNameChange: (name: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  /** What was just picked. The route can't serve it until the task is saved. */
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState<string | undefined>();

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    onBusyChange(true);
    setError(undefined);
    setSaved(undefined);
    try {
      const small = await compressThumbnail(file);
      const uploaded = await uploadThumbnail(projectId, taskTitle, name, small);
      setPreview(await blobToDataUrl(small));
      setSaved(`Compressed from ${formatBytes(file.size)} to ${formatBytes(small.size)}.`);
      onChange(uploaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The upload failed.");
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };

  const remove = () => {
    setPreview(null);
    setSaved(undefined);
    setError(undefined);
    onChange({ fileId: "", url: "" });
    onNameChange("");
  };

  return (
    <Field
      label="Thumbnail"
      hint={saved ?? "Optional. Compressed automatically, then saved to Drive."}
      error={error}
    >
      <div className="flex flex-wrap items-center gap-3">
        {preview ? (
          // A local preview, which Next's image optimiser has no use for.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-20 w-32 rounded-lg border border-line object-cover" />
        ) : fileId ? (
          <ThreeDThumbnail
            key={fileId}
            fileId={fileId}
            alt=""
            className="h-20 w-32 rounded-lg border border-line object-cover"
          />
        ) : null}
        <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <ButtonLoader /> : null}
          {busy ? "Uploading…" : fileId ? "Replace" : "Upload thumbnail"}
        </Button>
        {fileId && !busy ? (
          <Button size="sm" onClick={remove}>
            Remove
          </Button>
        ) : null}
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          maxLength={200}
          placeholder="Thumbnail name"
          aria-label="Thumbnail name"
          className="min-w-40 flex-1"
        />
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            // So picking the same file again still fires this.
            e.target.value = "";
          }}
        />
      </div>
    </Field>
  );
}
