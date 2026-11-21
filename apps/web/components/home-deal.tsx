"use client";

import { useState } from "react";
import Link from "next/link";
import { ESCROWS, PARTIES, RECORDED, SCENES, shortHash, type Outcome, type Step } from "@/lib/record";
import { mark, useRecordCheck, VerifyBar, VerifyStep } from "@/components/verify";

const TONE: Record<Outcome, string> = {
  paid: "bg-paid-soft text-paid",
  refused: "bg-refused-soft text-refused",
  held: "bg-held-soft text-held",
};

function shortAddr(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

type DealStage = {
  id: string;
  phase: string;
  label: string;
  escrow: "A" | "B";
  milestone: string;
  amount: string;
  status: Outcome;
  statusText: string;
  summary: string;
  step: Step | null;
  fundHash?: string;
  whoSigned: string;
  whoSubmitted: string;
  ruleNote: string;
};

function buildDealStages(): DealStage[] {
  const byId = new Map<string, Step>();
  for (const scene of SCENES) {
    for (const step of scene.steps) {
      byId.set(step.id, step);
    }
  }

  return [
    {
      id: "fund",
      phase: "Funding",
      label: "Create and fund Escrow A",
      escrow: "A",
      milestone: "Milestones 0 & 1 · 1.000000 fUSD each",
      amount: "2.000000 fUSD funded",
      status: "held",
      statusText: "Funded",
      summary:
        "EscrowFactory.create fixed the client, the freelancer, three arbiters, a 1-day review period, and a 5000 bps default split. The client funded 2.000000 fUSD.",
      step: null,
      fundHash: "0x3030d499ae0f75dd9d22d5aacb1a0dce8540f4c01b92f952a12c7bb7a942cb16",
      whoSigned: "Client, hybrid PQC window",
      whoSubmitted: "Client",
      ruleNote: "Both recipient addresses are immutable after creation. fund marks milestones in order and cannot name a payee.",
    },
    {
      id: "deliver-0",
      phase: "Delivery",
      label: "Deliver milestone 0",
      escrow: "A",
      milestone: "Milestone 0 · 1.000000 fUSD",
      amount: "1.000000 fUSD held",
      status: "held",
      statusText: "Delivered",
      summary: byId.get("deliver-0")!.sentence,
      step: byId.get("deliver-0")!,
      whoSigned: byId.get("deliver-0")!.who,
      whoSubmitted: byId.get("deliver-0")!.submitted,
      ruleNote: byId.get("deliver-0")!.cannot,
    },
    {
      id: "release-0",
      phase: "Settlement",
      label: "Release milestone 0",
      escrow: "A",
      milestone: "Milestone 0 · 1.000000 fUSD",
      amount: "1.000000 fUSD to freelancer",
      status: "paid",
      statusText: "Paid",
      summary: byId.get("release-0")!.sentence,
      step: byId.get("release-0")!,
      whoSigned: byId.get("release-0")!.who,
      whoSubmitted: byId.get("release-0")!.submitted,
      ruleNote: byId.get("release-0")!.cannot,
    },
    {
      id: "junk",
      phase: "Refused",
      label: "Classical key attempts milestone 1",
      escrow: "A",
      milestone: "Milestone 1 · 1.000000 fUSD",
      amount: "0 moved · 1.000000 fUSD still held",
      status: "refused",
      statusText: "SignatureInvalid",
      summary: byId.get("junk")!.sentence,
      step: byId.get("junk")!,
      whoSigned: byId.get("junk")!.who,
      whoSubmitted: byId.get("junk")!.submitted,
      ruleNote: byId.get("junk")!.cannot,
    },
    {
      id: "two-arbiters",
      phase: "Dispute settled",
      label: "Two arbiters split milestone 1",
      escrow: "A",
      milestone: "Milestone 1 · 1.000000 fUSD",
      amount: "0.700000 freelancer · 0.300000 client",
      status: "paid",
      statusText: "Resolved",
      summary: byId.get("two-arbiters")!.sentence,
      step: byId.get("two-arbiters")!,
      whoSigned: byId.get("two-arbiters")!.who,
      whoSubmitted: byId.get("two-arbiters")!.submitted,
      ruleNote: byId.get("two-arbiters")!.cannot,
    },
    {
      id: "auto",
      phase: "Timeout",
      label: "Review period ends on Escrow B",
      escrow: "B",
      milestone: "Milestone 0 · 1.000000 fUSD · 120s review",
      amount: "1.000000 fUSD to freelancer",
      status: "paid",
      statusText: "Auto-released",
      summary: byId.get("auto")!.sentence,
      step: byId.get("auto")!,
      whoSigned: byId.get("auto")!.who,
      whoSubmitted: byId.get("auto")!.submitted,
      ruleNote: byId.get("auto")!.cannot,
    },
  ];
}

const DEAL_STAGES = buildDealStages();

export function HomeDealAndRun() {
  const [stageId, setStageId] = useState<string>("release-0");
  const check = useRecordCheck();
  const current = DEAL_STAGES.find((stage) => stage.id === stageId) ?? DEAL_STAGES[0];
  const anyFailed = Object.values(check.results).some((verdict) => verdict.networkError);

  return (
    <>
      {/* 5. The product itself on the page — one deal, start to finish */}
      <section id="deal" className="mt-20 border-t border-line pt-14 sm:mt-24 sm:pt-16">
        <p className="text-[12px] font-medium tracking-[0.12em] text-muted uppercase">One deal · start to finish</p>
        <h2 className="mt-3 max-w-[24ch] text-[28px] leading-[1.12] font-medium tracking-[-0.03em] sm:text-[36px]">
          Follow one escrow from funding to settlement.
        </h2>
        <p className="mt-3 max-w-[60ch] text-[15px] text-muted">
          The client, the freelancer, and the milestone amount stay fixed through every transition. Select any step to
          read its state and verify its testnet receipt beside it.
        </p>

        {/* Persistent deal header: client, freelancer, milestone amount */}
        <div className="mt-8 rounded-xl bg-surface p-5 shadow-[inset_0_0_0_1px_var(--color-line)] sm:p-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium tracking-[0.1em] text-client uppercase">Client (immutable)</p>
              <p className="num mt-1 text-[13px] text-ink" title={PARTIES.client.evm}>
                {shortAddr(PARTIES.client.evm)}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium tracking-[0.1em] text-freelancer uppercase">
                Freelancer (immutable)
              </p>
              <p className="num mt-1 text-[13px] text-ink" title={PARTIES.freelancer.evm}>
                {shortAddr(PARTIES.freelancer.evm)}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium tracking-[0.1em] text-faint uppercase">Active milestone</p>
              <p className="num mt-1 text-[13px] text-ink">{current.milestone}</p>
              <p className="num mt-0.5 truncate text-[11px] text-faint" title={ESCROWS[current.escrow]}>
                Escrow {current.escrow} · {shortAddr(ESCROWS[current.escrow])}
              </p>
            </div>
          </div>

          <div className="rule my-5" />

          <div className="grid min-w-0 gap-6 lg:grid-cols-[270px_minmax(0,1fr)]">
            {/* Linear-style vertical step rail with #1f6f68 current-step mark */}
            <ol className="space-y-1" aria-label="Deal stages">
              {DEAL_STAGES.map((stage, idx) => {
                const active = stage.id === current.id;
                return (
                  <li key={stage.id}>
                    <button
                      type="button"
                      aria-current={active ? "step" : undefined}
                      onClick={() => setStageId(stage.id)}
                      className={`group flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                        active ? "bg-raise text-ink" : "text-muted hover:bg-raise/60 hover:text-ink"
                      }`}
                    >
                      <span className="mt-1.5 flex shrink-0 items-center">
                        <span
                          className={`h-2 w-2 rounded-full ${active ? "bg-brand" : "bg-line"}`}
                          aria-hidden="true"
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="num text-[11px] text-faint">
                            0{idx + 1} · {stage.phase}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[stage.status]}`}
                          >
                            {stage.statusText}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-[14px] font-medium tracking-[-0.015em] text-ink">
                          {stage.label}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>

            {/* Evidence panel beside the active step */}
            <article className="min-w-0 rounded-xl bg-canvas p-5 shadow-[inset_0_0_0_1px_var(--color-line)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-brand" aria-hidden="true" />
                  <span className="text-[12px] font-medium tracking-[0.08em] text-muted uppercase">
                    Current step · {current.phase}
                  </span>
                </div>
                <span
                  className={`inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-medium ${TONE[current.status]}`}
                >
                  {current.statusText}
                </span>
              </div>

              <h3 className="mt-3 text-[20px] leading-snug font-medium tracking-[-0.025em] text-ink">
                {current.summary}
              </h3>

              <dl className="mt-5 divide-y divide-line border-t border-b border-line text-[14px]">
                <div className="grid gap-1 py-2.5 sm:grid-cols-[140px_minmax(0,1fr)]">
                  <dt className="text-faint">Movement</dt>
                  <dd className="num min-w-0 break-words text-ink">{current.amount}</dd>
                </div>
                <div className="grid gap-1 py-2.5 sm:grid-cols-[140px_minmax(0,1fr)]">
                  <dt className="text-faint">Who signed</dt>
                  <dd className="min-w-0 break-words text-ink">{current.whoSigned}</dd>
                </div>
                <div className="grid gap-1 py-2.5 sm:grid-cols-[140px_minmax(0,1fr)]">
                  <dt className="text-faint">Who submitted</dt>
                  <dd className="min-w-0 break-words text-ink">{current.whoSubmitted}</dd>
                </div>
                <div className="grid gap-1 py-2.5 sm:grid-cols-[140px_minmax(0,1fr)]">
                  <dt className="text-faint">Rule enforced</dt>
                  <dd className="min-w-0 break-words text-muted">{current.ruleNote}</dd>
                </div>
                <div className="grid gap-1 py-2.5 sm:grid-cols-[140px_minmax(0,1fr)]">
                  <dt className="text-faint">Transaction</dt>
                  <dd className="num min-w-0 text-[13px] break-all text-muted">
                    {current.step?.hash ?? current.fundHash ?? "Refused before broadcast"}
                  </dd>
                </div>
              </dl>

              {current.step ? (
                <VerifyStep
                  verdict={check.results[current.step.id]}
                  busy={check.busy}
                  onVerify={() => void check.check(current.step!)}
                  compact
                />
              ) : (
                <p className="mt-4 text-[13px] text-muted">
                  Funding receipt recorded on {RECORDED}. Re-checked offline with{" "}
                  <span className="num text-ink">npm run evidence</span>.
                </p>
              )}
            </article>
          </div>
        </div>
      </section>

      {/* 6. Four steps, in this repository's words */}
      <section id="how" className="mt-20 border-t border-line pt-14 sm:mt-24 sm:pt-16">
        <p className="text-[12px] font-medium tracking-[0.12em] text-muted uppercase">How a milestone moves</p>
        <h2 className="mt-3 max-w-[24ch] text-[28px] leading-[1.12] font-medium tracking-[-0.03em] sm:text-[36px]">
          Four states. Every transition is signed or timed.
        </h2>
        <ol className="mt-8 divide-y divide-line border-t border-b border-line">
          <li className="grid gap-3 py-5 sm:grid-cols-[120px_200px_minmax(0,1fr)] sm:items-baseline">
            <span className="num text-[12px] text-faint">01 · FUND</span>
            <h3 className="text-[16px] font-medium tracking-[-0.02em] text-ink">Fix the two names</h3>
            <p className="text-[15px] text-muted">
              <span className="num text-[13px] text-ink">EscrowFactory.create</span> stores the client, the freelancer,
              one ERC-20 token, three arbiters, the review window, and the default split.{" "}
              <span className="num text-[13px] text-ink">fund</span> marks milestones in order up to the token balance
              and never accepts a recipient.
            </p>
          </li>
          <li className="grid gap-3 py-5 sm:grid-cols-[120px_200px_minmax(0,1fr)] sm:items-baseline">
            <span className="num text-[12px] text-faint">02 · DELIVER</span>
            <h3 className="text-[16px] font-medium tracking-[-0.02em] text-ink">Commit to the sealed file</h3>
            <p className="text-[15px] text-muted">
              The freelancer signs an ML-DSA-87 <span className="num text-[13px] text-ink">deliver</span> message over
              the chain, escrow, nonce, deadline, and file commitment. The ciphertext stays off chain; any relayer can
              submit the signed call without gaining authority.
            </p>
          </li>
          <li className="grid gap-3 py-5 sm:grid-cols-[120px_200px_minmax(0,1fr)] sm:items-baseline">
            <span className="num text-[12px] text-faint">03 · SETTLE</span>
            <h3 className="text-[16px] font-medium tracking-[-0.02em] text-ink">Fresh release or review timeout</h3>
            <p className="text-[15px] text-muted">
              The client signs a fresh ML-DSA-87 <span className="num text-[13px] text-ink">release</span> for that
              exact milestone. If the review window elapses without a dispute,{" "}
              <span className="num text-[13px] text-ink">autoRelease</span> pays the freelancer with no new signature.
            </p>
          </li>
          <li className="grid gap-3 py-5 sm:grid-cols-[120px_200px_minmax(0,1fr)] sm:items-baseline">
            <span className="num text-[12px] text-faint">04 · DISPUTE</span>
            <h3 className="text-[16px] font-medium tracking-[-0.02em] text-ink">Two of three arbiters split</h3>
            <p className="text-[15px] text-muted">
              A signed <span className="num text-[13px] text-ink">dispute</span> stops{" "}
              <span className="num text-[13px] text-ink">autoRelease</span>. Two arbiters combine their sealed shares
              off chain to inspect the file and sign a basis-point split between the same two names. One arbiter reverts{" "}
              <span className="num text-[13px] text-ink">TooFew</span>.
            </p>
          </li>
        </ol>
      </section>

      {/* 7. The recorded run, with Verify this step beside the action it checks */}
      <section id="recorded-run" className="mt-20 border-t border-line pt-14 sm:mt-24 sm:pt-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[12px] font-medium tracking-[0.12em] text-muted uppercase">
              Recorded run · {RECORDED}
            </p>
            <h2 className="mt-3 max-w-[24ch] text-[28px] leading-[1.12] font-medium tracking-[-0.03em] sm:text-[36px]">
              Four scenes on qorechain-diana. Verify each step here.
            </h2>
          </div>
          <Link
            href="/record"
            className="inline-flex h-10 items-center rounded-lg bg-raise px-4 text-sm text-ink shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-surface"
          >
            Inspect full record desk
          </Link>
        </div>

        <VerifyBar
          busy={check.busy}
          progress={check.progress}
          failed={anyFailed}
          onAll={() => void check.checkAll()}
          onRetry={() => void check.retryFailed()}
        />

        <div className="mt-8 space-y-10">
          {SCENES.map((scene) => (
            <div key={scene.id} className="rounded-xl bg-surface p-5 shadow-[inset_0_0_0_1px_var(--color-line)] sm:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-4">
                <div className="min-w-0">
                  <p className="num text-[12px] text-faint">
                    Scene {scene.index} · Escrow {scene.escrow}
                  </p>
                  <h3 className="mt-1 text-[20px] font-medium tracking-[-0.025em] text-ink">{scene.title}</h3>
                  <p className="mt-1 max-w-[60ch] text-[14px] text-muted">{scene.summary}</p>
                </div>
                <Link
                  href={`/record?scene=${scene.id}`}
                  className="shrink-0 text-[13px] text-muted underline underline-offset-4 hover:text-ink"
                >
                  Open scene {scene.index}
                </Link>
              </div>

              <ol className="divide-y divide-line">
                {scene.steps.map((step) => {
                  const verdict = check.results[step.id];
                  const verdictMark = mark(verdict);
                  return (
                    <li
                      key={step.id}
                      className="grid gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)] lg:items-start"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-[0.06em] ${TONE[step.outcome]}`}
                          >
                            {step.error ?? step.outcome}
                          </span>
                          <span className="text-[15px] font-medium text-ink">{step.title}</span>
                          {verdictMark ? (
                            <span className="num text-[11px] text-faint">· {verdictMark}</span>
                          ) : null}
                        </div>
                        <p className="mt-1.5 text-[14px] text-muted">{step.sentence}</p>
                        <p className="mt-1.5 text-[13px] text-faint">
                          Signed: <span className="text-muted">{step.who}</span> · Submitted:{" "}
                          <span className="text-muted">{step.submitted}</span>
                        </p>
                      </div>

                      <div className="min-w-0 rounded-lg bg-canvas p-3.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
                        <p className="num text-[13px] text-ink">{step.amount}</p>
                        {step.hash ? (
                          <p className="num mt-1 text-[12px] break-all text-faint" title={step.hash}>
                            <span className="sm:hidden">{shortHash(step.hash)}</span>
                            <span className="hidden sm:inline">{step.hash}</span>
                          </p>
                        ) : (
                          <p className="mt-1 text-[12px] text-faint">Refused before broadcast. No transaction hash.</p>
                        )}
                        <VerifyStep
                          verdict={verdict}
                          busy={check.busy}
                          onVerify={() => void check.check(step)}
                          compact
                        />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
