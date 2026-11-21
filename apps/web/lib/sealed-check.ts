import {
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import type { SealedFile } from "./sealed";
import { browserRpc } from "./rpc";
import { NetworkError, escrowAbi, verifyStep, type Rpc, type Verdict } from "./verify";

export type SealRead = {
  event: Hex | "missing";
  stored: Hex | "missing";
  deliver: Verdict;
  resolve: Verdict | null;
};

function asHex(value: unknown): Hex | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value) ? (value as Hex) : null;
}

function eventCommitment(receipt: unknown, escrow: Address, milestone: bigint): Hex | "missing" {
  if (!receipt || typeof receipt !== "object" || !Array.isArray((receipt as { logs?: unknown }).logs)) return "missing";
  for (const item of (receipt as { logs: unknown[] }).logs) {
    if (!item || typeof item !== "object") continue;
    const log = item as { address?: unknown; data?: unknown; topics?: unknown };
    if (typeof log.address !== "string" || !isAddress(log.address) || getAddress(log.address) !== escrow) continue;
    const data = asHex(log.data);
    if (!data || !Array.isArray(log.topics)) continue;
    const topics = log.topics.filter((topic): topic is Hex => typeof topic === "string" && topic.startsWith("0x"));
    if (topics.length === 0 || topics.length !== log.topics.length) continue;
    try {
      const decoded = decodeEventLog({ abi: escrowAbi, data, topics: topics as [Hex, ...Hex[]] });
      if (decoded.eventName !== "Delivered") continue;
      const args = decoded.args as { m?: bigint; commitment?: Hex };
      if (args.m === milestone && args.commitment) return args.commitment;
    } catch {
      continue;
    }
  }
  return "missing";
}

async function storedCommitment(rpc: Rpc, file: SealedFile): Promise<Hex | "missing"> {
  const data = encodeFunctionData({ abi: escrowAbi, functionName: "milestone", args: [file.milestone] });
  const raw = asHex(await rpc("eth_call", [{ to: file.escrow, data }, "latest"]));
  if (!raw) return "missing";
  const decoded = decodeFunctionResult({ abi: escrowAbi, functionName: "milestone", data: raw }) as { commitment?: Hex };
  return decoded.commitment ?? "missing";
}

export async function readSealed(file: SealedFile, resolveHash: Hex | null, rpc: Rpc = browserRpc()): Promise<SealRead> {
  const receipt = await rpc("eth_getTransactionReceipt", [file.deliverHash]);
  const stored = await storedCommitment(rpc, file);
  const deliver = await verifyStep(file.deliverHash, rpc);
  const resolve = resolveHash ? await verifyStep(resolveHash, rpc) : null;
  if (deliver.networkError || resolve?.networkError) throw new NetworkError();
  return { event: eventCommitment(receipt, file.escrow, file.milestone), stored, deliver, resolve };
}
