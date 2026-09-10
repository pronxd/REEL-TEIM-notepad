"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { displayDate } from "@/lib/notes";
import { isVideo, type MediaRecord, saveBlob, uploadMedia } from "@/lib/media";
import { Icon } from "./icon";

type Upload = {
  id: string;
  file: File;
  progress: number;
  state: "queued" | "uploading" | "done" | "error";
  error?: string;
};

function Thumbnail({ item }: { item: MediaRecord }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <div className="media-fallback">
        <Icon name={isVideo(item) ? "video" : "image"} size={32} />
        <span>Preview unavailable</span>
      </div>
    );
  return isVideo(item) ? (
    <>
      <video
        src={`${item.url}#t=0.1`}
        muted
        playsInline
        preload="metadata"
        onError={() => setFailed(true)}
      />
      <span className="play-badge">
        <Icon name="play" size={23} />
      </span>
    </>
  ) : (
    <img
      src={item.url}
      alt={item.filename}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function MediaGallery({
  enabled,
  onCount,
}: {
  enabled: boolean;
  onCount: (count: number) => void;
}) {
  const [items, setItems] = useState<MediaRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "photos" | "videos">("all");
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(new Set<string>());
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const queueRef = useRef<Upload[]>([]);
  const processing = useRef(false);
  const dragDepth = useRef(0);
  const lightbox = items.find((item) => item.id === lightboxId);
  const visible = items.filter(
    (item) =>
      (filter === "all" ||
        (filter === "videos" ? isVideo(item) : !isVideo(item))) &&
      item.filename.toLowerCase().includes(query.toLowerCase()),
  );
  const photoCount = items.filter((item) => !isVideo(item)).length;
  const uploadingCount = uploads.filter(
    (upload) => upload.state === "queued" || upload.state === "uploading",
  ).length;

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from("images")
      .select("*")
      .order("created_at", { ascending: false });
    if (error)
      setError("Couldn’t load your media. Check your connection and retry.");
    else {
      setItems(data || []);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    onCount(items.length);
  }, [items.length, onCount]);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const channel = supabase
      .channel("notebook-media")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "images" },
        ({ new: record }) => {
          setItems((prev) =>
            prev.some((item) => item.id === record.id)
              ? prev
              : [record as MediaRecord, ...prev],
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "images" },
        ({ old: record }) => {
          setItems((prev) => prev.filter((item) => item.id !== record.id));
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void refresh();
      });
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      void supabase.removeChannel(channel);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, refresh]);

  useEffect(() => {
    setSelected(
      (prev) =>
        new Set([...prev].filter((id) => items.some((item) => item.id === id))),
    );
    if (lightboxId && !items.some((item) => item.id === lightboxId))
      setLightboxId(null);
  }, [items, lightboxId]);

  useEffect(() => {
    if (lightboxId && !dialogRef.current?.open) dialogRef.current?.showModal();
    if (!lightboxId && dialogRef.current?.open) dialogRef.current?.close();
    setConfirmDelete(false);
  }, [lightboxId]);

  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (uploadingCount) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [uploadingCount]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const finishSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const updateUpload = (id: string, patch: Partial<Upload>) =>
    setUploads((prev) =>
      prev.map((upload) =>
        upload.id === id ? { ...upload, ...patch } : upload,
      ),
    );

  async function processQueue() {
    if (processing.current) return;
    processing.current = true;
    while (queueRef.current.length) {
      const upload = queueRef.current.shift()!;
      updateUpload(upload.id, {
        state: "uploading",
        progress: 0,
        error: undefined,
      });
      try {
        const item = await uploadMedia(upload.file, (progress) =>
          updateUpload(upload.id, { progress }),
        );
        setItems((prev) =>
          prev.some((entry) => entry.id === item.id) ? prev : [item, ...prev],
        );
        updateUpload(upload.id, { state: "done", progress: 100 });
      } catch (error) {
        updateUpload(upload.id, {
          state: "error",
          error: error instanceof Error ? error.message : "Upload failed.",
        });
      }
    }
    processing.current = false;
  }

  function addFiles(files: File[]) {
    const next: Upload[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      progress: 0,
      state: "queued",
    }));
    setUploads((prev) => [
      ...prev.filter((upload) => upload.state !== "done"),
      ...next,
    ]);
    queueRef.current.push(...next);
    void processQueue();
  }

  async function download(files: MediaRecord[]) {
    if (!files.length || downloading) return;
    if (files.length > 100) {
      setError("Select up to 100 files per download.");
      return;
    }
    setDownloading(true);
    setError(null);
    try {
      const response =
        files.length === 1
          ? await fetch(`/api/download?id=${encodeURIComponent(files[0].id)}`)
          : await fetch("/api/download", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ids: files.map((file) => file.id) }),
            });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Download failed.");
      }
      const blob = await response.blob();
      saveBlob(
        blob,
        files.length === 1
          ? files[0].filename
          : `notepad-media-${new Date().toISOString().slice(0, 10)}.zip`,
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Download interrupted. Please try again.",
      );
    } finally {
      setDownloading(false);
    }
  }

  async function deleteMedia() {
    if (!lightbox) return;
    setDeleting(true);
    try {
      const response = await fetch("/api/delete-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: lightbox.id }),
      });
      if (!response.ok)
        throw new Error("Couldn’t delete this file. Please try again.");
      setItems((prev) => prev.filter((item) => item.id !== lightbox.id));
      setLightboxId(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const stepLightbox = (direction: number) => {
    const index = visible.findIndex((item) => item.id === lightboxId);
    if (visible.length)
      setLightboxId(
        visible[(index + direction + visible.length) % visible.length].id,
      );
  };

  return (
    <div
      className={`gallery ${dragging ? "is-dragging" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        if (event.dataTransfer.types.includes("Files")) {
          dragDepth.current++;
          setDragging(true);
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <input
        type="file"
        ref={inputRef}
        accept="image/*,video/*,.heic,.heif,.mkv,.m4v"
        multiple
        aria-label="Upload photos or videos"
        className="visually-hidden"
        onChange={(event) => {
          addFiles(Array.from(event.target.files || []));
          event.target.value = "";
        }}
      />
      <header className="view-heading">
        <div>
          <div className="eyebrow">YOUR COLLECTION</div>
          <h1>
            Media gallery<span className="heading-dot">.</span>
          </h1>
          <p>Keep the moments. Save the inspiration.</p>
        </div>
        <button
          className="button primary"
          onClick={() => inputRef.current?.click()}
        >
          <Icon name="plus" size={18} />
          Upload media
        </button>
      </header>
      <div className="gallery-toolbar">
        <div className="filter-tabs" aria-label="Filter media">
          {(
            [
              ["all", "All media", items.length],
              ["photos", "Photos", photoCount],
              ["videos", "Videos", items.length - photoCount],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              aria-pressed={filter === value}
              className={filter === value ? "active" : ""}
              onClick={() => setFilter(value)}
            >
              {label}
              <span>{count}</span>
            </button>
          ))}
        </div>
        <div className="gallery-tools">
          <label className="search-field">
            <Icon name="search" size={17} />
            <input
              aria-label="Search media"
              placeholder="Search media…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            className={`button secondary select-button ${selecting ? "active" : ""}`}
            onClick={() => (selecting ? finishSelecting() : setSelecting(true))}
          >
            <Icon name={selecting ? "close" : "check"} size={17} />
            {selecting ? "Done" : "Select"}
          </button>
        </div>
      </div>
      {error && (
        <div className="notice error" role="alert">
          <Icon name="alert" size={18} />
          <span>{error}</span>
          <button onClick={refresh}>Retry</button>
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setError(null)}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {!!uploads.length && (
        <div className="upload-panel" aria-live="polite">
          <div className="upload-heading">
            <strong>
              {uploadingCount
                ? `Uploading ${uploadingCount} ${uploadingCount === 1 ? "file" : "files"}`
                : "Uploads"}
            </strong>
            <span>
              {uploadingCount ? (
                "Keep this tab open"
              ) : (
                <button
                  className="text-button"
                  onClick={() =>
                    setUploads((prev) =>
                      prev.filter((upload) => upload.state === "error"),
                    )
                  }
                >
                  Clear completed
                </button>
              )}
            </span>
          </div>
          {uploads.map((upload) => (
            <div className="upload-row" key={upload.id}>
              <Icon
                name={upload.state === "done" ? "check" : "upload"}
                size={18}
              />
              <div>
                <span>{upload.file.name}</span>
                {upload.error ? (
                  <small className="error-text">{upload.error}</small>
                ) : (
                  <div className="progress-track">
                    <div style={{ width: `${upload.progress}%` }} />
                  </div>
                )}
              </div>
              <span className="upload-state">
                {upload.state === "done" ? (
                  "Done"
                ) : upload.state === "queued" ? (
                  "Queued"
                ) : upload.state === "error" ? (
                  <button
                    className="text-button"
                    onClick={() => {
                      updateUpload(upload.id, { state: "queued" });
                      queueRef.current.push(upload);
                      void processQueue();
                    }}
                  >
                    Retry
                  </button>
                ) : upload.progress >= 90 ? (
                  "Finishing…"
                ) : (
                  `${upload.progress}%`
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {selecting && (
        <div className="selection-bar">
          <label>
            <input
              type="checkbox"
              aria-label="Select all visible media"
              checked={
                visible.length > 0 &&
                visible.every((item) => selected.has(item.id))
              }
              onChange={(event) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  for (const item of visible) {
                    if (event.target.checked) next.add(item.id);
                    else next.delete(item.id);
                  }
                  return next;
                })
              }
            />
            Select all{query || filter !== "all" ? " shown" : ""}
          </label>
          <span>{selected.size} selected</span>
          <button
            className="button primary"
            disabled={!selected.size || downloading}
            onClick={() =>
              download(items.filter((item) => selected.has(item.id)))
            }
          >
            <Icon name="download" size={17} />
            {downloading
              ? "Preparing…"
              : `Download${selected.size > 1 ? " ZIP" : ""}`}
          </button>
        </div>
      )}
      <div className="gallery-scroll">
        {loading ? (
          <div className="empty-state">
            <span className="spinner" />
            <p>Gathering your media…</p>
          </div>
        ) : !visible.length ? (
          <div className="empty-state">
            <div className="empty-art">
              <div className="art-frame back">
                <Icon name="video" size={34} />
              </div>
              <div className="art-frame front">
                <Icon name="image" size={42} />
              </div>
              <span className="art-spark">+</span>
            </div>
            <h2>
              {items.length
                ? "Nothing here just yet"
                : "A home for your photos & videos"}
            </h2>
            <p>
              {items.length
                ? "Try another filter or search."
                : "Drop in your favorite moments, references, and little things worth keeping."}
            </p>
            <button
              className="button primary"
              onClick={() =>
                items.length
                  ? (setFilter("all"), setQuery(""))
                  : inputRef.current?.click()
              }
            >
              <Icon name={items.length ? "search" : "upload"} size={18} />
              {items.length ? "Show all media" : "Add your first files"}
            </button>
            <small>
              Photos & videos · Up to 100 MB each · Original quality
            </small>
          </div>
        ) : (
          <>
            <div className="media-grid">
              {visible.map((item) => (
                <article
                  className={`media-card ${selected.has(item.id) ? "selected" : ""}`}
                  key={item.id}
                >
                  <div className="media-thumbnail">
                    <button
                      className="preview-button"
                      aria-label={`${selecting ? "Select" : "Preview"} ${item.filename}`}
                      onClick={() =>
                        selecting ? toggle(item.id) : setLightboxId(item.id)
                      }
                    >
                      <Thumbnail item={item} />
                    </button>
                    {selecting && (
                      <label className="media-checkbox">
                        <input
                          type="checkbox"
                          checked={selected.has(item.id)}
                          aria-label={`Select ${item.filename}`}
                          onChange={() => toggle(item.id)}
                        />
                      </label>
                    )}
                    <span className="media-type">
                      <Icon
                        name={isVideo(item) ? "video" : "image"}
                        size={13}
                      />
                      {isVideo(item) ? "VIDEO" : "PHOTO"}
                    </span>
                  </div>
                  <div className="media-card-info">
                    <div>
                      <strong title={item.filename}>{item.filename}</strong>
                      <span>{displayDate(item.created_at)}</span>
                    </div>
                    <button
                      className="icon-button"
                      aria-label={`Download ${item.filename}`}
                      disabled={downloading}
                      onClick={() => download([item])}
                    >
                      <Icon name="download" size={17} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <button
              className="upload-dropzone"
              onClick={() => inputRef.current?.click()}
            >
              <span className="drop-icon">
                <Icon name="upload" size={21} />
              </span>
              <span>
                <strong>Add a little more to your collection</strong>
                <small>
                  Drop photos or videos here, or click to browse · Up to 100 MB
                  each
                </small>
              </span>
              <Icon name="plus" size={22} />
            </button>
          </>
        )}
      </div>
      {downloading && (
        <div className="download-toast" role="status">
          <span className="spinner" />
          Preparing your download. Keep this tab open.
        </div>
      )}
      {dragging && (
        <div className="drop-overlay">
          <Icon name="upload" size={40} />
          <h2>Drop something worth keeping</h2>
          <p>Photos & videos, up to 100 MB each</p>
        </div>
      )}
      <dialog
        ref={dialogRef}
        className="lightbox"
        aria-label="Media preview"
        onCancel={() => setLightboxId(null)}
        onClose={() => setLightboxId(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setLightboxId(null);
        }}
        onKeyDown={(event) => {
          if ((event.target as HTMLElement).tagName === "VIDEO") return;
          if (event.key === "ArrowRight") stepLightbox(1);
          if (event.key === "ArrowLeft") stepLightbox(-1);
        }}
      >
        {lightbox && (
          <div className="lightbox-content">
            <header>
              <div>
                <strong>{lightbox.filename}</strong>
                <span>
                  {displayDate(lightbox.created_at)} ·{" "}
                  {isVideo(lightbox) ? "Video" : "Photo"}
                </span>
              </div>
              <button
                className="icon-button"
                autoFocus
                aria-label="Close preview"
                onClick={() => setLightboxId(null)}
              >
                <Icon name="close" />
              </button>
            </header>
            <div className="lightbox-stage">
              {isVideo(lightbox) ? (
                <video
                  key={lightbox.id}
                  src={lightbox.url}
                  controls
                  playsInline
                  preload="metadata"
                >
                  <p>
                    Your browser can’t preview this video. Download it to watch.
                  </p>
                </video>
              ) : (
                <img src={lightbox.url} alt={lightbox.filename} />
              )}
            </div>
            <footer>
              {confirmDelete ? (
                <div className="delete-confirm">
                  <span>Delete this file from all devices?</span>
                  <button
                    className="button danger"
                    disabled={deleting}
                    onClick={deleteMedia}
                  >
                    {deleting ? "Deleting…" : "Delete file"}
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <div className="preview-nav">
                    <button
                      className="icon-button"
                      aria-label="Previous media"
                      onClick={() => stepLightbox(-1)}
                    >
                      <Icon
                        name="chevron"
                        style={{ transform: "rotate(180deg)" }}
                      />
                    </button>
                    <span>
                      {Math.max(
                        1,
                        visible.findIndex((item) => item.id === lightbox.id) +
                          1,
                      )}{" "}
                      / {visible.length}
                    </span>
                    <button
                      className="icon-button"
                      aria-label="Next media"
                      onClick={() => stepLightbox(1)}
                    >
                      <Icon name="chevron" />
                    </button>
                  </div>
                  <div className="preview-actions">
                    <button
                      className="icon-button"
                      aria-label="Delete media"
                      onClick={() => setConfirmDelete(true)}
                    >
                      <Icon name="trash" size={18} />
                    </button>
                    <button
                      className="button primary"
                      disabled={downloading}
                      onClick={() => download([lightbox])}
                    >
                      <Icon name="download" size={17} />
                      Download
                    </button>
                  </div>
                </>
              )}
            </footer>
            <p className="preview-help">
              If this format doesn’t preview on your device, download the
              original to open it.
            </p>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </dialog>
    </div>
  );
}
