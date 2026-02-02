"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const NOTE_ID = "main";
const PASSWORD = process.env.NEXT_PUBLIC_NOTEPAD_PASSWORD || "";

export default function Home() {
  const [authed, setAuthed] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState(false);
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<"saved" | "saving" | "typing">("saved");
  const [connected, setConnected] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRemoteUpdate = useRef(false);
  const latestContent = useRef("");

  // Check localStorage on mount
  useEffect(() => {
    if (localStorage.getItem("notepad_authed") === "true") {
      setAuthed(true);
    }
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pwInput === PASSWORD) {
      localStorage.setItem("notepad_authed", "true");
      setAuthed(true);
      setPwError(false);
    } else {
      setPwError(true);
    }
  };

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
    if (!authed) return;
    async function load() {
      const { data, error } = await supabase
        .from("notes")
        .select("content")
        .eq("id", NOTE_ID)
        .single();

      if (error && error.code === "PGRST116") {
        await supabase
          .from("notes")
          .insert({ id: NOTE_ID, content: "", updated_at: new Date().toISOString() });
      } else if (data) {
        setContent(data.content || "");
      }
    }
    load();
  }, [authed]);

  // Subscribe to real-time changes
  useEffect(() => {
    if (!authed) return;
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
          if (newContent !== latestContent.current) {
            isRemoteUpdate.current = true;
            setContent(newContent);
            setStatus("saved");
          }
        }
      )
      .subscribe((s) => {
        setConnected(s === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [authed]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);

    if (isRemoteUpdate.current) {
      isRemoteUpdate.current = false;
      return;
    }

    setStatus("typing");

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      saveContent(newContent);
    }, 500);
  };

  const handlePaste = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      saveContent(latestContent.current);
    }, 100);
  };

  // Password screen
  if (!authed) {
    return (
      <div className="flex items-center justify-center h-screen bg-black">
        <form onSubmit={handleLogin} className="flex flex-col items-center gap-4 w-72">
          <h1 className="text-sm font-medium text-[#ededed] tracking-wide">Realtime Notepad</h1>
          <input
            type="password"
            value={pwInput}
            onChange={(e) => { setPwInput(e.target.value); setPwError(false); }}
            placeholder="Password"
            className="w-full px-3 py-2 bg-[#111] border border-[#333] rounded-lg text-sm text-[#ededed] placeholder-[#555] outline-none focus:border-[#888] transition-colors"
            autoFocus
          />
          {pwError && <p className="text-red-500 text-xs">Wrong password</p>}
          <button
            type="submit"
            className="w-full px-3 py-2 bg-white text-black text-sm font-medium rounded-lg hover:bg-[#ccc] transition-colors"
          >
            Enter
          </button>
        </form>
      </div>
    );
  }

  // Notepad
  return (
    <div className="flex flex-col h-screen bg-black">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#222]">
        <h1 className="text-sm font-medium text-[#888]">Realtime Notepad</h1>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs ${
              status === "saved"
                ? "text-[#888]"
                : status === "saving"
                ? "text-[#ededed]"
                : "text-[#555]"
            }`}
          >
            {status === "saved" ? "Saved" : status === "saving" ? "Saving..." : "Typing..."}
          </span>
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              connected ? "bg-[#ededed]" : "bg-red-500"
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
        className="flex-1 w-full p-4 bg-black text-[#ededed] text-sm leading-relaxed resize-none outline-none placeholder-[#555] font-mono"
        placeholder="Start typing or paste something here... It will sync across all your devices."
        spellCheck={false}
      />
    </div>
  );
}
