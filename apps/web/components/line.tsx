import { PARTIES } from "@/lib/record";

function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function PaymentLine({
  escrowLabel,
  amount = "1.000000 fUSD / milestone",
}: {
  escrowLabel?: string;
  amount?: string;
}) {
  return (
    <div className="rounded-xl bg-surface px-5 py-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[12px] font-medium tracking-[0.08em] text-client uppercase">{PARTIES.client.role}</span>
          <span className="num text-[12px] text-muted" title={PARTIES.client.evm}>
            {short(PARTIES.client.evm)}
          </span>
        </div>
        <div className="flex items-baseline gap-2.5">
          <span className="text-[12px] font-medium tracking-[0.08em] text-freelancer uppercase">
            {PARTIES.freelancer.role}
          </span>
          <span className="num text-[12px] text-muted" title={PARTIES.freelancer.evm}>
            {short(PARTIES.freelancer.evm)}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] tracking-[0.06em] text-faint uppercase">Amount</span>
          <span className="num text-[13px] text-ink">{amount}</span>
        </div>
      </div>
      <div className="rule my-3" />
      <p className="text-[13px] text-muted">
        {escrowLabel ? `${escrowLabel} · ` : ""}Fixed at creation. No later transaction or signature can add a third recipient.
      </p>
    </div>
  );
}
