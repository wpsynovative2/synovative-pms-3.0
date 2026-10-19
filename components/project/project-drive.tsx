"use client";

import { useRef, useState } from "react";
import { IconExternal, IconFolder, IconPlus } from "@/components/ui/icons";
import { ButtonLoader, Loader } from "@/components/ui/loader";
import { Modal } from "@/components/ui/modal";
import { Button, EmptyState, ProgressBar, cx } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/calendar";
import { PROJECT_DRIVE_AREAS, type ProjectDriveArea } from "@/lib/master-data";
import { canCreateProjectDrive, canUseProjectDriveArea } from "@/lib/permissions";
import { useStore, type ProjectDriveFolders } from "@/lib/store";
import type { Project } from "@/lib/types";

/**
 * The Drive folder of a project selling a 3D walkthrough (0015): a button to
 * make it, then one button per area the signed-in person may see — CSF and
 * 3D Team — opening a window that lists the area and uploads into it.
 *
 * Files go from the browser straight to Google: the server only opens each
 * upload (/api/drive/project-folders/upload) after checking the caller may use
 * that area. Uploads run one at a time and carry on while the window is closed.
 */

interface DriveItem {
  id: string;
  name: string;
  isFolder: boolean;
  size: number | null;
  modifiedTime: string;
  url: string;
}

interface Listing {
  area: ProjectDriveArea;
  items: DriveItem[];
  loading: boolean;
  error: string | null;
}

interface Upload {
  id: string;
  area: ProjectDriveArea;
  /** Where it lands, "Renders/Final/walkthrough.mp4" for a file from a folder. */
  label: string;
  size: number;
  loaded: number;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** PUTs the file to Drive's upload session, reporting bytes sent. */
function putFile(url: string, file: File, onProgress: (loaded: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    // Must match the type the session was opened with.
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Google Drive returned ${xhr.status}.`));
    xhr.onerror = () => reject(new Error("The upload was interrupted."));
    xhr.send(file);
  });
}

async function errorOf(res: Response, fallback: string) {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

export function ProjectDriveControls({ project }: { project: Project }) {
  const { currentUser, showToast, saveProjectDrive } = useStore();
  const [creating, setCreating] = useState(false);
  const [openArea, setOpenArea] = useState<ProjectDriveArea | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);

  // Uploads queue behind each other across picks; the open area is read when
  // the queue empties, to refresh its listing.
  const chain = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const openRef = useRef<ProjectDriveArea | null>(null);

  if (!currentUser) return null;

  const load = async (area: ProjectDriveArea) => {
    setListing((l) => ({
      area,
      items: l?.area === area ? l.items : [],
      loading: true,
      error: null,
    }));
    try {
      const res = await fetch(
        `/api/drive/project-folders/files?${new URLSearchParams({ projectId: project.id, area })}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const error = await errorOf(res, "Couldn't read the folder.");
        setListing((l) => (l?.area === area ? { ...l, loading: false, error } : l));
        return;
      }
      const { items } = (await res.json()) as { items: DriveItem[] };
      setListing((l) => (l?.area === area ? { area, items, loading: false, error: null } : l));
    } catch {
      setListing((l) =>
        l?.area === area ? { ...l, loading: false, error: "Couldn't reach Google Drive." } : l,
      );
    }
  };

  const open = (area: ProjectDriveArea) => {
    openRef.current = area;
    setOpenArea(area);
    void load(area);
  };

  const close = () => {
    openRef.current = null;
    setOpenArea(null);
  };

  const create = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/drive/project-folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      if (!res.ok) {
        showToast(await errorOf(res, "Couldn't create the Drive folder."));
        return;
      }
      saveProjectDrive(project.id, (await res.json()) as ProjectDriveFolders);
      showToast("Drive folder ready, with CSF and 3D Team inside.", "success");
    } catch {
      showToast("Couldn't reach Google Drive.");
    } finally {
      setCreating(false);
    }
  };

  const patch = (id: string, change: Partial<Upload>) =>
    setUploads((us) => us.map((u) => (u.id === id ? { ...u, ...change } : u)));

  const uploadOne = async (item: Upload, file: File, path: string[]) => {
    patch(item.id, { status: "uploading" });
    try {
      const res = await fetch("/api/drive/project-folders/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          area: item.area,
          name: file.name,
          mimeType: file.type,
          size: file.size,
          path,
        }),
      });
      if (!res.ok) throw new Error(await errorOf(res, "Couldn't start the upload."));
      const { uploadUrl } = (await res.json()) as { uploadUrl: string };
      await putFile(uploadUrl, file, (loaded) => patch(item.id, { loaded }));
      patch(item.id, { status: "done", loaded: file.size });
    } catch (err) {
      patch(item.id, {
        status: "error",
        error: err instanceof Error ? err.message : "The upload failed.",
      });
    }
  };

  /**
   * Queues what was picked. A file from a picked folder keeps the folder it
   * was in (webkitRelativePath), which is recreated inside the area.
   */
  const enqueue = (area: ProjectDriveArea, files: FileList | null) => {
    if (!files?.length) return;
    const picked = Array.from(files).map((file) => {
      const parts = (file.webkitRelativePath || file.name).split("/").filter(Boolean);
      const item: Upload = {
        id: crypto.randomUUID(),
        area,
        label: parts.join("/"),
        size: file.size,
        loaded: 0,
        status: "queued",
      };
      return { item, file, path: parts.slice(0, -1) };
    });
    setUploads((us) => [...us, ...picked.map((p) => p.item)]);
    for (const { item, file, path } of picked) {
      pending.current++;
      chain.current = chain.current.then(async () => {
        await uploadOne(item, file, path);
        pending.current--;
        if (pending.current === 0 && openRef.current === area) void load(area);
      });
    }
  };

  if (!project.driveFolderId) {
    if (!canCreateProjectDrive(currentUser, project)) return null;
    return (
      <Button size="sm" onClick={create} disabled={creating}>
        {creating ? <ButtonLoader /> : <IconFolder size={13} />} Create Drive folder
      </Button>
    );
  }

  const areas = (Object.keys(PROJECT_DRIVE_AREAS) as ProjectDriveArea[]).filter((a) =>
    canUseProjectDriveArea(currentUser, a),
  );
  if (!areas.length) return null;

  const active = uploads.filter((u) => u.status === "queued" || u.status === "uploading");

  return (
    <>
      {areas.map((area) => {
        const busy = active.some((u) => u.area === area);
        return (
          <Button key={area} size="sm" onClick={() => open(area)}>
            {busy ? <ButtonLoader /> : <IconFolder size={13} />} {PROJECT_DRIVE_AREAS[area]}
          </Button>
        );
      })}

      {openArea ? (
        <DriveAreaModal
          project={project}
          area={openArea}
          listing={listing?.area === openArea ? listing : null}
          uploads={uploads.filter((u) => u.area === openArea)}
          onClose={close}
          onPick={(files) => enqueue(openArea, files)}
          onRefresh={() => void load(openArea)}
          onClear={() =>
            setUploads((us) =>
              us.filter((u) => u.area !== openArea || u.status === "queued" || u.status === "uploading"),
            )
          }
        />
      ) : null}
    </>
  );
}

function DriveAreaModal({
  project,
  area,
  listing,
  uploads,
  onClose,
  onPick,
  onRefresh,
  onClear,
}: {
  project: Project;
  area: ProjectDriveArea;
  listing: Listing | null;
  uploads: Upload[];
  onClose: () => void;
  onPick: (files: FileList | null) => void;
  onRefresh: () => void;
  onClear: () => void;
}) {
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const folderId = area === "csf" ? project.driveCsfFolderId : project.driveTeam3dFolderId;
  const finished = uploads.filter((u) => u.status === "done" || u.status === "error");

  return (
    <Modal
      open
      onClose={onClose}
      title={`${PROJECT_DRIVE_AREAS[area]} · ${project.name}`}
      subtitle={
        area === "csf"
          ? "Client servicing: Project Managers, Super Admin, Admin, Manager and the 3D Artists' Team Leader."
          : "For the 3D Artists department."
      }
      size="lg"
      footer={
        <>
          {folderId ? (
            <a
              href={`https://drive.google.com/drive/folders/${folderId}`}
              target="_blank"
              rel="noreferrer"
              className="mr-auto inline-flex items-center gap-1.5 text-[12px] text-brand-ink hover:underline"
            >
              <IconExternal size={13} /> Open in Google Drive
            </a>
          ) : null}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => filesInput.current?.click()}>
            <IconPlus size={14} /> Upload files
          </Button>
          <Button onClick={() => folderInput.current?.click()}>
            <IconFolder size={14} /> Upload a folder
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onRefresh}>
            Refresh
          </Button>
          <input
            ref={filesInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              onPick(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            // React has no prop for picking a whole folder; the attribute does it.
            ref={(el) => {
              folderInput.current = el;
              el?.setAttribute("webkitdirectory", "");
            }}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              onPick(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {uploads.length ? (
          <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3">
            <div className="flex items-center text-[11px] font-medium tracking-wide text-ink-muted uppercase">
              Uploads
              {finished.length ? (
                <button
                  type="button"
                  onClick={onClear}
                  className="ml-auto text-[11px] font-normal tracking-normal text-ink-faint normal-case hover:text-ink"
                >
                  Clear finished
                </button>
              ) : null}
            </div>
            <ul className="flex max-h-56 flex-col gap-2 overflow-y-auto">
              {uploads.map((u) => (
                <li key={u.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="min-w-0 flex-1 truncate text-ink" title={u.label}>
                      {u.label}
                    </span>
                    <span
                      className={cx(
                        "shrink-0 text-[11px]",
                        u.status === "error"
                          ? "text-st-rejected"
                          : u.status === "done"
                            ? "text-st-approved"
                            : "text-ink-faint",
                      )}
                    >
                      {u.status === "queued"
                        ? "Waiting"
                        : u.status === "uploading"
                          ? `${formatBytes(u.loaded)} of ${formatBytes(u.size)}`
                          : u.status === "done"
                            ? "Uploaded"
                            : "Failed"}
                    </span>
                  </div>
                  {u.status === "uploading" ? (
                    <ProgressBar value={u.size ? (u.loaded / u.size) * 100 : 100} />
                  ) : null}
                  {u.error ? <p className="text-[11px] text-st-rejected">{u.error}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!listing || (listing.loading && !listing.items.length) ? (
          <div className="flex justify-center py-8 text-ink-faint">
            <Loader />
          </div>
        ) : listing.error ? (
          <p className="rounded-lg border border-st-rejected/30 bg-st-rejected/10 px-3 py-2 text-[12px] text-st-rejected">
            {listing.error}
          </p>
        ) : listing.items.length === 0 ? (
          <EmptyState
            icon={<IconFolder size={20} />}
            title="Nothing here yet"
            body="Upload files or a whole folder of media."
          />
        ) : (
          <ul className="divide-y divide-line-soft rounded-xl border border-line">
            {listing.items.map((item) => (
              <li key={item.id}>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 px-3 py-2.5 text-[12px] hover:bg-surface-2"
                >
                  <IconFolder
                    size={15}
                    className={cx("shrink-0", item.isFolder ? "text-brand-ink" : "text-ink-faint")}
                  />
                  <span className="min-w-0 flex-1 truncate text-ink">{item.name}</span>
                  <span className="shrink-0 text-[11px] text-ink-faint">
                    {item.isFolder ? "Folder" : item.size !== null ? formatBytes(item.size) : ""}
                  </span>
                  <span className="hidden shrink-0 text-[11px] text-ink-faint sm:inline">
                    {formatDateTime(item.modifiedTime)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
