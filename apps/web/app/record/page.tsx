import { Desk } from "./desk";
import { NETWORK, RECORDED } from "@/lib/record";

export default async function RecordPage({ searchParams }: { searchParams: Promise<{ scene?: string }> }) {
  const { scene } = await searchParams;
  return (
    <main className="mx-auto max-w-[1080px] px-5 pt-12 pb-24">
      <p className="num text-[12px] tracking-[0.14em] text-muted uppercase">
        {NETWORK} · Recorded {RECORDED}
      </p>
      <h1 className="mt-3 max-w-[18ch] text-[36px] leading-[1.08] font-medium tracking-[-0.035em] sm:text-[48px]">
        What the chain <span className="serif text-muted">already did</span>.
      </h1>
      <p className="mt-4 max-w-[60ch] text-[16px] leading-[1.6] text-muted">
        Recorded on {RECORDED}. Opening a step does not send a transaction. Verify this step reads that transaction from
        the testnet and checks the signature. A hash that is not in this file stays unmatched.{" "}
        <span className="num text-[13px] text-ink">npm run evidence</span> re-checks the same hashes from the repository.
      </p>
      <div className="mt-8">
        <Desk initialScene={scene ?? "release"} />
      </div>
    </main>
  );
}
