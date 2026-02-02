"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const NOTE_ID = "main";

export default function Home() {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<"saved" | "saving" | "typing">("saved");
  const [connected, setConnected] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRemoteUpdate = useRef(false);
  const latestContent = useRef("");

  // Keep ref in sync with state
  latestContent.current = content;

  const saveContent = useCallback(async (text: string) => {
    setStatus("saving");
    const { error } = await supabase
      .from("notes")
      .upsert({ id: NOTE_ID, content: text, updated_at: new Date().toISOString() });

    if (error) {
      console.error("Save failed:", JSON.stringify(error, null, 2));
    }
    setStatus("saved");
  }, []);

  // Load initial content
  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from("notes")
        .select("content")
        .eq("id", NOTE_ID)
        .single();

      if (error && error.code === "PGRST116") {
        // Row doesn't exist yet, create it
        await supabase
          .from("notes")
          .insert({ id: NOTE_ID, content: "", updated_at: new Date().toISOString() });
      } else if (data) {
        setContent(data.content || "");
      }
    }
    load();
  }, []);

  // Subscribe to real-time changes
  useEffect(() => {
    const channel = supabase
      .channel("notes-changes")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notes",
          filter: `id=eq.${NOTE_ID}`,
        },
        (payload) => {
          const newContent = payload.new.content || "";
          // Only update if it's different from what we have (avoid echo)
          if (newContent !== latestContent.current) {
            isRemoteUpdate.current = true;
            setContent(newContent);
            setStatus("saved");
          }
        }
      )
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);

    // Don't save if this was triggered by a remote update
    if (isRemoteUpdate.current) {
      isRemoteUpdate.current = false;
      return;
    }

    setStatus("typing");

    // Debounce: save 500ms after the user stops typing
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      saveContent(newContent);
    }, 500);
  };

  // Save on paste immediately
  const handlePaste = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      saveContent(latestContent.current);
    }, 100);
  };

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
        <h1 className="text-sm font-medium text-gray-400">Realtime Notepad</h1>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs ${
              status === "saved"
                ? "text-green-400"
                : status === "saving"
                ? "text-yellow-400"
                : "text-gray-500"
            }`}
          >
            {status === "saved" ? "Saved" : status === "saving" ? "Saving..." : "Typing..."}
          </span>
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              connected ? "bg-green-500" : "bg-red-500"
            }`}
            title={connected ? "Connected" : "Disconnected"}
          />
        </div>
      </div>

      {/* Textarea */}
      <textarea
        value={content}
        onChange={handleChange}
        onPaste={handlePaste}
        className="flex-1 w-full p-4 bg-gray-950 text-gray-100 text-base leading-relaxed resize-none outline-none placeholder-gray-600 font-mono"
        placeholder="Start typing or paste something here... It will sync across all your devices."
        spellCheck={false}
      />
    </div>
  );
}
