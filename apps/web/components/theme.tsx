"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
  }, []);

  function toggle() {
    const next: Theme = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    const apply = () => {
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("haven-escrow-theme", next);
      setTheme(next);
    };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced && "startViewTransition" in document) {
      document.startViewTransition(apply);
      return;
    }
    apply();
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "light" ? "Switch to dark" : "Switch to light"}
      className="inline-flex h-10 items-center rounded-lg px-3 text-sm text-muted hover:bg-raise hover:text-ink"
    >
      {theme === null ? "Theme" : theme === "light" ? "Dark" : "Light"}
    </button>
  );
}
