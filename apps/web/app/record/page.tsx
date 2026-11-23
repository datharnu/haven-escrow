import { ReceiptGate } from "@/components/receipt-gate";
import { GATE } from "@/lib/receipt-gate";
import { Desk } from "./desk";

export default async function RecordPage({ searchParams }: { searchParams: Promise<{ scene?: string }> }) {
  const { scene } = await searchParams;
  return (
    <main className="w-full px-3 pt-2 pb-24 sm:px-4 lg:px-5">
      <Desk initialScene={scene ?? "release"} />
      {GATE ? (
        <div className="mt-8 lg:pl-[240px]">
          <ReceiptGate gate={GATE} />
        </div>
      ) : null}
    </main>
  );
}
