import { PARTIES } from "@/lib/record";

function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function PaymentLine() {
  return (
    <div className="rounded-xl bg-surface px-4 py-4 shadow-[inset_0_0_0_1px_var(--color-line)] sm:px-5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] tracking-[0.08em] text-client uppercase">{PARTIES.client.role}</span>
        <span className="num text-[12px] text-muted" title={PARTIES.client.evm}>
          {short(PARTIES.client.evm)}
        </span>
      </div>
      <div className="rule my-3" />
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] tracking-[0.08em] text-freelancer uppercase">{PARTIES.freelancer.role}</span>
        <span className="num text-[12px] text-muted" title={PARTIES.freelancer.evm}>
          {short(PARTIES.freelancer.evm)}
        </span>
      </div>
      <p className="mt-3 text-[13px] text-faint">Printed when the escrow was created. No later call can add a third name.</p>
    </div>
  );
}
