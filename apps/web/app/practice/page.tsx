import { PracticeDesk } from "./desk";

export default function PracticePage() {
  return (
    <main className="mx-auto max-w-[1080px] px-5 pt-12 pb-24">
      <p className="num text-[12px] tracking-[0.14em] text-muted uppercase">qorechain-diana · Practice · one milestone</p>
      <h1 className="mt-3 max-w-[18ch] text-[36px] leading-[1.08] font-medium tracking-[-0.035em] sm:text-[48px]">
        A deal you can fund, and then <span className="serif text-muted">refuse</span>.
      </h1>
      <p className="mt-4 max-w-[60ch] text-[16px] leading-[1.6] text-muted">
        This page can send a transaction, and only after you confirm it. The record at /record does not. Nothing here
        uses the project accounts, the recorded escrows, or the spike wallet.
      </p>
      <PracticeDesk />
    </main>
  );
}
