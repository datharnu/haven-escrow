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
  pass: "text-ink",
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
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={onAll}
          disabled={busy}
          aria-busy={busy}
          className="h-11 rounded-lg bg-brand px-4 text-sm text-on-brand disabled:opacity-40"
        >
          Verify all
        </button>
        {failed && !busy ? (
          <button type="button" onClick={onRetry} className="h-11 rounded-lg bg-raise px-4 text-sm text-ink shadow-[inset_0_0_0_1px_var(--color-line)]">
            Retry
          </button>
        ) : null}
      </div>
      <p className="mt-2 max-w-[62ch] text-[13px] text-muted">Reads the testnet. Sends nothing. The verdict is the chain's, not the words on the step.</p>
      {progress ? (
        <p role="status" className="mt-2 text-sm text-ink">
          {progress}
        </p>
      ) : null}
      {failed && !busy ? (
        <p role="alert" className="mt-2 text-sm text-refused">
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
}: {
  verdict: Verdict | undefined;
  busy: boolean;
  onVerify: () => void;
}) {
  return (
    <div className="mt-5 border-t border-line pt-4">
      <button
        type="button"
        onClick={onVerify}
        disabled={busy}
        className="h-10 w-full rounded-lg bg-raise px-3 text-sm text-ink shadow-[inset_0_0_0_1px_var(--color-line)] disabled:opacity-40 sm:w-auto"
      >
        Verify this step
      </button>
      {busy && !verdict ? (
        <p role="status" className="mt-3 text-sm text-muted">
          Checking this step
        </p>
      ) : null}
      {verdict ? (
        <div className="mt-3">
          {verdict.networkError ? (
            <p role="alert" className="text-sm text-refused">
              Could not reach the testnet{" "}
              <button type="button" onClick={onVerify} disabled={busy} className="ml-2 underline">
                Retry
              </button>
            </p>
          ) : (
            <p className="text-[15px]">{summarize(verdict)}</p>
          )}
          <ul className="mt-3 space-y-2" aria-live="polite">
            {verdict.lines.map((line) => (
              <li key={line.id} className="grid gap-1 border-t border-line pt-2 sm:grid-cols-[160px_minmax(0,1fr)]">
                <span className="text-[13px] text-faint">{line.label}</span>
                <span className={`min-w-0 text-[14px] break-words ${TONE[line.state]}`}>
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
