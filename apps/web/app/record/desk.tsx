"use client";

import { useMemo, useState } from "react";
import { ESCROWS, findStep, SCENES, shortHash, type Outcome, type Scene, type Step } from "@/lib/record";
import { PaymentLine } from "@/components/line";
import { SealedFiles } from "@/components/sealed";
import { mark, useRecordCheck, VerifyBar, VerifyStep } from "@/components/verify";

const FILTERS = ["All", "Paid", "Refused", "Held"] as const;
type Filter = (typeof FILTERS)[number];

const TONE: Record<Outcome, string> = {
  paid: "bg-paid-soft text-paid",
  refused: "bg-refused-soft text-refused",
  held: "bg-held-soft text-held",
};

export function Desk({ initialScene }: { initialScene: string }) {
  const start = SCENES.find((scene) => scene.id === initialScene) ?? SCENES[0];
  const [sceneId, setSceneId] = useState(start.id);
  const [stepId, setStepId] = useState(start.steps[0].id);
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const check = useRecordCheck();

  const scene = SCENES.find((item) => item.id === sceneId) ?? SCENES[0];
  const visible = useMemo(
    () => scene.steps.filter((step) => filter === "All" || step.outcome === filter.toLowerCase()),
    [scene, filter],
  );
  const step = visible.find((item) => item.id === stepId) ?? visible[0] ?? null;

  function openScene(next: Scene) {
    setSceneId(next.id);
    setStepId(next.steps[0].id);
    setFilter("All");
    setLookup(null);
    setCopied(false);
    document.getElementById("ticket")?.scrollIntoView({ block: "nearest" });
  }

  function onLookup(event: React.FormEvent) {
    event.preventDefault();
    const found = findStep(query);
    if (!found) {
      setLookup(query.trim() ? "missing" : "empty");
      return;
    }
    setSceneId(found.scene.id);
    setStepId(found.step.id);
    setFilter("All");
    setLookup("found");
  }

  async function copy(hash: string) {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
    } catch {
      setCopied(false);
      setLookup("copy");
    }
  }

  function showReading() {
    const narrow = window.matchMedia("(max-width: 1023px)").matches;
    if (!narrow) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("step-reading")?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }

  return (
    <div className="space-y-6">
      <div className="lg:sticky lg:top-16 lg:z-10 lg:-mx-5 lg:bg-canvas/95 lg:px-5 lg:py-3 lg:backdrop-blur-md">
        <PaymentLine
          escrowLabel={`Escrow ${scene.escrow}`}
          amount={scene.escrow === "A" ? "1.000000 fUSD × 2 milestones" : "1.000000 fUSD · 120s review"}
        />
      </div>

      <div className="min-w-0 space-y-6">
        <div
          role="tablist"
          aria-label="Scenes"
          className="flex w-full gap-2 overflow-x-auto pb-1"
        >
          {SCENES.map((item) => {
            const selected = item.id === scene.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => openScene(item)}
                className={`relative min-w-[11.5rem] shrink-0 rounded-xl px-3.5 py-3 text-left shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors ${
                  selected ? "bg-raise" : "bg-surface hover:bg-raise"
                }`}
              >
                  <span className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${selected ? "bg-brand" : "bg-line"}`}
                      aria-hidden="true"
                    />
                    <span className="num text-[12px] text-faint">
                      {item.index} · Escrow {item.escrow}
                    </span>
                  </span>
                  <span className="mt-1 block text-[15px] font-medium tracking-[-0.02em] text-ink">{item.title}</span>
                </button>
              );
            })}
        </div>

        <section
          id="ticket"
          className="min-w-0 max-w-full rounded-xl bg-surface p-4 shadow-[inset_0_0_0_1px_var(--color-line)] sm:p-6"
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="num text-[12px] text-faint">Escrow {scene.escrow}</p>
              <h2 className="mt-1 text-[26px] font-medium tracking-[-0.03em] text-ink">{scene.title}</h2>
            </div>
            <p className="num max-w-full text-[12px] break-all text-muted" title={ESCROWS[scene.escrow]}>
              {ESCROWS[scene.escrow]}
            </p>
          </div>
          <p className="mt-3 max-w-[62ch] text-[15px] text-muted">{scene.summary}</p>
          <VerifyBar
            busy={check.busy}
            progress={check.progress}
            failed={Object.values(check.results).some((verdict) => verdict.networkError)}
            onAll={() => void check.checkAll()}
            onRetry={() => void check.retryFailed()}
          />

          <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Filter this scene">
            {FILTERS.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={filter === item}
                onClick={() => {
                  setFilter(item);
                  setStepId(scene.steps.find((s) => item === "All" || s.outcome === item.toLowerCase())?.id ?? "");
                }}
                className={`h-9 rounded-full px-3.5 text-[13px] font-medium transition-colors ${
                  filter === item
                    ? "bg-action text-on-action"
                    : "bg-canvas text-muted shadow-[inset_0_0_0_1px_var(--color-line)] hover:text-ink"
                }`}
              >
                {item}
              </button>
            ))}
          </div>

          {visible.length === 0 || !step ? (
            <p role="status" className="mt-6 rounded-lg bg-canvas px-4 py-5 text-[15px] text-muted">
              {filter === "Refused" && scene.id !== "classical"
                ? "This scene has no refusals. The classical-key scene is where they are."
                : `This scene has no ${filter.toLowerCase()} steps.`}
            </p>
          ) : (
            <Ticket
              steps={visible}
              step={step}
              onPick={(id) => {
                setStepId(id);
                setCopied(false);
                showReading();
              }}
              copied={copied}
              onCopy={copy}
              verdict={check.results[step.id]}
              marks={check.results}
              busy={check.busy}
              onVerify={() => void check.check(step)}
            />
          )}
          <form onSubmit={onLookup} className="mt-5 flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor="hash">
              Look up a transaction hash
            </label>
            <input
              id="hash"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Paste a hash from this record"
              className="num h-11 min-w-0 flex-1 rounded-lg bg-canvas px-3 text-[14px] text-ink shadow-[inset_0_0_0_1px_var(--color-line)] placeholder:text-faint"
            />
            <button
              type="submit"
              className="h-11 rounded-lg bg-raise px-4 text-sm font-medium text-ink shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-canvas"
            >
              Find
            </button>
          </form>
          {lookup === "empty" ? (
            <p role="status" className="mt-2 text-sm text-muted">
              Paste a hash. An empty search is not a transaction.
            </p>
          ) : null}
          {lookup === "missing" ? (
            <p role="alert" className="mt-2 text-sm text-refused">
              That hash is not in this record. The four scenes are the only ones stored here.
            </p>
          ) : null}
          {lookup === "copy" ? (
            <p role="alert" className="mt-2 text-sm text-refused">
              The browser refused the copy. The full hash is still on the page.
            </p>
          ) : null}
          <SealedFiles sceneId={scene.id} />
        </section>
      </div>
    </div>
  );
}

function Ticket({
  steps,
  step,
  onPick,
  copied,
  onCopy,
  verdict,
  marks,
  busy,
  onVerify,
}: {
  steps: Step[];
  step: Step;
  onPick: (id: string) => void;
  copied: boolean;
  onCopy: (hash: string) => void;
  verdict: ReturnType<typeof useRecordCheck>["results"][string] | undefined;
  marks: ReturnType<typeof useRecordCheck>["results"];
  busy: boolean;
  onVerify: () => void;
}) {
  const index = steps.findIndex((item) => item.id === step.id);
  return (
    <div className="mt-5 grid items-start gap-4 lg:grid-cols-[13.5rem_minmax(0,1fr)]">
      <ol className="sticky top-16 z-10 -mx-1 flex gap-2 overflow-x-auto bg-surface/95 px-1 py-2 backdrop-blur-md lg:sticky lg:top-52 lg:z-auto lg:mx-0 lg:max-h-[calc(100dvh-14rem)] lg:flex-col lg:self-start lg:overflow-y-auto lg:overflow-x-visible lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-none">
        {steps.map((item, i) => {
          const active = item.id === step.id;
          return (
            <li key={item.id} className="min-w-[12rem] shrink-0 lg:min-w-0">
              <button
                type="button"
                aria-current={active ? "step" : undefined}
                onClick={() => onPick(item.id)}
                className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-[14px] transition-colors ${
                  active ? "bg-raise text-ink" : "text-muted hover:bg-raise/60 hover:text-ink"
                }`}
              >
                <span className="mt-1.5 flex shrink-0 items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${active ? "bg-brand" : "bg-line"}`} aria-hidden="true" />
                  <span className="num text-[12px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{item.title}</span>
                  <span
                    className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium tracking-[0.05em] ${TONE[item.outcome]}`}
                  >
                    {item.error ?? item.outcome}
                  </span>
                  {mark(marks[item.id]) ? (
                    <span className="mt-1 block text-[11px] text-faint">{mark(marks[item.id])}</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <article id="step-reading" className="min-w-0 scroll-mt-36 rounded-xl bg-canvas p-4 shadow-[inset_0_0_0_1px_var(--color-line)] sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-brand" aria-hidden="true" />
            <span className="num text-[12px] text-faint">
              Step {String(index + 1).padStart(2, "0")} of {String(steps.length).padStart(2, "0")}
            </span>
          </div>
          <p
            className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium tracking-[0.08em] ${TONE[step.outcome]}`}
          >
            {step.error ?? step.outcome}
          </p>
        </div>

        <h3 className="mt-3 text-[21px] leading-snug font-medium tracking-[-0.025em] text-ink">{step.sentence}</h3>
        <dl className="mt-5 space-y-3 text-[14px]">
          <Row label="Amount" value={step.amount} />
          <Row label="Who signed" value={step.who} />
          <Row label="Who submitted" value={step.submitted} />
          <Row label="Cannot happen" value={step.cannot} />
        </dl>
        <div className="mt-5 border-t border-line pt-4">
          <p className="text-[12px] tracking-[0.08em] text-faint uppercase">Transaction</p>
          {step.hash ? (
            <div className="mt-2 flex flex-wrap items-start gap-2">
              <p className="num min-w-0 flex-1 text-[13px] break-all text-ink" title={step.hash}>
                <span className="sm:hidden">{shortHash(step.hash)}</span>
                <span className="hidden sm:inline">{step.hash}</span>
              </p>
              <button
                type="button"
                onClick={() => onCopy(step.hash!)}
                className="h-9 shrink-0 rounded-lg bg-raise px-3 text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--color-line)]"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          ) : (
            <p className="mt-2 text-[14px] text-muted">Refused before broadcast. There is no transaction hash.</p>
          )}
        </div>
        <VerifyStep verdict={verdict} busy={busy} onVerify={onVerify} />
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            disabled={index <= 0}
            onClick={() => onPick(steps[index - 1].id)}
            className="h-10 rounded-lg px-3.5 text-sm text-muted enabled:hover:bg-raise enabled:hover:text-ink disabled:opacity-40"
          >
            Back
          </button>
          <button
            type="button"
            disabled={index >= steps.length - 1}
            onClick={() => onPick(steps[index + 1].id)}
            className="h-10 rounded-lg bg-action px-4 text-sm font-medium text-on-action transition-opacity enabled:hover:opacity-90 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </article>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-t border-line pt-3 sm:grid-cols-[140px_minmax(0,1fr)]">
      <dt className="text-faint">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{value}</dd>
    </div>
  );
}
