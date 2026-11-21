import { Desk } from "./desk";
import { RECORDED } from "@/lib/record";

export default async function RecordPage({ searchParams }: { searchParams: Promise<{ scene?: string }> }) {
  const { scene } = await searchParams;
  return (
    <main className="mx-auto max-w-[1080px] px-5 py-10 pb-20">
      <p className="text-[13px] tracking-[0.16em] text-brand uppercase">02 · Record · replay</p>
      <h1 className="mt-3 max-w-[18ch] text-[36px] leading-[1.08] tracking-[-0.035em] sm:text-[48px]">
        What the chain <span className="serif text-muted">already did</span>.
      </h1>
      <p className="mt-4 max-w-[58ch] text-[16px] text-muted">
        Recorded on {RECORDED}. Opening a step does not send a transaction. Verify this step reads that transaction
        from the testnet and checks the signature. A hash that is not in this file stays unmatched.{" "}
        <span className="num text-[13px]">npm run evidence</span> re-checks the same hashes from the repository.
      </p>
      <div className="mt-8">
        <Desk initialScene={scene ?? "release"} />
      </div>
    </main>
  );
}
