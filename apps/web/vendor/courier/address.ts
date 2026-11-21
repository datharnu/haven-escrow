import { qorToEvm } from "@qorechain/sdk";
import { CourierError } from "./bytes";

/** The same address check as `courier/src/ts/chain.ts`. */
export function toEvm(address: string): string {
  const evm = address.startsWith("0x") ? address : qorToEvm(address);
  if (!/^0x[0-9a-fA-F]{40}$/.test(evm)) throw new CourierError("ADDRESS", `not an address: ${address}`);
  return evm.toLowerCase();
}

export interface ChainReader {
  readonly chainId: string;
  mldsaKey(evm: string): Promise<Uint8Array>;
  kemKey(evm: string): Promise<string>;
  directory(evm: string): Promise<{ hash: string; expiry: number; live: boolean }>;
  now(): Promise<number>;
}
