import Link from "next/link";
import { HomeDealAndRun } from "@/components/home-deal";
import { ESCROWS, NETWORK, RECORDED } from "@/lib/record";

const FACTORY = "0xf30bfc219987E60e849D5cF9e7351b7380eEc09B";
const FUSD = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";

export default function Home() {
  return (
    <main className="mx-auto max-w-[1080px] px-5 pt-12 pb-28 sm:pt-20">
      {/* 1. Small eyebrow with the chain name */}
      <p className="num text-[12px] tracking-[0.14em] text-muted uppercase">
        {NETWORK} · EVM chain 9800 · Recorded {RECORDED}
      </p>

      {/* 2. Headline stating the rule and what happens if it is broken */}
      <h1 className="mt-4 max-w-[19ch] text-[38px] leading-[1.06] font-medium tracking-[-0.035em] text-ink sm:text-[54px]">
        Only the <span className="serif text-muted">two names</span> at creation can be paid. Any other key or address is
        refused.
      </h1>

      {/* 3. One thesis sentence */}
      <p className="mt-5 max-w-[58ch] text-[17px] leading-[1.6] text-muted">
        Every release requires a fresh ML-DSA-87 signature from the named party, or a review timeout both parties
        accepted when the escrow was created.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link
          href="/record"
          className="inline-flex h-11 items-center rounded-lg bg-action px-5 text-[15px] font-medium text-on-action transition-opacity hover:opacity-90 active:scale-[0.98]"
        >
          Open the record
        </Link>
        <Link
          href="/practice"
          className="inline-flex h-11 items-center rounded-lg bg-raise px-5 text-[15px] text-ink shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-surface"
        >
          Practice deal
        </Link>
        <a
          href="#deal"
          className="inline-flex h-11 items-center px-2 text-[14px] text-muted underline underline-offset-4 hover:text-ink"
        >
          Follow the deal below
        </a>
      </div>

      {/* Visual anchor: docs/featured.png */}
      <figure className="mt-12 overflow-hidden rounded-2xl border border-line bg-[#f3f0e8]">
        <img
          src="/featured.png"
          alt="Haven Escrow — Two names on the line: Client 0xB911…66bf and Freelancer 0x4D0D…7764. No later call can add a third name."
          width={1200}
          height={630}
          className="block h-auto w-full"
        />
      </figure>

      {/* 4. Problem section in Haven's own words + recorded result beside it */}
      <section id="problem" className="mt-20 border-t border-line pt-14 sm:mt-24 sm:pt-16">
        <p className="text-[12px] font-medium tracking-[0.12em] text-muted uppercase">The problem</p>
        <h2 className="mt-3 max-w-[26ch] text-[28px] leading-[1.12] font-medium tracking-[-0.03em] sm:text-[36px]">
          A stolen classical key or a third recipient address cannot move the escrow.
        </h2>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-4 text-[15px] leading-[1.65] text-muted">
            <p>
              On an ordinary chain, the key that signs a transaction can also decide who gets paid. If a client&apos;s
              secp256k1 key is stolen—or if a quantum break forges classical signatures—an attacker can call a payout
              function and name their own address as the recipient.
            </p>
            <p>
              Haven Escrow removes both paths from the contract.{" "}
              <span className="text-ink">No function in HavenEscrow.sol accepts a recipient address.</span>{" "}
              <span className="num text-[13px] text-ink">release</span>,{" "}
              <span className="num text-[13px] text-ink">autoRelease</span>,{" "}
              <span className="num text-[13px] text-ink">refund</span>,{" "}
              <span className="num text-[13px] text-ink">resolve</span>,{" "}
              <span className="num text-[13px] text-ink">resolveTimeout</span>,{" "}
              <span className="num text-[13px] text-ink">cancel</span>, and{" "}
              <span className="num text-[13px] text-ink">sweep</span> can only pay the immutable client or freelancer.
            </p>
            <p>
              Every party action is checked through QoreChain&apos;s <span className="num text-[13px] text-ink">pqcVerify</span>{" "}
              precompile (<span className="num text-[13px] text-ink">0x…0a01</span>) over a domain-separated ML-DSA-87
              message bound to the chain, escrow, signer, action, nonce, deadline, and milestone.
            </p>
          </div>

          <div className="rounded-xl bg-surface p-5 shadow-[inset_0_0_0_1px_var(--color-line)] sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[12px] font-medium tracking-[0.1em] text-muted uppercase">
                Recorded on Escrow A · {RECORDED}
              </p>
              <span className="rounded-full bg-refused-soft px-2.5 py-0.5 text-[11px] font-medium tracking-[0.06em] text-refused uppercase">
                0.000000 fUSD moved
              </span>
            </div>
            <p className="mt-2 text-[14px] text-muted">
              Milestone 1 held <span className="num text-ink">1.000000 fUSD</span>. The client&apos;s own secp256k1 key
              tried five ways to take it.
            </p>
            <ul className="mt-4 divide-y divide-line border-t border-line text-[13px]">
              <li className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                <span className="text-ink">Release with no open EVM window</span>
                <span className="num text-refused">Refused before broadcast</span>
              </li>
              <li className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                <span className="text-ink">Classical MsgOpenEVMWindow</span>
                <span className="num text-refused">Code 20 · hybrid PQC required</span>
              </li>
              <li className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                <span className="text-ink">Junk signature inside an open window</span>
                <span className="num text-refused">SignatureInvalid</span>
              </li>
              <li className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                <span className="text-ink">Replayed milestone-0 ML-DSA signature</span>
                <span className="num text-refused">SignatureInvalid</span>
              </li>
              <li className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                <span className="text-ink">Call to release(uint256,address)</span>
                <span className="num text-refused">Reverted · no recipient arg</span>
              </li>
            </ul>
            <p className="num mt-4 text-[12px] text-faint">
              Escrow A balance before and after Scene 2: 1.000000 fUSD.
            </p>
          </div>
        </div>
      </section>

      {/* 5, 6, 7: One Deal interactive walkthrough + 4 steps + Recorded Run with Verify this step */}
      <HomeDealAndRun />

      {/* Recorded testnet contracts */}
      <section className="mt-14">
        <p className="text-[12px] font-medium tracking-[0.12em] text-muted uppercase">Recorded contracts · {NETWORK}</p>
        <dl className="mt-4 grid gap-px overflow-hidden rounded-xl bg-line shadow-[inset_0_0_0_1px_var(--color-line)] sm:grid-cols-2">
          <div className="bg-surface px-4 py-4">
            <dt className="text-[12px] text-faint">Escrow A · two milestones · 1-day review</dt>
            <dd className="num mt-1 text-[13px] break-all text-ink">{ESCROWS.A}</dd>
          </div>
          <div className="bg-surface px-4 py-4">
            <dt className="text-[12px] text-faint">Escrow B · one milestone · 120-second review</dt>
            <dd className="num mt-1 text-[13px] break-all text-ink">{ESCROWS.B}</dd>
          </div>
          <div className="bg-surface px-4 py-4">
            <dt className="text-[12px] text-faint">EscrowFactory</dt>
            <dd className="num mt-1 text-[13px] break-all text-ink">{FACTORY}</dd>
          </div>
          <div className="bg-surface px-4 py-4">
            <dt className="text-[12px] text-faint">fUSD · 6 decimals · testnet token</dt>
            <dd className="num mt-1 text-[13px] break-all text-ink">{FUSD}</dd>
          </div>
        </dl>
      </section>

      {/* 8. What this does not do */}
      <section id="limits" className="mt-20 border-t border-line pt-14 sm:mt-24 sm:pt-16">
        <p className="text-[12px] font-medium tracking-[0.12em] text-muted uppercase">Limits</p>
        <h2 className="mt-3 max-w-[24ch] text-[28px] leading-[1.12] font-medium tracking-[-0.03em] sm:text-[36px]">
          What this does not do.
        </h2>
        <dl className="mt-8 divide-y divide-line border-t border-b border-line">
          <div className="grid gap-2 py-4 sm:grid-cols-[240px_minmax(0,1fr)]">
            <dt className="text-[15px] font-medium text-ink">Stop two colluding arbiters</dt>
            <dd className="text-[15px] text-muted">
              Two of three arbiters can sign any basis-point split between 0 and 10000 and can combine their sealed
              shares to read the file. The chain does not judge whether their split is fair.
            </dd>
          </div>
          <div className="grid gap-2 py-4 sm:grid-cols-[240px_minmax(0,1fr)]">
            <dt className="text-[15px] font-medium text-ink">Run on mainnet or hold real value</dt>
            <dd className="text-[15px] text-muted">
              All recorded runs are on <span className="num text-[13px] text-ink">{NETWORK}</span>. The fUSD token is a
              testnet token with no monetary value.
            </dd>
          </div>
          <div className="grid gap-2 py-4 sm:grid-cols-[240px_minmax(0,1fr)]">
            <dt className="text-[15px] font-medium text-ink">Store or recover the deliverable file</dt>
            <dd className="text-[15px] text-muted">
              Only the commitment hash is stored on chain. If the ciphertext, file key, or arbiter shares are lost off
              chain, the contract cannot reconstruct them.
            </dd>
          </div>
          <div className="grid gap-2 py-4 sm:grid-cols-[240px_minmax(0,1fr)]">
            <dt className="text-[15px] font-medium text-ink">Hide deal metadata</dt>
            <dd className="text-[15px] text-muted">
              The two party addresses, milestone amounts, review deadlines, and file commitment hash are public on chain.
            </dd>
          </div>
          <div className="grid gap-2 py-4 sm:grid-cols-[240px_minmax(0,1fr)]">
            <dt className="text-[15px] font-medium text-ink">Record a live resolveTimeout receipt</dt>
            <dd className="text-[15px] text-muted">
              The silent-panel default split (<span className="num text-[13px] text-ink">resolveTimeout</span>, 5000
              bps) is covered by Foundry tests. In Scene 3, two arbiters settled before the timeout expired.
            </dd>
          </div>
        </dl>
      </section>

      {/* 9. Short FAQ */}
      <section id="faq" className="mt-20 border-t border-line pt-14 sm:mt-24 sm:pt-16">
        <p className="text-[12px] font-medium tracking-[0.12em] text-muted uppercase">Questions</p>
        <h2 className="mt-3 text-[28px] leading-[1.12] font-medium tracking-[-0.03em] sm:text-[36px]">FAQ</h2>
        <dl className="mt-8 divide-y divide-line border-t border-b border-line">
          <div className="py-5">
            <dt className="text-[16px] font-medium text-ink">Can any call pay a third address?</dt>
            <dd className="mt-2 max-w-[66ch] text-[15px] text-muted">
              No. Client and freelancer are immutable state variables set in the constructor. Neither a relayer nor a
              panel of arbiters can pass another recipient address.
            </dd>
          </div>
          <div className="py-5">
            <dt className="text-[16px] font-medium text-ink">
              Why did cancel in Scene 2 revert with WrongStatus instead of SignatureInvalid?
            </dt>
            <dd className="mt-2 max-w-[66ch] text-[15px] text-muted">
              <span className="num text-[13px] text-ink">HavenEscrow.sol</span> checks milestone status before verifying
              the signature. Milestone 1 was already Delivered, so cancel stops immediately. The check order was kept as
              written.
            </dd>
          </div>
          <div className="py-5">
            <dt className="text-[16px] font-medium text-ink">How can I verify the run without your keys?</dt>
            <dd className="mt-2 max-w-[66ch] text-[15px] text-muted">
              Click <span className="text-ink">Verify this step</span> or <span className="text-ink">Verify all</span>{" "}
              above to query <span className="num text-[13px] text-ink">{NETWORK}</span> directly from your browser, or
              clone the repository and run <span className="num text-[13px] text-ink">npm run evidence</span>. Neither
              path uses a private key or sends a transaction.
            </dd>
          </div>
          <div className="py-5">
            <dt className="text-[16px] font-medium text-ink">What about the 35/100 QCAI audit PDFs?</dt>
            <dd className="mt-2 max-w-[66ch] text-[15px] text-muted">
              Both dashboard PDFs in <span className="num text-[13px] text-ink">docs/audit/</span> flag functions
              (<span className="num text-[13px] text-ink">withdraw</span>,{" "}
              <span className="num text-[13px] text-ink">setFee</span>,{" "}
              <span className="num text-[13px] text-ink">deposit</span>) that do not exist in{" "}
              <span className="num text-[13px] text-ink">HavenEscrow.sol</span>.{" "}
              <span className="num text-[13px] text-ink">docs/AUDIT.md</span> maps each finding to the actual contract
              and tests.
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
