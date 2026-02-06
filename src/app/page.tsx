"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const NOTE_ID = "main";
const PASSWORD = process.env.NEXT_PUBLIC_NOTEPAD_PASSWORD || "";

interface ImageRecord {
  id: string;
  url: string;
  filename: string;
  created_at: string;
}

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

  // Image state
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Load initial content + images
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

      // Load images
      const { data: imgData } = await supabase
        .from("images")
        .select("*")
        .order("created_at", { ascending: false });

      if (imgData) setImages(imgData);
    }
    load();
  }, [authed]);

  // Subscribe to real-time changes (notes + images)
  useEffect(() => {
    if (!authed) return;
    const channel = supabase
      .channel("realtime-all")
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
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "images",
        },
        (payload) => {
          const newImg = payload.new as ImageRecord;
          setImages((prev) => {
            if (prev.some((i) => i.id === newImg.id)) return prev;
            return [newImg, ...prev];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "images",
        },
        (payload) => {
          const deletedId = payload.old.id;
          setImages((prev) => prev.filter((i) => i.id !== deletedId));
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

  // Image upload
  const uploadFile = async (file: File) => {
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) {
        console.error("Upload failed:", await res.text());
      }
    } catch (err) {
      console.error("Upload error:", err);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(uploadFile);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(uploadFile);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDelete = async (img: ImageRecord) => {
    try {
      const res = await fetch("/api/delete-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: img.id, url: img.url }),
      });
      if (!res.ok) {
        console.error("Delete failed:", await res.text());
      }
    } catch (err) {
      console.error("Delete error:", err);
    } finally {
      setDeleteConfirm(null);
    }
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

  // Notepad + Image Panel
  return (
    <div className="flex flex-col h-screen bg-black">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#222]">
        <h1 className="text-sm font-medium text-[#888]">Realtime Notepad</h1>
        <div className="flex items-center gap-3">
          {uploading && <span className="text-xs text-[#555]">Uploading...</span>}
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

      {/* Main content area */}
      <div className="flex flex-1 min-h-0">
        {/* Textarea - left side */}
        <textarea
          value={content}
          onChange={handleChange}
          onPaste={handlePaste}
          className="flex-1 min-w-0 p-4 bg-black text-[#ededed] text-sm leading-relaxed resize-none outline-none placeholder-[#555] font-mono"
          placeholder="Start typing or paste something here... It will sync across all your devices."
          spellCheck={false}
        />

        {/* Image panel - right side */}
        <div className="w-80 border-l border-[#222] flex flex-col min-h-0">
          {/* Panel header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#222]">
            <span className="text-xs font-medium text-[#888]">
              Media {images.length > 0 && `(${images.length})`}
            </span>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-xs text-[#555] hover:text-[#ededed] transition-colors"
            >
              + Upload
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* Drop zone / image list */}
          <div
            className={`flex-1 overflow-y-auto p-3 space-y-3 ${
              dragOver ? "bg-[#111] border-2 border-dashed border-[#555]" : ""
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {dragOver && (
              <div className="flex items-center justify-center py-8 text-xs text-[#555]">
                Drop files here
              </div>
            )}

            {!dragOver && images.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-[#555] text-xs gap-2">
                <p>No media yet</p>
                <p>Drag & drop images or videos</p>
              </div>
            )}

            {!dragOver && images.map((img) => {
              const isVideo = /\.(mp4|mov|webm|avi|mkv)$/i.test(img.url);
              return (
              <div key={img.id} className="group relative">
                {isVideo ? (
                  <video
                    src={img.url}
                    className="w-full rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
                    muted
                    playsInline
                    preload="metadata"
                    onMouseEnter={(e) => e.currentTarget.play()}
                    onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
                    onClick={() => setLightbox(img.url)}
                  />
                ) : (
                  <img
                    src={img.url}
                    alt={img.filename}
                    className="w-full rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
                    loading="lazy"
                    onClick={() => setLightbox(img.url)}
                  />
                )}
                <div className="flex items-center justify-between mt-1 px-1">
                  <span className="text-[10px] text-[#555] truncate max-w-[200px]">
                    {img.filename}
                  </span>
                  {deleteConfirm === img.id ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDelete(img)}
                        className="text-[10px] text-red-500 hover:text-red-400"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="text-[10px] text-[#555] hover:text-[#888]"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(img.id)}
                      className="text-[10px] text-[#555] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 cursor-pointer"
          onClick={() => setLightbox(null)}
        >
          {/\.(mp4|mov|webm|avi|mkv)$/i.test(lightbox) ? (
            <video
              src={lightbox}
              className="max-w-[90vw] max-h-[90vh] rounded-lg"
              controls
              autoPlay
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={lightbox}
              alt="Full size"
              className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
            />
          )}
        </div>
      )}
    </div>
  );
}
