/**
 * Scene 6, the client's receipt on Escrow D (HavenEscrowV2). The record is written by `npm run scene:6 -- --broadcast`.
 * Until then `lib/receipt-gate.json` holds `null` and /record shows nothing for it.
 */
import { decodeFunctionResult, encodeFunctionData, type Abi, type Address, type Hex } from "viem";
import escrowV2Abi from "./abi/haven-escrow-v2.json";
import recorded from "./receipt-gate.json";
import type { Rpc } from "./verify";

export type GateStep = {
  id: string;
  title: string;
  outcome: "paid" | "refused" | "held";
  error?: string;
  hash: string;
  who: string;
};

export type GateRecord = {
  recorded: string;
  network: string;
  escrow: Address;
  factory: Address;
  deliveryReceipts: Address;
  client: Address;
  freelancer: Address;
  commitment: Hex;
  conversationId: Hex;
  arbiterTimeout: string;
  disputedAt: string;
  receivedAt: string;
  recordedAt: string;
  paidToFreelancer: string;
  paidToClient: string;
  steps: GateStep[];
};

const WORD = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Returns the record only if every field has the shape the panel needs. Anything else is treated as not recorded. */
export function parseGate(value: unknown): GateRecord | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Partial<GateRecord>;
  const addresses = [r.escrow, r.factory, r.deliveryReceipts, r.client, r.freelancer];
  if (!addresses.every((a) => typeof a === "string" && ADDRESS.test(a))) return null;
  if (!WORD.test(r.commitment ?? "") || !WORD.test(r.conversationId ?? "")) return null;
  if (![r.arbiterTimeout, r.disputedAt, r.receivedAt, r.recordedAt, r.paidToFreelancer, r.paidToClient].every((v) => typeof v === "string" && /^\d+$/.test(v))) return null;
  if (!Array.isArray(r.steps) || r.steps.length === 0) return null;
  for (const step of r.steps) {
    if (!step || typeof step.id !== "string" || typeof step.title !== "string" || typeof step.who !== "string") return null;
    if (!["paid", "refused", "held"].includes(step.outcome) || !WORD.test(step.hash ?? "")) return null;
  }
  return r as GateRecord;
}

export const GATE: GateRecord | null = parseGate(recorded);

const receiptsAbi = [
  {
    type: "function",
    name: "receipt",
    stateMutability: "view",
    inputs: [
      { name: "conversationId", type: "bytes32" },
      { name: "counter", type: "uint256" },
      { name: "ciphertextHash", type: "bytes32" },
      { name: "recipient", type: "address" },
    ],
    outputs: [
      { name: "submitter", type: "address" },
      { name: "recordedAt", type: "uint256" },
    ],
  },
] as const satisfies Abi;

export type GateCheck = {
  receiptsMatch: boolean;
  clientMatches: boolean;
  receiptRecordedAt: bigint;
  receivedAt: bigint;
  status: number;
  commitmentMatches: boolean;
  receivedSplitBps: number;
};

async function call(rpc: Rpc, to: Address, data: Hex): Promise<Hex> {
  return (await rpc("eth_call", [{ to, data }, "latest"])) as Hex;
}

/**
 * Reads the chain now: the escrow's pinned DeliveryReceipts, client, and receivedSplitBps, milestone 0, and the client's stored receipt
 * over the stored commitment at counter 0 (the counter scene 6 uses for it). Sends nothing.
 */
export async function checkGate(rpc: Rpc, gate: GateRecord): Promise<GateCheck> {
  const abi = escrowV2Abi as Abi;
  const read = async (functionName: string, args: unknown[] = []) =>
    decodeFunctionResult({
      abi,
      functionName,
      data: await call(rpc, gate.escrow, encodeFunctionData({ abi, functionName, args })),
    });
  const receipts = (await read("receipts")) as Address;
  const client = (await read("client")) as Address;
  const receivedSplitBps = Number(await read("receivedSplitBps"));
  const ms = (await read("milestone", [0n])) as { receivedAt: bigint; status: number; commitment: Hex };
  const stored = decodeFunctionResult({
    abi: receiptsAbi,
    functionName: "receipt",
    data: await call(
      rpc,
      receipts,
      encodeFunctionData({ abi: receiptsAbi, functionName: "receipt", args: [gate.conversationId, 0n, ms.commitment, client] }),
    ),
  });
  return {
    receiptsMatch: receipts.toLowerCase() === gate.deliveryReceipts.toLowerCase(),
    clientMatches: client.toLowerCase() === gate.client.toLowerCase(),
    receiptRecordedAt: stored[1],
    receivedAt: BigInt(ms.receivedAt),
    status: Number(ms.status),
    commitmentMatches: ms.commitment.toLowerCase() === gate.commitment.toLowerCase(),
    receivedSplitBps,
  };
}
