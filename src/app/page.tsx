"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { MediaGallery } from "@/components/media-gallery";
import { ThemeToggle } from "@/components/theme-toggle";
import { useNotes } from "@/hooks/use-notes";
import { displayDate, extractLinks, noteExcerpt, noteTitle } from "@/lib/notes";
import { saveBlob } from "@/lib/media";

const PASSWORD = process.env.NEXT_PUBLIC_NOTEPAD_PASSWORD || "";

function LinkedText({ text }: { text: string }) {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  for (const link of extractLinks(text)) {
    nodes.push(text.slice(last, link.index));
    nodes.push(
      <a
        key={link.index}
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {link.text}
      </a>,
    );
    last = link.index + link.text.length;
  }
  nodes.push(text.slice(last));
  return <>{nodes}</>;
}

export default function Home() {
  const [authed, setAuthed] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [view, setView] = useState<"notes" | "media">("notes");
  const [mode, setMode] = useState<"edit" | "read">("edit");
  const [query, setQuery] = useState("");
  const [mediaCount, setMediaCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const positions = useRef(
    new Map<string, { start: number; end: number; scroll: number }>(),
  );
  const notebook = useNotes(authed);
  const { active, notes, activeId } = notebook;
  const content = active?.content || "";
  const links = useMemo(
    () =>
      extractLinks(content).filter(
        (link, index, all) =>
          all.findIndex((other) => other.href === link.href) === index,
      ),
    [content],
  );
  const filteredNotes = notes.filter(
    (note) =>
      note.content.toLowerCase().includes(query.toLowerCase()) ||
      noteTitle(note.content).toLowerCase().includes(query.toLowerCase()),
  );
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const hasSaveError = notes.some((note) => note.sync === "error");
  const pendingCount = notes.filter((note) => note.sync !== "saved").length;

  useEffect(() => {
    try {
      setAuthed(!PASSWORD || localStorage.getItem("notepad_authed") === "true");
    } catch {
      setAuthed(!PASSWORD);
    }
    setAuthReady(true);
  }, []);

  useEffect(() => {
    // Safari's on-screen keyboard resizes the visual viewport, not always 100dvh.
    const viewport = window.visualViewport;
    const resize = () => {
      if (!viewport || viewport.scale === 1) {
        const height = Math.round(viewport?.height || window.innerHeight);
        document.documentElement.style.setProperty(
          "--app-height",
          `${height}px`,
        );
        // Safari media queries can still see the full screen while the keyboard
        // covers it. Drive the compact layout from the same visual height.
        document.documentElement.toggleAttribute(
          "data-compact-viewport",
          height < 600 && window.innerWidth <= 900,
        );
      }
    };
    resize();
    viewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    const position = positions.current.get(activeId);
    if (editor) {
      editor.setSelectionRange(position?.start || 0, position?.end || 0);
      editor.scrollTop = position?.scroll || 0;
    }
  }, [activeId, mode]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  function rememberPosition() {
    const editor = editorRef.current;
    if (editor)
      positions.current.set(activeId, {
        start: editor.selectionStart,
        end: editor.selectionEnd,
        scroll: editor.scrollTop,
      });
  }
  function selectNote(id: string) {
    rememberPosition();
    notebook.select(id);
    setView("notes");
    setLinksOpen(false);
  }
  function newNote() {
    rememberPosition();
    notebook.create();
    setView("notes");
    setMode("edit");
    setQuery("");
    setLinksOpen(false);
    requestAnimationFrame(() =>
      editorRef.current?.focus({ preventScroll: true }),
    );
  }

  async function copyNote() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }

  if (!authReady)
    return (
      <div className="loading-screen">
        <span className="spinner" />
        <span>Opening your notebook…</span>
      </div>
    );
  if (!authed)
    return (
      <main className="login-page">
        <ThemeToggle className="login-theme-toggle" />
        <div className="login-decoration" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <form
          className="login-card"
          onSubmit={(event) => {
            event.preventDefault();
            if (password === PASSWORD) {
              try {
                localStorage.setItem("notepad_authed", "true");
              } catch {
                /* Session access still works. */
              }
              setAuthed(true);
            } else setPasswordError(true);
          }}
        >
          <div className="brand">
            <span className="brand-icon">
              <Icon name="note" size={23} />
            </span>
            noted<span>.</span>
          </div>
          <div className="eyebrow">YOUR EVERYDAY NOTEBOOK</div>
          <h1>
            A little space
            <br />
            for everything.
          </h1>
          <p>
            Your thoughts, photos, and ideas.
            <br />
            Together, wherever you are.
          </p>
          <label htmlFor="password">Notebook password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setPasswordError(false);
            }}
            autoFocus
            aria-invalid={passwordError}
            aria-describedby={passwordError ? "password-error" : undefined}
          />
          {passwordError && (
            <span id="password-error" className="error-text" role="alert">
              That password isn’t quite right. Try again.
            </span>
          )}
          <button className="button primary" type="submit">
            Open my notebook
            <Icon name="arrow" size={19} />
          </button>
          <div className="login-footer">
            <Icon name="cloud" size={18} />
            One notebook. All your devices.
          </div>
        </form>
      </main>
    );

  return (
    <div className="app-shell">
      <header className="app-header">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setView("notes");
          }}
          aria-label="Noted home"
        >
          <span className="brand-icon">
            <Icon name="note" size={21} />
          </span>
          noted<span>.</span>
        </a>
        <span className="header-divider" />
        <span className="app-descriptor">A little space for everything</span>
        <nav className="main-tabs" aria-label="Workspace">
          <button
            className={view === "notes" ? "active" : ""}
            aria-current={view === "notes" ? "page" : undefined}
            onClick={() => setView("notes")}
          >
            <Icon name="note" size={17} />
            Notes
          </button>
          <button
            className={view === "media" ? "active" : ""}
            aria-current={view === "media" ? "page" : undefined}
            onClick={() => {
              rememberPosition();
              setView("media");
              notebook.focus(false);
            }}
          >
            <Icon name="grid" size={17} />
            Media gallery<span className="nav-count">{mediaCount}</span>
          </button>
        </nav>
        <div
          className={`connection-status ${notebook.connected ? "online" : "offline"}`}
          title={
            notebook.connected
              ? "Connected to realtime updates"
              : "Realtime is reconnecting. Notes still save when the server is reachable."
          }
        >
          <span className="status-dot" />
          <span>{notebook.connected ? "Live sync" : "Reconnecting"}</span>
        </div>
        <ThemeToggle />
        <div className="avatar" title="My workspace">
          J
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="workspace-label">
            <span className="workspace-mark">N</span>
            <div>
              <strong>My workspace</strong>
              <span>Make room for your ideas</span>
            </div>
          </div>
          <button
            className="button primary new-note"
            onClick={newNote}
            disabled={notebook.loading}
          >
            <Icon name="plus" size={18} />
            New note<span>+</span>
          </button>
          <label className="search-field sidebar-search">
            <Icon name="search" size={16} />
            <input
              placeholder="Find a note…"
              aria-label="Search notes"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                className="icon-button"
                aria-label="Clear note search"
                onClick={() => setQuery("")}
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </label>
          <div className="sidebar-label">
            YOUR NOTES<span>{notes.length.toString().padStart(2, "0")}</span>
          </div>
          <div className="note-list">
            {filteredNotes.map((note) => (
              <button
                className={`note-list-item ${note.id === activeId && view === "notes" ? "active" : ""}`}
                onClick={() => selectNote(note.id)}
                key={note.id}
              >
                <div className="note-item-title">
                  <Icon name="note" size={16} />
                  <strong>{noteTitle(note.content)}</strong>
                  {note.sync !== "saved" && (
                    <span
                      className={`note-state-dot ${note.sync === "error" ? "failed" : ""}`}
                      title={
                        note.sync === "error"
                          ? "Save failed"
                          : "Unsaved changes"
                      }
                    />
                  )}
                </div>
                <p>{noteExcerpt(note.content)}</p>
                <span>
                  {displayDate(note.updated_at)}
                  {note.id === "main" && <i>Original note</i>}
                </span>
              </button>
            ))}
            {!notebook.loading && !filteredNotes.length && (
              <div className="sidebar-empty">
                {query
                  ? "No notes match your search."
                  : "Your next idea starts here."}
              </div>
            )}
          </div>
          <div className="sidebar-bottom">
            <div className="sync-card">
              <span className="sync-card-icon">
                <Icon name="cloud" size={23} />
              </span>
              <div>
                <strong>
                  {hasSaveError
                    ? "Some changes need a retry"
                    : pendingCount
                      ? "Keeping your ideas safe"
                      : "A thought here. There, too."}
                </strong>
                <p>
                  {hasSaveError
                    ? "Open the note and retry saving."
                    : pendingCount
                      ? "Your changes are waiting to sync."
                      : "Your notes sync across your devices."}
                </p>
              </div>
            </div>
            <span className="sidebar-footnote">
              LESS CLUTTER. MORE CLARITY.
            </span>
          </div>
        </aside>
        <main className="main-content">
          <section
            className="notes-view"
            hidden={view !== "notes"}
            aria-label="Notes workspace"
          >
            <header className="view-heading">
              <div>
                <div className="eyebrow">WRITE IT DOWN. MAKE IT HAPPEN.</div>
                <h1>
                  My notebook<span className="heading-dot">.</span>
                </h1>
                <p>A thought, a plan, a spark. It all belongs here.</p>
              </div>
              <button
                className="button secondary"
                onClick={newNote}
                disabled={notebook.loading}
              >
                <Icon name="plus" size={17} />
                New note
              </button>
            </header>
            <label className="search-field mobile-note-search">
              <Icon name="search" size={16} />
              <input
                aria-label="Find a note"
                placeholder="Find a note…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button
                  className="icon-button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                >
                  <Icon name="close" size={15} />
                </button>
              )}
            </label>
            <div className="note-tabs" role="tablist" aria-label="Open notes">
              {filteredNotes.map((note) => (
                <button
                  key={note.id}
                  id={`tab-${note.id}`}
                  className={`note-tab ${note.id === activeId ? "active" : ""}`}
                  role="tab"
                  aria-selected={note.id === activeId}
                  aria-controls="note-panel"
                  onClick={() => selectNote(note.id)}
                  onKeyDown={(event) => {
                    if (
                      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                        event.key,
                      )
                    )
                      return;
                    event.preventDefault();
                    const index = filteredNotes.findIndex(
                      (item) => item.id === note.id,
                    );
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? filteredNotes.length - 1
                          : (index +
                              (event.key === "ArrowRight" ? 1 : -1) +
                              filteredNotes.length) %
                            filteredNotes.length;
                    selectNote(filteredNotes[next].id);
                    document
                      .getElementById(`tab-${filteredNotes[next].id}`)
                      ?.focus();
                  }}
                >
                  <Icon name="note" size={15} />
                  <span>{noteTitle(note.content)}</span>
                  {note.sync === "error" && (
                    <span className="note-state-dot failed" />
                  )}
                </button>
              ))}
              <button
                className="add-tab"
                onClick={newNote}
                disabled={notebook.loading}
                aria-label="Create a new note tab"
              >
                <Icon name="plus" size={18} />
              </button>
            </div>
            {notebook.loadError && (
              <div className="notice error" role="alert">
                <Icon name="alert" size={18} />
                <span>{notebook.loadError}</span>
                <button onClick={notebook.retry}>Retry</button>
              </div>
            )}
            <div
              className="editor-card"
              id="note-panel"
              role="tabpanel"
              aria-labelledby={active ? `tab-${active.id}` : undefined}
            >
              {notebook.loading ? (
                <div className="empty-state">
                  <span className="spinner" />
                  <p>Opening your notes…</p>
                </div>
              ) : active ? (
                <>
                  <div className="editor-toolbar">
                    <div className="editor-breadcrumb">
                      <Icon name="note" size={15} />
                      <span>
                        {active.id === "main"
                          ? "Original note"
                          : "Personal note"}
                      </span>
                      <span className="breadcrumb-slash">/</span>
                      <span>{displayDate(active.updated_at)}</span>
                    </div>
                    <div className="editor-actions">
                      <div className="mode-switch" aria-label="Editor mode">
                        <button
                          className={mode === "edit" ? "active" : ""}
                          aria-pressed={mode === "edit"}
                          onClick={() => {
                            setMode("edit");
                          }}
                        >
                          <Icon name="edit" size={14} />
                          <span>Edit</span>
                        </button>
                        <button
                          className={mode === "read" ? "active" : ""}
                          aria-pressed={mode === "read"}
                          onClick={() => {
                            rememberPosition();
                            setMode("read");
                            notebook.focus(false);
                          }}
                        >
                          <Icon name="eye" size={15} />
                          <span>Read</span>
                        </button>
                      </div>
                      <span className="toolbar-divider" />
                      <button
                        className="icon-button"
                        title={copied ? "Copied!" : "Copy note"}
                        aria-label={copied ? "Note copied" : "Copy note"}
                        onClick={copyNote}
                      >
                        <Icon name={copied ? "check" : "copy"} size={17} />
                      </button>
                      <button
                        className="icon-button"
                        title="Download note"
                        aria-label="Download note as text"
                        onClick={() =>
                          saveBlob(
                            new Blob([content], {
                              type: "text/plain;charset=utf-8",
                            }),
                            `${noteTitle(content)}.txt`,
                          )
                        }
                      >
                        <Icon name="download" size={17} />
                      </button>
                    </div>
                  </div>
                  {active.sync === "error" && (
                    <div className="notice error" role="alert">
                      <Icon name="alert" size={17} />
                      <span>
                        Couldn’t save. Your draft is kept on this device.
                      </span>
                      <button onClick={() => notebook.save(active.id)}>
                        Retry save
                      </button>
                    </div>
                  )}
                  {notebook.conflict && (
                    <div className="notice conflict" role="status">
                      <Icon name="cloud" size={18} />
                      <span>
                        This note changed on another device. Load it, or keep
                        your version. Unsaved text is preserved as a separate
                        note when loading.
                      </span>
                      <button onClick={() => notebook.resolve(active.id, true)}>
                        Load update
                      </button>
                      <button
                        onClick={() => notebook.resolve(active.id, false)}
                      >
                        Keep mine
                      </button>
                    </div>
                  )}
                  {copyError && (
                    <div className="notice error" role="alert">
                      <span>
                        Copy wasn’t available. Select the text to copy it
                        manually.
                      </span>
                      <button onClick={() => setCopyError(false)}>
                        Dismiss
                      </button>
                    </div>
                  )}
                  <div className="editor-title-row">
                    <h2>{noteTitle(content)}</h2>
                    <span className="note-category">NOTE</span>
                  </div>
                  <div className="writing-area">
                    {mode === "edit" ? (
                      <textarea
                        key={activeId}
                        ref={editorRef}
                        aria-label="Note text"
                        value={content}
                        onChange={(event) =>
                          notebook.edit(active.id, event.target.value)
                        }
                        onFocus={() => notebook.focus(true)}
                        onBlur={() => {
                          rememberPosition();
                          notebook.focus(false);
                          void notebook.save(active.id);
                        }}
                        onCompositionStart={() => notebook.compose(true)}
                        onCompositionEnd={() => notebook.compose(false)}
                        onScroll={rememberPosition}
                        onSelect={rememberPosition}
                        placeholder={
                          "Give your note a title on the first line.\n\nThen let your thoughts take it from here…"
                        }
                        spellCheck
                        autoCapitalize="sentences"
                        className="note-editor"
                      />
                    ) : (
                      <div
                        className="note-reader"
                        tabIndex={0}
                        aria-label="Note read view"
                      >
                        {content ? (
                          <LinkedText text={content} />
                        ) : (
                          <span className="reader-placeholder">
                            A blank page. A fresh start.
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {!!links.length && (
                    <div className="note-links">
                      <button
                        className="links-toggle"
                        aria-expanded={linksOpen}
                        onClick={() => setLinksOpen(!linksOpen)}
                      >
                        <Icon name="link" size={15} />
                        {links.length} {links.length === 1 ? "link" : "links"}{" "}
                        in this note
                        <Icon
                          name="chevron"
                          size={13}
                          style={{
                            transform: linksOpen ? "rotate(90deg)" : undefined,
                          }}
                        />
                      </button>
                      {linksOpen && (
                        <div className="link-list">
                          {links.map((link) => (
                            <a
                              key={link.href}
                              href={link.href}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <span>{link.text}</span>
                              <Icon name="external" size={14} />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <footer className="editor-footer">
                    <div>
                      <span>
                        {wordCount} {wordCount === 1 ? "word" : "words"}
                      </span>
                      <span className="footer-dot">·</span>
                      <span>{content.length.toLocaleString()} characters</span>
                    </div>
                    <div
                      className={`save-status ${active.sync === "error" ? "error-text" : ""}`}
                      role="status"
                    >
                      <Icon
                        name={
                          active.sync === "saved"
                            ? "check"
                            : active.sync === "error"
                              ? "alert"
                              : "cloud"
                        }
                        size={14}
                      />
                      {active.sync === "saved"
                        ? "All changes saved"
                        : active.sync === "saving"
                          ? "Saving…"
                          : active.sync === "error"
                            ? "Not synced"
                            : "Unsaved changes"}
                    </div>
                  </footer>
                </>
              ) : (
                <div className="empty-state">
                  <Icon name="note" size={38} />
                  <h2>A fresh page is waiting</h2>
                  <button className="button primary" onClick={newNote}>
                    <Icon name="plus" size={17} />
                    Create a note
                  </button>
                </div>
              )}
            </div>
            <div className="workspace-tip">
              <span>
                <Icon name="cloud" size={14} />
                Made for the thoughts you want to keep.
              </span>
              <span>Saved as you go.</span>
            </div>
          </section>
          <section
            className="media-view"
            hidden={view !== "media"}
            aria-label="Media workspace"
          >
            <MediaGallery enabled={authed} onCount={setMediaCount} />
          </section>
        </main>
      </div>
    </div>
  );
}
