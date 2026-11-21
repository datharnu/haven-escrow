"use client";

import { useMemo, useState } from "react";
import { ESCROWS, findStep, SCENES, shortHash, type Outcome, type Scene, type Step } from "@/lib/record";
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

  return (
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div className="min-w-0">
        <div role="tablist" aria-label="Scenes" className="flex w-full gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          {SCENES.map((item) => {
            const selected = item.id === scene.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => openScene(item)}
                className={`min-w-[200px] rounded-xl px-3 py-3 text-left shadow-[inset_0_0_0_1px_var(--color-line)] lg:min-w-0 ${selected ? "bg-raise" : "bg-surface hover:bg-raise"}`}
              >
                <span className="num text-[12px] text-faint">{item.index} · Escrow {item.escrow}</span>
                <span className="mt-1 block text-[15px] tracking-[-0.02em]">{item.title}</span>
              </button>
            );
          })}
        </div>
      </div>

      <section id="ticket" className="min-w-0 max-w-full rounded-xl bg-surface p-4 shadow-[inset_0_0_0_1px_var(--color-line)] sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="num text-[12px] text-faint">Escrow {scene.escrow}</p>
            <h2 className="mt-1 text-[28px] tracking-[-0.03em]">{scene.title}</h2>
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
          <button type="submit" className="h-11 rounded-lg bg-raise px-4 text-sm text-ink shadow-[inset_0_0_0_1px_var(--color-line)]">
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

        <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Filter this scene">
          {FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={filter === item}
              onClick={() => {
                setFilter(item);
                setStepId(scene.steps.find((step) => item === "All" || step.outcome === item.toLowerCase())?.id ?? "");
              }}
              className={`h-9 rounded-full px-3 text-[13px] ${filter === item ? "bg-brand text-on-brand" : "bg-canvas text-muted shadow-[inset_0_0_0_1px_var(--color-line)]"}`}
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
            onPick={setStepId}
            copied={copied}
            onCopy={copy}
            verdict={check.results[step.id]}
            marks={check.results}
            busy={check.busy}
            onVerify={() => void check.check(step)}
          />
        )}
      </section>
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
    <div className="mt-5 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <ol className="order-2 space-y-1 lg:order-1">
        {steps.map((item, i) => (
          <li key={item.id}>
            <button
              type="button"
              aria-current={item.id === step.id ? "step" : undefined}
              onClick={() => onPick(item.id)}
              className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-[14px] ${item.id === step.id ? "bg-raise" : "hover:bg-raise"}`}
            >
              <span className="num w-5 shrink-0 text-faint">{String(i + 1).padStart(2, "0")}</span>
              <span className="min-w-0">
                <span className="block">{item.title}</span>
                <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] tracking-[0.06em] uppercase ${TONE[item.outcome]}`}>
                  {item.error ?? item.outcome}
                </span>
                {mark(marks[item.id]) ? <span className="mt-1 block text-[11px] text-faint">{mark(marks[item.id])}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <article className="order-1 min-w-0 rounded-xl bg-canvas p-4 shadow-[inset_0_0_0_1px_var(--color-line)] sm:p-5 lg:order-2">
        <p className={`inline-flex rounded-full px-2.5 py-1 text-[12px] tracking-[0.08em] uppercase ${TONE[step.outcome]}`}>
          {step.error ?? step.outcome}
        </p>
        <h3 className="mt-3 text-[22px] leading-tight tracking-[-0.03em]">{step.sentence}</h3>
        <dl className="mt-5 space-y-3 text-[14px]">
          <Row label="Amount" value={step.amount} />
          <Row label="Who signed" value={step.who} />
          <Row label="Who submitted" value={step.submitted} />
          <Row label="Cannot happen" value={step.cannot} />
        </dl>
        <div className="mt-5">
          <p className="text-[12px] tracking-[0.08em] text-faint uppercase">Transaction</p>
          {step.hash ? (
            <div className="mt-2 flex flex-wrap items-start gap-2">
              <p className="num min-w-0 flex-1 text-[13px] break-all" title={step.hash}>
                <span className="sm:hidden">{shortHash(step.hash)}</span>
                <span className="hidden sm:inline">{step.hash}</span>
              </p>
              <button type="button" onClick={() => onCopy(step.hash!)} className="h-9 shrink-0 rounded-lg bg-raise px-3 text-[13px]">
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
            className="h-10 rounded-lg px-3 text-sm text-muted enabled:hover:bg-raise disabled:opacity-40"
          >
            Back
          </button>
          <button
            type="button"
            disabled={index >= steps.length - 1}
            onClick={() => onPick(steps[index + 1].id)}
            className="h-10 rounded-lg bg-brand px-3 text-sm text-on-brand disabled:opacity-40"
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
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}
