"use client";

import { useEffect, useState } from "react";
import { applyTheme, DEFAULT_THEME, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";
import { Icon } from "./icon";

// Retain the choice for this session even if device storage is unavailable.
let preference: Theme | null = null;

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === "light" || saved === "dark") preference = saved;
    } catch { /* Keep the session preference. */ }
    const sync = () => {
      const next = preference || DEFAULT_THEME;
      applyTheme(next);
      setTheme(next);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      preference = event.newValue === "light" || event.newValue === "dark" ? event.newValue : null;
      sync();
    };
    sync();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      className={`icon-button theme-toggle ${className}`}
      aria-label={label}
      title={label}
      onClick={() => {
        const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        preference = next;
        applyTheme(next);
        setTheme(next);
        try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* Works for this session. */ }
      }}
    >
      <span className="theme-moon"><Icon name="moon" size={19}/></span>
      <span className="theme-sun"><Icon name="sun" size={19}/></span>
    </button>
  );
}
