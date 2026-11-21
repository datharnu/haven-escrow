import { PracticeDesk } from "./desk";

export default function PracticePage() {
  return (
    <main className="mx-auto max-w-[1080px] px-5 pt-12 pb-24">
      <p className="text-[13px] tracking-[0.16em] text-brand uppercase">Practice · one milestone</p>
      <h1 className="mt-4 max-w-[18ch] text-[40px] leading-[1.05] font-medium tracking-[-0.035em]">
        A deal you can fund, and then refuse.
      </h1>
      <p className="mt-5 max-w-[58ch] text-[17px] text-muted">
        This page can send a transaction, and only after you confirm it. The record at /record does not. Nothing here
        uses the project accounts, the recorded escrows, or the spike wallet.
      </p>
      <PracticeDesk />
    </main>
  );
}
