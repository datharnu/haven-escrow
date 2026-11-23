"use client";

import { useState } from "react";
import { GATE, checkGate, type GateCheck, type GateRecord } from "@/lib/receipt-gate";
import { browserRpc } from "@/lib/rpc";
import { NETWORK, NetworkError } from "@/lib/verify";

const TONE = {
  paid: "bg-paid-soft text-paid",
  refused: "bg-refused-soft text-refused",
  held: "bg-held-soft text-held",
} as const;

function short(value: string) {
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

/** Scene 6. Renders nothing until `npm run scene:6 -- --broadcast` has written lib/receipt-gate.json. */
export function ReceiptGate({ gate = GATE }: { gate?: GateRecord | null }) {
  if (!gate) return null;
  return <Gate gate={gate} />;
}

function Gate({ gate }: { gate: GateRecord }) {
  const [read, setRead] = useState<GateCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setBusy(true);
    setError(null);
    try {
      setRead(await checkGate(browserRpc(), gate));
    } catch (caught) {
      setRead(null);
      setError(caught instanceof NetworkError ? NETWORK : caught instanceof Error ? caught.message : NETWORK);
    } finally {
      setBusy(false);
    }
  }

  const passed =
    read &&
    read.receiptsMatch &&
    read.clientMatches &&
    read.commitmentMatches &&
    read.receiptRecordedAt > 0n &&
    read.receivedAt > 0n &&
    read.status === 5 &&
    read.receivedSplitBps === 10000;

  return (
    <section
      aria-labelledby="receipt-gate"
      className="min-w-0 max-w-full rounded-xl bg-surface p-4 shadow-[inset_0_0_0_1px_var(--color-line)] sm:p-6"
    >
      <p className="num text-[12px] text-faint">06 · Escrow D · HavenEscrowV2 · {gate.recorded}</p>
      <h2 id="receipt-gate" className="mt-1 text-[26px] font-medium tracking-[-0.03em] text-ink">
        The client can&apos;t pretend they never got the work
      </h2>
      <p className="mt-3 max-w-[62ch] text-[15px] text-muted">
        The client&apos;s device signed a Courier receipt for the sealed file with its own ML-DSA-87 key. Then the client
        disputed and went silent, and so did the arbiters. Anyone recorded that receipt on the escrow; receipts from
        another key, or over the bare ciphertext hash, were refused. After the {gate.arbiterTimeout}-second arbiter
        timeout, the receipt split applied: {(Number(gate.paidToFreelancer) / 1e6).toFixed(6)} fUSD to the freelancer,{" "}
        {(Number(gate.paidToClient) / 1e6).toFixed(6)} fUSD to the client. Without the receipt it would have been 50/50.
      </p>
      <p className="mt-2 max-w-[62ch] text-[13px] text-faint">
        A receipt proves the client&apos;s device signed for the sealed file that matches the commitment. It does not prove
        the work is good. Two arbiters can still sign any split; the receipt only decides what a silent panel pays.
      </p>

      <ol className="mt-5 grid gap-2">
        {gate.steps.map((step) => (
          <li key={step.id} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg bg-canvas px-3 py-2">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${step.error ? "num" : "uppercase"} ${TONE[step.outcome]}`}>
              {step.error ?? step.outcome}
            </span>
            <span className="min-w-0 flex-1 text-[14px] text-ink">{step.title}</span>
            <span className="text-[12px] text-muted">{step.who}</span>
            <span className="num w-full text-[12px] break-all text-faint" title={step.hash}>
              <span className="sm:hidden">{short(step.hash)}</span>
              <span className="hidden sm:inline">{step.hash}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void check()}
          disabled={busy}
          className="h-10 rounded-lg bg-action px-4 text-sm font-medium text-on-action disabled:opacity-60"
        >
          {busy ? "Reading the testnet…" : "Check the receipt on chain"}
        </button>
        <span className="num text-[12px] break-all text-faint" title={gate.escrow}>
          {gate.escrow}
        </span>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-refused">
          {error}
        </p>
      ) : null}
      {read ? (
        <dl role="status" className="mt-3 grid gap-1 text-[13px] sm:grid-cols-[auto_1fr] sm:gap-x-4">
          <dt className="text-faint">Escrow reads DeliveryReceipts</dt>
          <dd className={read.receiptsMatch ? "text-paid" : "text-refused"}>{read.receiptsMatch ? "the pinned address" : "a different address"}</dd>
          <dt className="text-faint">Stored commitment</dt>
          <dd className={read.commitmentMatches ? "text-paid" : "text-refused"}>{read.commitmentMatches ? "matches this record" : "differs"}</dd>
          <dt className="text-faint">Client&apos;s receipt over it</dt>
          <dd className={read.receiptRecordedAt > 0n ? "text-paid" : "text-refused"}>
            {read.receiptRecordedAt > 0n ? `stored at ${read.receiptRecordedAt}` : "not stored"}
          </dd>
          <dt className="text-faint">Receipt recorded on the escrow</dt>
          <dd className={read.receivedAt > 0n ? "text-paid" : "text-refused"}>{read.receivedAt > 0n ? `at ${read.receivedAt}` : "not recorded"}</dd>
          <dt className="text-faint">Milestone 0</dt>
          <dd className={read.status === 5 ? "text-paid" : "text-refused"}>
            {read.status === 5 ? `Resolved; receipt split ${read.receivedSplitBps} bps` : `status ${read.status}`}
          </dd>
          <dt className="text-faint">Result</dt>
          <dd className={passed ? "text-paid" : "text-refused"}>{passed ? "The chain agrees with this record." : "The chain does not match this record."}</dd>
        </dl>
      ) : null}
    </section>
  );
}
