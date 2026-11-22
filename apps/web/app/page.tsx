import type { ReactNode } from "react";
import Link from "next/link";
import { NetworkName } from "@/components/network-name";
import { Questions } from "@/components/questions";
import { ESCROWS, NETWORK, RECORDED, SCENES } from "@/lib/record";

const FACTORY = "0xf30bfc219987E60e849D5cF9e7351b7380eEc09B";
const FUSD = "0x97143B771D34ddb9130b807b135Ae675a5a963CA";

export default function Home() {
  return (
    <main className="mx-auto max-w-[1120px] px-5 pt-16 pb-28 sm:pt-24">
      <section className="grid items-end gap-8 lg:grid-cols-2 lg:gap-16">
        <div className="min-w-0">
          <p className="num flex flex-wrap gap-x-2 text-[12px] tracking-[0.14em] text-muted uppercase">
            <NetworkName />
            <span className="whitespace-nowrap">· EVM chain 9800</span>
            <span className="whitespace-nowrap">· Recorded {RECORDED}</span>
          </p>
          <h1 className="mt-4 max-w-[14ch] text-[40px] leading-[1.02] font-medium tracking-[-0.04em] text-ink sm:text-[64px]">
            Only the <span className="serif text-muted">two names</span> can be paid.
          </h1>
        </div>
        <div className="min-w-0 max-w-[46ch] lg:justify-self-end">
          <p className="text-[17px] leading-[1.55] text-muted">
            A release needs a fresh ML-DSA-87 signature from the named party, or the review timeout both parties
            accepted when the escrow was created. Any other key or address is refused.
          </p>
          <a href="#states" className="mt-5 inline-flex items-center gap-1.5 text-[14px] text-ink hover:opacity-80">
            How a payment moves
            <span aria-hidden="true">→</span>
          </a>
        </div>
      </section>

      <section className="mt-12 rounded-xl bg-surface p-5 shadow-[inset_0_0_0_1px_var(--color-line)] sm:mt-16 sm:p-6" aria-label="Recorded refusals">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[12px] font-medium tracking-[0.1em] text-muted uppercase">Escrow A · {RECORDED}</p>
          <span className="rounded-full bg-refused-soft px-2.5 py-0.5 text-[11px] font-medium tracking-[0.06em] text-refused uppercase">
            0.000000 fUSD moved
          </span>
        </div>
        <p className="mt-3 max-w-[68ch] text-[15px] leading-relaxed text-muted">
          Milestone 1 held <span className="num text-ink">1.000000 fUSD</span>. The client’s own secp256k1 key tried five
          ways to take it. No function accepts a recipient address.
        </p>
        <ul className="mt-5 divide-y divide-line border-t border-line text-[13px]">
          <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
            <span className="text-ink">Release with no open EVM window</span>
            <span className="num text-refused">Refused before broadcast</span>
          </li>
          <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
            <span className="text-ink">Classical MsgOpenEVMWindow</span>
            <span className="num text-refused">Code 20 · hybrid PQC required</span>
          </li>
          <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
            <span className="text-ink">Junk signature inside an open window</span>
            <span className="num text-refused">SignatureInvalid</span>
          </li>
          <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
            <span className="text-ink">Replayed milestone-0 ML-DSA signature</span>
            <span className="num text-refused">SignatureInvalid</span>
          </li>
          <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
            <span className="text-ink">Call to release(uint256,address)</span>
            <span className="num text-refused">Reverted · no recipient arg</span>
          </li>
        </ul>
      </section>

      <section className="mt-20 grid gap-12 sm:mt-28 lg:grid-cols-3 lg:gap-0" aria-label="The rule in three figures">
        <Figure index="0.1" title="Two names" body="Client and freelancer are fixed at creation. A payout cannot name anyone else.">
          <TwoNames />
        </Figure>
        <Figure
          index="0.2"
          title="A fresh signature"
          body="Each release is a new ML-DSA-87 signature, checked at pqcVerify. The last signature does not pay the next milestone."
        >
          <FreshSignature />
        </Figure>
        <Figure
          index="0.3"
          title="A panel that cannot be paid"
          body="Two of three arbiters can split the milestone. The split still pays only the two names."
        >
          <Panel />
        </Figure>
      </section>

      <section id="states" className="mt-20 scroll-mt-20 border-t border-line pt-14 sm:mt-28 sm:pt-16">
        <div className="grid items-end gap-6 lg:grid-cols-2 lg:gap-16">
          <h2 className="max-w-[16ch] text-[32px] leading-[1.08] font-medium tracking-[-0.035em] text-ink sm:text-[44px]">
            Four states. Every transition is signed or timed.
          </h2>
          <p className="max-w-[42ch] text-[16px] leading-relaxed text-muted lg:justify-self-end">
            Fund stores the two names. Deliver commits the file. Settle pays the freelancer. Dispute lets two arbiters
            split the same two names.
          </p>
        </div>
        <ol className="mt-10 divide-y divide-line border-t border-b border-line">
          <li className="grid gap-2 py-5 sm:grid-cols-[88px_minmax(0,220px)_minmax(0,1fr)] sm:items-baseline sm:gap-6">
            <span className="num text-[12px] text-faint">01</span>
            <h3 className="text-[16px] font-medium tracking-[-0.02em] text-ink">Fund</h3>
            <p className="text-[15px] leading-relaxed text-muted">
              <span className="num text-[13px] text-ink">EscrowFactory.create</span> stores the client, the freelancer,
              one token, three arbiters, and the review window. <span className="num text-[13px] text-ink">fund</span>{" "}
              never accepts a recipient.
            </p>
          </li>
          <li className="grid gap-2 py-5 sm:grid-cols-[88px_minmax(0,220px)_minmax(0,1fr)] sm:items-baseline sm:gap-6">
            <span className="num text-[12px] text-faint">02</span>
            <h3 className="text-[16px] font-medium tracking-[-0.02em] text-ink">Deliver</h3>
            <p className="text-[15px] leading-relaxed text-muted">
              The freelancer signs <span className="num text-[13px] text-ink">deliver</span> over the chain, the escrow,
              and the file commitment. The ciphertext stays off chain.
            </p>
          </li>
          <li className="grid gap-2 py-5 sm:grid-cols-[88px_minmax(0,220px)_minmax(0,1fr)] sm:items-baseline sm:gap-6">
            <span className="num text-[12px] text-faint">03</span>
            <h3 className="text-[16px] font-medium tracking-[-0.02em] text-ink">Settle</h3>
            <p className="text-[15px] leading-relaxed text-muted">
              The client signs a fresh <span className="num text-[13px] text-ink">release</span>. If the review ends
              without a dispute, <span className="num text-[13px] text-ink">autoRelease</span> pays the freelancer with
              no new signature.
            </p>
          </li>
          <li className="grid gap-2 py-5 sm:grid-cols-[88px_minmax(0,220px)_minmax(0,1fr)] sm:items-baseline sm:gap-6">
            <span className="num text-[12px] text-faint">04</span>
            <h3 className="text-[16px] font-medium tracking-[-0.02em] text-ink">Dispute</h3>
            <p className="text-[15px] leading-relaxed text-muted">
              A signed dispute stops the timeout. Two arbiters sign a basis-point split between the same two names. One
              arbiter reverts <span className="num text-[13px] text-ink">TooFew</span>.
            </p>
          </li>
        </ol>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SCENES.map((scene) => (
            <li key={scene.id} className="min-w-0">
              <Link
                href={`/record?scene=${scene.id}`}
                className="flex h-full min-w-0 flex-col rounded-xl bg-surface p-4 shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-raise"
              >
                <span className="num text-[11px] tracking-[0.12em] text-faint">{scene.index}</span>
                <span className="mt-3 text-[15px] font-medium tracking-[-0.02em] text-ink">{scene.title}</span>
                <span className="mt-2 text-[13px] leading-relaxed text-muted">{scene.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-14" aria-label="Recorded contracts">
        <p className="flex flex-wrap items-center gap-x-2 text-[12px] font-medium tracking-[0.12em] text-muted uppercase">
          <span>Contracts</span>
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true">·</span>
            <NetworkName />
          </span>
        </p>
        <dl className="mt-4 grid gap-px overflow-hidden rounded-xl bg-line shadow-[inset_0_0_0_1px_var(--color-line)] sm:grid-cols-2">
          <div className="min-w-0 bg-surface px-4 py-4">
            <dt className="text-[12px] text-faint">Escrow A · two milestones · 1-day review</dt>
            <dd className="num mt-1 text-[13px] break-all text-ink">{ESCROWS.A}</dd>
          </div>
          <div className="min-w-0 bg-surface px-4 py-4">
            <dt className="text-[12px] text-faint">Escrow B · one milestone · 120-second review</dt>
            <dd className="num mt-1 text-[13px] break-all text-ink">{ESCROWS.B}</dd>
          </div>
          <div className="min-w-0 bg-surface px-4 py-4">
            <dt className="text-[12px] text-faint">EscrowFactory</dt>
            <dd className="num mt-1 text-[13px] break-all text-ink">{FACTORY}</dd>
          </div>
          <div className="min-w-0 bg-surface px-4 py-4">
            <dt className="text-[12px] text-faint">fUSD · 6 decimals · testnet token</dt>
            <dd className="num mt-1 text-[13px] break-all text-ink">{FUSD}</dd>
          </div>
        </dl>
      </section>

      <section id="limits" className="mt-20 border-t border-line pt-14 sm:mt-28 sm:pt-16">
        <div className="grid items-end gap-6 lg:grid-cols-2 lg:gap-16">
          <h2 className="max-w-[12ch] text-[32px] leading-[1.08] font-medium tracking-[-0.035em] text-ink sm:text-[44px]">
            What this does not do.
          </h2>
          <p className="max-w-[42ch] text-[16px] leading-relaxed text-muted lg:justify-self-end">
            The recorded runs are on {NETWORK}. The limits below are the ones the contract does not close.
          </p>
        </div>
        <dl className="mt-10 divide-y divide-line border-t border-b border-line">
          <div className="grid gap-2 py-4 sm:grid-cols-[240px_minmax(0,1fr)]">
            <dt className="text-[15px] font-medium text-ink">Stop two colluding arbiters</dt>
            <dd className="text-[15px] leading-relaxed text-muted">
              Two of three arbiters can sign any basis-point split between 0 and 10000 and can combine their sealed
              shares to read the file. The chain does not judge whether their split is fair.
            </dd>
          </div>
          <div className="grid gap-2 py-4 sm:grid-cols-[240px_minmax(0,1fr)]">
            <dt className="text-[15px] font-medium text-ink">Run on mainnet or hold real value</dt>
            <dd className="text-[15px] leading-relaxed text-muted">
              All recorded runs are on <span className="num text-[13px] text-ink">{NETWORK}</span>. The fUSD token is a
              testnet token with no monetary value.
            </dd>
          </div>
          <div className="grid gap-2 py-4 sm:grid-cols-[240px_minmax(0,1fr)]">
            <dt className="text-[15px] font-medium text-ink">Store or recover the deliverable file</dt>
            <dd className="text-[15px] leading-relaxed text-muted">
              Only the commitment hash is stored on chain. If the ciphertext, file key, or arbiter shares are lost off
              chain, the contract cannot reconstruct them.
            </dd>
          </div>
          <div className="grid gap-2 py-4 sm:grid-cols-[240px_minmax(0,1fr)]">
            <dt className="text-[15px] font-medium text-ink">Hide deal metadata</dt>
            <dd className="text-[15px] leading-relaxed text-muted">
              The two party addresses, milestone amounts, review deadlines, and file commitment hash are public on chain.
            </dd>
          </div>
          <div className="grid gap-2 py-4 sm:grid-cols-[240px_minmax(0,1fr)]">
            <dt className="text-[15px] font-medium text-ink">Record a live resolveTimeout receipt</dt>
            <dd className="text-[15px] leading-relaxed text-muted">
              The silent-panel default split (<span className="num text-[13px] text-ink">resolveTimeout</span>, 5000
              bps) is covered by Foundry tests. In Scene 3, two arbiters settled before the timeout expired.
            </dd>
          </div>
        </dl>
      </section>

      <Questions />
    </main>
  );
}

function Figure({ index, title, body, children }: { index: string; title: string; body: string; children: ReactNode }) {
  return (
    <article className="flex min-w-0 flex-col border-t border-line pt-8 first:border-t-0 first:pt-0 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8 lg:first:border-l-0 lg:first:pl-0">
      <p className="num text-[11px] tracking-[0.16em] text-faint">FIG {index}</p>
      <div className="mt-6 flex h-36 items-center text-muted">{children}</div>
      <h2 className="mt-4 text-[16px] font-medium tracking-[-0.02em] text-ink">{title}</h2>
      <p className="mt-2 max-w-[36ch] text-[14px] leading-relaxed text-muted">{body}</p>
    </article>
  );
}

function TwoNames() {
  return (
    <svg viewBox="0 0 220 120" className="h-32 w-auto max-w-full" fill="none" aria-hidden="true">
      <rect x="18" y="14" width="184" height="92" rx="18" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="86" cy="60" r="6" fill="var(--color-client)" />
      <circle cx="134" cy="60" r="6" fill="var(--color-freelancer)" />
      <path d="M94 60h28" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function FreshSignature() {
  return (
    <svg viewBox="0 0 220 120" className="h-32 w-auto max-w-full" fill="none" aria-hidden="true">
      <path d="M28 78c18-28 28-8 40-8 14 0 10 22 26 18 12-3 14-24 28-22 10 2 12 16 24 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M36 46c16-18 24 2 36-2 12-4 8 16 22 12 10-3 14-16 26-12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.45" />
      <path d="M34 40 148 62" stroke="var(--color-refused)" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function Panel() {
  return (
    <svg viewBox="0 0 220 120" className="h-32 w-auto max-w-full" fill="none" aria-hidden="true">
      <circle cx="78" cy="28" r="3.5" fill="currentColor" />
      <circle cx="110" cy="28" r="3.5" fill="currentColor" />
      <circle cx="142" cy="28" r="3.5" fill="currentColor" />
      <path d="M110 34v16" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="2 3" />
      <circle cx="86" cy="78" r="6" fill="var(--color-client)" />
      <circle cx="134" cy="78" r="6" fill="var(--color-freelancer)" />
      <path d="M94 78h28" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
