"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Note, NoteRecord } from "@/lib/notes";

const DRAFT_KEY = "notepad-drafts-v2";

export function useNotes(enabled: boolean) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState("main");
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Record<string, NoteRecord>>({});
  const notesRef = useRef<Note[]>([]);
  const activeRef = useRef("main");
  const focusedRef = useRef(false);
  const composingRef = useRef(false);
  const conflictsRef = useRef<Record<string, NoteRecord>>({});
  const conflictDraftIds = useRef(new Set<string>());
  const dirty = useRef(new Set<string>());
  const inFlight = useRef(new Set<string>());
  const saveWaiters = useRef(new Map<string, (() => void)[]>());
  const ownWrites = useRef(new Set<string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const flushRef = useRef<(id: string) => Promise<void>>(async () => {});

  const publish = useCallback((next: Note[]) => {
    notesRef.current = next;
    setNotes(next);
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify(next.filter((note) => dirty.current.has(note.id))),
      );
    } catch {
      /* In-memory drafts still work when device storage is unavailable. */
    }
  }, []);

  const updateConflicts = useCallback((next: Record<string, NoteRecord>) => {
    conflictsRef.current = next;
    setConflicts(next);
  }, []);

  const flush = useCallback(
    async (id: string) => {
      clearTimeout(timers.current.get(id));
      timers.current.delete(id);
      if (
        !dirty.current.has(id) ||
        inFlight.current.has(id) ||
        conflictsRef.current[id]
      )
        return;
      if (composingRef.current && activeRef.current === id) return;
      const note = notesRef.current.find((item) => item.id === id);
      if (!note) return;
      inFlight.current.add(id);
      const timestamp = new Date(
        Math.max(Date.now(), new Date(note.updated_at).getTime() + 1),
      ).toISOString();
      const writeKey = `${id}:${new Date(timestamp).getTime()}`;
      ownWrites.current.add(writeKey);
      if (ownWrites.current.size > 200)
        ownWrites.current.delete(ownWrites.current.values().next().value!);
      publish(
        notesRef.current.map((item) =>
          item.id === id ? { ...item, sync: "saving" } : item,
        ),
      );
      let failed = false;
      try {
        const { error } = await supabase
          .from("notes")
          .upsert({ id, content: note.content, updated_at: timestamp });
        if (error) throw error;
        const current = notesRef.current.find((item) => item.id === id);
        if (current?.content === note.content) dirty.current.delete(id);
        publish(
          notesRef.current.map((item) =>
            item.id === id
              ? {
                  ...item,
                  updated_at: timestamp,
                  sync: dirty.current.has(id) ? "typing" : "saved",
                }
              : item,
          ),
        );
      } catch {
        failed = true;
        publish(
          notesRef.current.map((item) =>
            item.id === id ? { ...item, sync: "error" } : item,
          ),
        );
      } finally {
        inFlight.current.delete(id);
        for (const resolve of saveWaiters.current.get(id) || []) resolve();
        saveWaiters.current.delete(id);
      }
      // Serialize writes per note: an older request can never finish after a newer one.
      if (!failed && dirty.current.has(id)) void flushRef.current(id);
    },
    [publish],
  );
  flushRef.current = flush;

  const receive = useCallback(
    (record: NoteRecord) => {
      if (
        !record.id ||
        ownWrites.current.has(
          `${record.id}:${new Date(record.updated_at).getTime()}`,
        )
      )
        return;
      const incoming = { ...record, content: record.content || "" };
      const current = notesRef.current.find((note) => note.id === record.id);
      if (
        current &&
        new Date(incoming.updated_at).getTime() <=
          new Date(current.updated_at).getTime()
      )
        return;
      if (current?.content === incoming.content) {
        publish(
          notesRef.current.map((note) =>
            note.id === record.id
              ? { ...note, updated_at: incoming.updated_at }
              : note,
          ),
        );
        return;
      }
      const pending = conflictsRef.current[record.id];
      if (
        pending &&
        new Date(incoming.updated_at).getTime() <=
          new Date(pending.updated_at).getTime()
      )
        return;
      if (
        current &&
        (dirty.current.has(record.id) ||
          (focusedRef.current && activeRef.current === record.id))
      ) {
        // Never replace the textarea value underneath a mobile selection or IME session.
        if (dirty.current.has(record.id))
          conflictDraftIds.current.add(record.id);
        updateConflicts({ ...conflictsRef.current, [record.id]: incoming });
        return;
      }
      const next: Note = { ...incoming, sync: "saved" };
      publish(
        current
          ? notesRef.current.map((note) =>
              note.id === record.id ? next : note,
            )
          : [...notesRef.current, next],
      );
    },
    [publish, updateConflicts],
  );

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from("notes")
      .select("id, content, updated_at")
      .order("updated_at", { ascending: false });
    if (error) {
      setLoadError(
        "Couldn’t load your notes. Check your connection and try again.",
      );
      return;
    }
    setLoadError(null);
    for (const record of data || []) receive(record);
    if (
      !notesRef.current.some((note) => note.id === activeRef.current) &&
      notesRef.current.length
    ) {
      activeRef.current = notesRef.current[0].id;
      setActiveId(activeRef.current);
    }
  }, [receive]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    async function load() {
      let drafts: NoteRecord[] = [];
      try {
        const stored: unknown = JSON.parse(
          localStorage.getItem(DRAFT_KEY) || "[]",
        );
        if (Array.isArray(stored))
          drafts = stored.filter(
            (n) =>
              n &&
              typeof n.id === "string" &&
              typeof n.content === "string" &&
              typeof n.updated_at === "string",
          );
        activeRef.current =
          localStorage.getItem("notepad-active-note") || "main";
      } catch {
        /* Ignore damaged local storage. */
      }
      const { data, error } = await supabase
        .from("notes")
        .select("id, content, updated_at")
        .order("updated_at", { ascending: false });
      if (cancelled) return;
      const recovered: Note[] = (data || []).map((note) => ({
        ...note,
        content: note.content || "",
        sync: "saved",
      }));
      const pendingConflicts: Record<string, NoteRecord> = {};
      for (const draft of drafts) {
        const index = recovered.findIndex((note) => note.id === draft.id);
        const server = recovered[index];
        if (server?.content === draft.content) continue;
        dirty.current.add(draft.id);
        if (
          server &&
          new Date(server.updated_at).getTime() >
            new Date(draft.updated_at).getTime()
        )
          pendingConflicts[draft.id] = server;
        const local: Note = { ...draft, sync: "typing" };
        if (index >= 0) recovered[index] = local;
        else recovered.push(local);
      }
      // A failed initial read must never create and save a blank replacement note.
      if (!recovered.length && !error) {
        recovered.push({
          id: "main",
          content: "",
          updated_at: new Date().toISOString(),
          sync: "typing",
        });
        dirty.current.add("main");
      }
      updateConflicts(pendingConflicts);
      for (const id of Object.keys(pendingConflicts))
        conflictDraftIds.current.add(id);
      publish(recovered);
      const id = recovered.some((note) => note.id === activeRef.current)
        ? activeRef.current
        : recovered[0]?.id || "main";
      activeRef.current = id;
      setActiveId(id);
      setLoading(false);
      if (error)
        setLoadError(
          "Couldn’t load your notes. Your local drafts are still available.",
        );
      else for (const id of dirty.current) void flushRef.current(id);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, publish, updateConflicts]);

  useEffect(() => {
    if (!enabled || loading) return;
    const channel = supabase
      .channel("notebook-notes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notes" },
        (payload) => {
          if (payload.eventType !== "DELETE")
            receive(payload.new as NoteRecord);
        },
      )
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") void refresh();
      });
    const retry = () => {
      void refresh().then(() => {
        for (const id of dirty.current) void flushRef.current(id);
      });
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        for (const id of dirty.current) void flushRef.current(id);
      } else retry();
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty.current.size) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("online", retry);
    window.addEventListener("beforeunload", unload);
    document.addEventListener("visibilitychange", visibility);
    // Catch up if a websocket drops an event without reconnecting.
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30000);
    return () => {
      void supabase.removeChannel(channel);
      window.removeEventListener("online", retry);
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("visibilitychange", visibility);
      clearInterval(poll);
      for (const timer of timers.current.values()) clearTimeout(timer);
    };
  }, [enabled, loading, receive, refresh]);

  const edit = useCallback(
    (id: string, content: string) => {
      dirty.current.add(id);
      publish(
        notesRef.current.map((note) =>
          note.id === id ? { ...note, content, sync: "typing" } : note,
        ),
      );
      clearTimeout(timers.current.get(id));
      timers.current.set(
        id,
        setTimeout(() => void flushRef.current(id), 600),
      );
    },
    [publish],
  );

  const select = useCallback((id: string) => {
    void flushRef.current(activeRef.current);
    activeRef.current = id;
    focusedRef.current = false;
    composingRef.current = false;
    setActiveId(id);
    try {
      localStorage.setItem("notepad-active-note", id);
    } catch {
      /* Optional preference. */
    }
  }, []);

  const create = useCallback(() => {
    const id = crypto.randomUUID();
    dirty.current.add(id);
    publish([
      ...notesRef.current,
      { id, content: "", updated_at: new Date().toISOString(), sync: "typing" },
    ]);
    select(id);
    void flushRef.current(id);
    return id;
  }, [publish, select]);

  const resolve = async (id: string, useRemote: boolean) => {
    const hadLocalDraft =
      dirty.current.has(id) || conflictDraftIds.current.has(id);
    // Let an already-started write settle before applying a conflict choice.
    if (inFlight.current.has(id))
      await new Promise<void>((done) => {
        saveWaiters.current.set(id, [
          ...(saveWaiters.current.get(id) || []),
          done,
        ]);
      });
    const remote = conflictsRef.current[id];
    if (!remote) return;
    const next = { ...conflictsRef.current };
    delete next[id];
    conflictDraftIds.current.delete(id);
    updateConflicts(next);
    if (useRemote) {
      // Preserve the local version as another note before loading a conflicting edit.
      const local = notesRef.current.find((note) => note.id === id);
      const backupId = crypto.randomUUID();
      const backup: Note[] =
        local &&
        (hadLocalDraft || dirty.current.has(id)) &&
        local.content !== remote.content
          ? [
              {
                id: backupId,
                content: local.content,
                updated_at: new Date().toISOString(),
                sync: "typing",
              },
            ]
          : [];
      if (backup.length) dirty.current.add(backupId);
      dirty.current.add(id);
      const chosen: Note = {
        ...remote,
        updated_at: new Date(
          Math.max(
            new Date(remote.updated_at).getTime(),
            new Date(local?.updated_at || remote.updated_at).getTime(),
          ),
        ).toISOString(),
        sync: "typing",
      };
      publish([
        ...notesRef.current.map((note) => (note.id === id ? chosen : note)),
        ...backup,
      ]);
      if (backup.length) void flushRef.current(backupId);
      // Save the chosen version in case a prior local write replaced it remotely.
      void flushRef.current(id);
    } else {
      dirty.current.add(id);
      publish(
        notesRef.current.map((note) =>
          note.id === id
            ? { ...note, updated_at: remote.updated_at, sync: "typing" }
            : note,
        ),
      );
      void flushRef.current(id);
    }
  };

  return {
    notes,
    activeId,
    active: notes.find((note) => note.id === activeId) || notes[0],
    loading,
    connected,
    loadError,
    conflict: conflicts[activeId],
    edit,
    select,
    create,
    resolve,
    retry: refresh,
    save: flush,
    focus: (value: boolean) => {
      focusedRef.current = value;
    },
    compose: (value: boolean) => {
      composingRef.current = value;
      if (!value) void flushRef.current(activeRef.current);
    },
  };
}
