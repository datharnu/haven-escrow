"use client";

import { useId, useState, type ReactNode } from "react";
import { NETWORK } from "@/lib/record";

const ITEMS: { q: string; a: ReactNode }[] = [
  {
    q: "Can any call pay a third address?",
    a: "No. Client and freelancer are immutable state variables set in the constructor. Neither a relayer nor a panel of arbiters can pass another recipient address.",
  },
  {
    q: "Why did cancel in Scene 2 revert with WrongStatus instead of SignatureInvalid?",
    a: (
      <>
        <span className="num text-[13px] text-ink">HavenEscrow.sol</span> checks milestone status before verifying the
        signature. Milestone 1 was already Delivered, so cancel stops immediately. The check order was kept as written.
      </>
    ),
  },
  {
    q: "What does the client's delivery receipt prove?",
    a: (
      <>
        In <span className="num text-[13px] text-ink">HavenEscrowV2</span>, Courier&apos;s{" "}
        <span className="num text-[13px] text-ink">DeliveryReceipts</span> stores a receipt only after{" "}
        <span className="num text-[13px] text-ink">pqcVerify</span> accepts the named recipient&apos;s registered
        ML-DSA-87 key. Anyone can record that receipt on the escrow for the stored client and the stored commitment. If
        the client then disputes and the arbiters stay silent, the timeout pays the freelancer in full instead of the
        default split. It proves the client&apos;s device signed for the sealed file, not that the work is good.
      </>
    ),
  },
  {
    q: "How can I verify the run without your keys?",
    a: (
      <>
        Open the app and click <span className="text-ink">Verify this step</span> or{" "}
        <span className="text-ink">Verify all</span> to query <span className="num text-[13px] text-ink">{NETWORK}</span>{" "}
        directly from your browser, or clone the repository and run{" "}
        <span className="num text-[13px] text-ink">npm run evidence</span>. Neither path uses a private key or sends a
        transaction.
      </>
    ),
  },
  {
    q: "Why do the QCAI audit PDFs say 35/100? (All 12 findings are false positives.)",
    a: (
      <>
        Both dashboard PDFs in <span className="num text-[13px] text-ink">docs/audit/</span> score 35/100, and all 12
        findings are false positives. 8 name functions that do not exist in{" "}
        <span className="num text-[13px] text-ink">src/</span> (
        <span className="num text-[13px] text-ink">withdraw</span>,{" "}
        <span className="num text-[13px] text-ink">setFee</span>,{" "}
        <span className="num text-[13px] text-ink">calculateFee</span>,{" "}
        <span className="num text-[13px] text-ink">deposit</span>,{" "}
        <span className="num text-[13px] text-ink">getBalances</span>); the other 4 name categories (admin, balance,
        transfer, batch functions) whose issue the code does not have. Each is mapped in{" "}
        <span className="num text-[13px] text-ink">docs/AUDIT.md</span>, and{" "}
        <span className="num text-[13px] text-ink">npm run audit:check</span> re-checks all 12 against the source.
        The Stage 1 run on <span className="num text-[13px] text-ink">HavenEscrowV2</span> (24 November 2026) also
        scored 35/100 with 6 findings citing functions not in the paste; its Stage 2 runs on 25 November 2026.
      </>
    ),
  },
];

export function Questions() {
  const baseId = useId();
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="mt-20 border-t border-line pt-14 sm:mt-28 sm:pt-16" aria-labelledby="faq-heading">
      <h2 id="faq-heading" className="text-[32px] leading-[1.08] font-medium tracking-[-0.035em] text-ink sm:text-[44px]">
        Questions
      </h2>
      <div className="mt-8 grid items-start gap-3 lg:grid-cols-2 lg:gap-4">
        {ITEMS.map((item, index) => {
          const expanded = open === index;
          const buttonId = `${baseId}-q-${index}`;
          const panelId = `${baseId}-a-${index}`;
          return (
            <div
              key={item.q}
              className={`min-w-0 rounded-xl shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors ${expanded ? "bg-raise" : "bg-surface hover:bg-raise"}`}
            >
              <h3>
                <button
                  id={buttonId}
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => setOpen(expanded ? null : index)}
                  className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left sm:px-5"
                >
                  <span className="text-[16px] leading-snug font-medium tracking-[-0.02em] text-ink">{item.q}</span>
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted shadow-[inset_0_0_0_1px_var(--color-line)] transition-transform duration-200 motion-reduce:transition-none ${expanded ? "rotate-45 bg-brand-soft text-brand shadow-none" : ""}`}
                    aria-hidden="true"
                  >
                    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none">
                      <path d="M7 1.5v11M1.5 7h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </span>
                </button>
              </h3>
              <div
                className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
              >
                <div className="overflow-hidden" inert={expanded ? undefined : true}>
                  <div
                    id={panelId}
                    role="region"
                    aria-labelledby={buttonId}
                    className="px-4 pb-5 text-[15px] leading-relaxed text-muted sm:px-5"
                  >
                    {item.a}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
