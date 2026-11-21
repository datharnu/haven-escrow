import Link from "next/link";
import { ThemeToggle } from "./theme";

export function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" className="shrink-0">
      <rect x="1" y="1" width="26" height="26" rx="6" fill="none" stroke="currentColor" strokeOpacity="0.35" />
      <path d="M6 10h6" stroke="var(--color-client)" strokeWidth="2" />
      <path d="M16 18h6" stroke="var(--color-freelancer)" strokeWidth="2" />
      <path d="M6 14h16" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-canvas/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1080px] items-center justify-between gap-4 px-5">
        <Link href="/" className="flex min-w-0 items-center gap-2.5 text-ink">
          <Mark />
          <span className="truncate text-[15px] tracking-[-0.03em]">Haven Escrow</span>
        </Link>
        <nav className="flex items-center gap-1" aria-label="Pages">
          <Link href="/record" className="inline-flex h-10 items-center rounded-lg px-3 text-sm text-muted hover:bg-raise hover:text-ink">
            Record
          </Link>
          <Link href="/practice" className="inline-flex h-10 items-center rounded-lg px-3 text-sm text-muted hover:bg-raise hover:text-ink">
            Practice
          </Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
