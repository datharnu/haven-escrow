import { NetworkName } from "@/components/network-name";
import { PracticeDesk } from "./desk";

export default function PracticePage() {
  return (
    <main className="w-full px-4 pt-4 pb-24 sm:px-6 lg:px-8 lg:pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-[18px] leading-snug font-medium tracking-[-0.02em]">
          A deal you can fund, and then <span className="serif text-muted">refuse</span>.
        </h1>
        <p className="num inline-flex items-center gap-1.5 text-[12px] text-faint">
          <NetworkName />
          <span>· one milestone</span>
        </p>
      </div>
      <p className="mt-1 max-w-[68ch] text-[13px] text-muted">
        A transaction sends only after you confirm. This does not use the recorded escrows, the project accounts, or the
        spike wallet.
      </p>
      <PracticeDesk />
    </main>
  );
}
