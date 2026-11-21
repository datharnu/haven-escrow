"use client";

import { useState } from "react";
import { SCENES, type Step } from "@/lib/record";
import { browserRpc } from "@/lib/rpc";
import { summarize, verifyStep, type CheckState, type Verdict } from "@/lib/verify";

const WORD: Record<CheckState, string> = {
  pass: "Pass",
  fail: "Fail",
  "could-not-check": "Could not check",
};

const TONE: Record<CheckState, string> = {
  pass: "text-paid",
  fail: "text-refused",
  "could-not-check": "text-muted",
};

export function useRecordCheck() {
  const [results, setResults] = useState<Record<string, Verdict>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  async function run(steps: Step[], label: (index: number, total: number, step: Step) => string) {
    setBusy(true);
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      setProgress(label(i, steps.length, step));
      setResults((current) => {
        const next = { ...current };
        delete next[step.id];
        return next;
      });
      const verdict = await verifyStep(step.hash, browserRpc());
      setResults((current) => ({ ...current, [step.id]: verdict }));
    }
    setProgress(null);
    setBusy(false);
  }

  const all = SCENES.flatMap((scene) => scene.steps);

  return {
    results,
    busy,
    progress,
    check(step: Step) {
      return run([step], () => `Checking ${step.title}`);
    },
    checkAll() {
      return run(all, (index, total, step) => `Checking ${index + 1} of ${total}. ${step.title}`);
    },
    retryFailed() {
      const failed = all.filter((step) => results[step.id]?.networkError);
      return run(failed.length > 0 ? failed : all, (index, total, step) => `Retrying ${index + 1} of ${total}. ${step.title}`);
    },
  };
}

export function mark(verdict: Verdict | undefined): string | null {
  if (!verdict) return null;
  if (verdict.networkError) return "Not reached";
  if (verdict.lines.some((line) => line.state === "fail")) return "Fail";
  return "Checked";
}

export function VerifyBar({
  busy,
  progress,
  failed,
  onAll,
  onRetry,
}: {
  busy: boolean;
  progress: string | null;
  failed: boolean;
  onAll: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="mt-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          type="button"
          onClick={onAll}
          disabled={busy}
          aria-busy={busy}
          className="h-10 rounded-lg bg-action px-4 text-sm font-medium text-on-action transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Verify all
        </button>
        {failed && !busy ? (
          <button
            type="button"
            onClick={onRetry}
            className="h-10 rounded-lg bg-raise px-4 text-sm text-ink shadow-[inset_0_0_0_1px_var(--color-line)]"
          >
            Retry
          </button>
        ) : null}
        <p className="text-[13px] text-muted sm:ml-2">
          Reads qorechain-diana directly. Sends nothing. The verdict is the chain&apos;s, not the copy.
        </p>
      </div>
      {progress ? (
        <p role="status" className="mt-2.5 text-sm text-ink">
          {progress}
        </p>
      ) : null}
      {failed && !busy ? (
        <p role="alert" className="mt-2.5 text-sm text-refused">
          Could not reach the testnet
        </p>
      ) : null}
    </div>
  );
}

export function VerifyStep({
  verdict,
  busy,
  onVerify,
  compact = false,
}: {
  verdict: Verdict | undefined;
  busy: boolean;
  onVerify: () => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "mt-3" : "mt-5 border-t border-line pt-4"}>
      <button
        type="button"
        onClick={onVerify}
        disabled={busy}
        className="h-9 w-full rounded-lg bg-raise px-3.5 text-[13px] font-medium text-ink shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-surface disabled:opacity-40 sm:w-auto"
      >
        Verify this step
      </button>
      {busy && !verdict ? (
        <p role="status" className="mt-2.5 text-[13px] text-muted">
          Checking this step
        </p>
      ) : null}
      {verdict ? (
        <div className="mt-3 rounded-lg bg-surface p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
          {verdict.networkError ? (
            <p role="alert" className="text-[13px] text-refused">
              Could not reach the testnet{" "}
              <button type="button" onClick={onVerify} disabled={busy} className="ml-2 underline">
                Retry
              </button>
            </p>
          ) : (
            <p className="text-[14px] font-medium text-ink">{summarize(verdict)}</p>
          )}
          <ul className="mt-2.5 space-y-2" aria-live="polite">
            {verdict.lines.map((line) => (
              <li key={line.id} className="grid gap-1 border-t border-line pt-2 sm:grid-cols-[140px_minmax(0,1fr)]">
                <span className="text-[12px] text-faint">{line.label}</span>
                <span className={`min-w-0 text-[13px] break-words ${TONE[line.state]}`}>
                  <span className="font-medium">{WORD[line.state]}.</span> {line.reason}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
