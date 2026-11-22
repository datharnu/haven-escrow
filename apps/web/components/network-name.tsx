import { NETWORK } from "@/lib/record";

/** Official QoreChain icon, used as published. The chain id stays the text. */
export function NetworkName() {
  return (
    <span className="inline-flex items-center gap-1.5 align-middle whitespace-nowrap">
      <img src="/qorechain-icon.svg" alt="" width={16} height={16} className="h-4 w-4 shrink-0" />
      {NETWORK}
    </span>
  );
}
