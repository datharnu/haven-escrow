import Link from "next/link";
import { PaymentLine } from "@/components/line";
import { ESCROWS, RECORDED, SCENES } from "@/lib/record";

export default function Home() {
  return (
    <main className="mx-auto max-w-[1080px] px-5 pt-12 pb-24 sm:pt-20">
      <p className="text-[13px] tracking-[0.16em] text-brand uppercase">01 · Record · two names</p>
      <h1 className="mt-4 max-w-[16ch] text-[40px] leading-[1.05] font-medium tracking-[-0.035em] sm:text-[56px]">
        Funds leave only for the <span className="serif text-muted">two names</span> on the line.
      </h1>
      <p className="mt-5 max-w-[54ch] text-[17px] text-muted">
        A release needs a fresh ML-DSA-87 signature, or a timeout those two people already accepted. This site replays
        the four testnet scenes. It does not connect a wallet and it does not send a transaction.
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link
          href="/record"
          className="inline-flex h-12 items-center rounded-lg bg-brand px-5 text-[15px] text-on-brand shadow-[0_0_0_0_var(--color-canvas)] transition-[box-shadow,transform] duration-300 hover:shadow-[0_0_0_2px_var(--color-canvas),0_0_0_4px_color-mix(in_srgb,var(--color-brand)_55%,transparent)] active:scale-[0.97]"
        >
          Open the record
        </Link>
        <span className="num text-[12px] text-faint">
          {RECORDED} · qorechain-diana
        </span>
      </div>

      <div className="mt-12 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ol className="grid gap-3 sm:grid-cols-2">
          {SCENES.map((scene) => (
            <li key={scene.id}>
              <Link
                href={`/record?scene=${scene.id}`}
                className="block h-full rounded-xl bg-surface p-4 shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-raise"
              >
                <span className="num text-[12px] text-faint">{scene.index}</span>
                <h2 className="mt-2 text-[18px] tracking-[-0.03em]">{scene.title}</h2>
                <p className="mt-2 text-[14px] text-muted">{scene.summary}</p>
              </Link>
            </li>
          ))}
        </ol>
        <PaymentLine />
      </div>

      <dl className="mt-10 grid gap-px overflow-hidden rounded-xl bg-line shadow-[inset_0_0_0_1px_var(--color-line)] sm:grid-cols-2">
        <div className="bg-surface px-4 py-4">
          <dt className="text-[13px] text-faint">Escrow A</dt>
          <dd className="num mt-1 text-[13px] break-all">{ESCROWS.A}</dd>
        </div>
        <div className="bg-surface px-4 py-4">
          <dt className="text-[13px] text-faint">Escrow B · 120 second review</dt>
          <dd className="num mt-1 text-[13px] break-all">{ESCROWS.B}</dd>
        </div>
      </dl>
    </main>
  );
}
