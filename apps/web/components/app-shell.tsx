"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Mark } from "@/components/header";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur-md">
        <div className="flex h-12 items-center gap-2 px-3 sm:gap-3 sm:px-4">
          <Link href="/" className="flex min-w-0 items-center gap-2 text-ink">
            <Mark />
            <span className="truncate text-[13px] font-medium tracking-[-0.02em]">Haven</span>
          </Link>
          <nav aria-label="App" className="flex items-center gap-0.5">
            <NavItem href="/record" label="Record" icon={<RecordIcon />} />
            <NavItem href="/practice" label="Practice" icon={<PracticeIcon />} />
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}

function NavItem({ href, label, icon }: { href: string; label: string; icon: ReactNode }) {
  const path = usePathname();
  const active = path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium transition-colors sm:px-2.5 ${
        active ? "bg-raise text-ink" : "text-muted hover:bg-raise hover:text-ink"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

function RecordIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <path
        fill="currentColor"
        d="M3.25 1.7h6.1L13 5.35v8.05c0 .72-.58 1.3-1.3 1.3H3.25c-.72 0-1.3-.58-1.3-1.3V3c0-.72.58-1.3 1.3-1.3Zm5.7.9v2.55c0 .36.3.66.66.66h2.55L8.95 2.6ZM4.4 8.05a.55.55 0 0 0 0 1.1h7.2a.55.55 0 1 0 0-1.1H4.4Zm0 2.3a.55.55 0 1 0 0 1.1h4.9a.55.55 0 1 0 0-1.1H4.4Z"
      />
    </svg>
  );
}

function PracticeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <path
        fill="currentColor"
        d="M5.05 2.35c-.62-.38-1.42.07-1.42.8v9.7c0 .73.8 1.18 1.42.8l8.05-4.85c.6-.36.6-1.24 0-1.6L5.05 2.35Z"
      />
    </svg>
  );
}
