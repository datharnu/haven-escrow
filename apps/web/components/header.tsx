"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="shrink-0">
      <rect width="22" height="22" rx="6" fill="var(--color-ink)" />
      <circle cx="6.25" cy="11" r="1.7" fill="var(--color-client)" />
      <circle cx="15.75" cy="11" r="1.7" fill="var(--color-freelancer)" />
      <path d="M8.2 11h5.6" stroke="var(--color-canvas)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function Header() {
  const path = usePathname();
  if (path.startsWith("/record") || path.startsWith("/practice")) return null;

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between gap-3 px-5">
        <Link href="/" className="flex min-w-0 items-center gap-2 text-ink">
          <Mark />
          <span className="truncate text-[15px] font-medium tracking-[-0.02em]">
            Haven Escrow
          </span>
        </Link>
        <Link
          href="/record"
          className="inline-flex h-8 shrink-0 items-center rounded-full bg-action px-3.5 text-[13px] font-medium whitespace-nowrap text-on-action transition-opacity hover:opacity-90 active:scale-[0.98]"
        >
          Open app
        </Link>
      </div>
    </header>
  );
}
