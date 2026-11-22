import {
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import escrowAbiJson from "./abi/haven-escrow.json";
import factoryAbiJson from "./abi/escrow-factory.json";
import transferAbiJson from "./abi/ierc20-transfer.json";
import { ESCROWS, SCENES } from "./record";
import type { Rpc } from "./verify";

const TRANSFER_TOPIC = keccak256(toHex("Transfer(address,address,uint256)"));
const escrowAbi = escrowAbiJson as Abi;
const factoryAbi = factoryAbiJson as Abi;
const transferAbi = [transferAbiJson] as Abi;

type Input = { name?: string; type: string; components?: Input[] };

export type CallParam = { name: string; type: string };
export type CallRow = { name: string; addresses: CallParam[] };

function addressParams(inputs: Input[] | undefined): CallParam[] {
  const found: CallParam[] = [];
  for (const input of inputs ?? []) {
    if (input.type === "address" || input.type.startsWith("address")) found.push({ name: input.name ?? "", type: input.type });
    if (input.components) found.push(...addressParams(input.components));
  }
  return found;
}

function callsOf(abi: Abi): CallRow[] {
  return abi.flatMap((item) => {
    if (item.type !== "function") return [];
    if (item.stateMutability === "view" || item.stateMutability === "pure") return [];
    return [{ name: item.name, addresses: addressParams(item.inputs as Input[] | undefined) }];
  });
}

export const escrowCalls = callsOf(escrowAbi);
export const factoryCalls = callsOf(factoryAbi);

export type TransferRow = { to: Address; value: bigint; party: "client" | "freelancer" | "other" };
export type EscrowPayees =
  | { escrow: Address; label: "A" | "B"; state: "could-not-read" }
  | { escrow: Address; label: "A" | "B"; state: "read"; client: Address; freelancer: Address; rows: TransferRow[] };

function hashesFor(label: "A" | "B"): string[] {
  return SCENES.filter((scene) => scene.escrow === label).flatMap((scene) => scene.steps.flatMap((step) => (step.hash ? [step.hash] : [])));
}

async function readAddress(rpc: Rpc, escrow: Address, functionName: "client" | "freelancer" | "token"): Promise<Address> {
  const data = encodeFunctionData({ abi: escrowAbi, functionName });
  const raw = await rpc("eth_call", [{ to: escrow, data }, "latest"]);
  if (typeof raw !== "string" || !raw.startsWith("0x")) throw new Error("The check could not be read.");
  const decoded = decodeFunctionResult({ abi: escrowAbi, functionName, data: raw as Hex });
  if (typeof decoded !== "string") throw new Error("The check could not be read.");
  return getAddress(decoded);
}

async function transfersOut(rpc: Rpc, escrow: Address, token: Address, hash: string): Promise<{ to: Address; value: bigint }[]> {
  const receipt = await rpc("eth_getTransactionReceipt", [hash]);
  if (!receipt || typeof receipt !== "object" || !("logs" in receipt) || !Array.isArray(receipt.logs)) {
    throw new Error("The check could not be read.");
  }
  const rows: { to: Address; value: bigint }[] = [];
  for (const log of receipt.logs as { address?: string; topics?: string[]; data?: string }[]) {
    if (!log.address || getAddress(log.address) !== token) continue;
    if (!log.topics?.[0] || log.topics[0].toLowerCase() !== TRANSFER_TOPIC) continue;
    const decoded = decodeEventLog({
      abi: transferAbi,
      data: (log.data ?? "0x") as Hex,
      topics: (log.topics ?? []) as [Hex, ...Hex[]],
    });
    if (decoded.eventName !== "Transfer") throw new Error("The check could not be read.");
    const args = decoded.args as { from?: string; to?: string; value?: bigint };
    if (!args.from || !args.to || typeof args.value !== "bigint") throw new Error("The check could not be read.");
    if (getAddress(args.from) !== escrow) continue;
    rows.push({ to: getAddress(args.to), value: args.value });
  }
  return rows;
}

async function readOne(rpc: Rpc, label: "A" | "B"): Promise<EscrowPayees> {
  const escrow = getAddress(ESCROWS[label]);
  const [client, freelancer, token] = await Promise.all([
    readAddress(rpc, escrow, "client"),
    readAddress(rpc, escrow, "freelancer"),
    readAddress(rpc, escrow, "token"),
  ]);
  const rows: TransferRow[] = [];
  for (const hash of hashesFor(label)) {
    const moved = await transfersOut(rpc, escrow, token, hash);
    for (const row of moved) {
      const party = row.to === client ? "client" : row.to === freelancer ? "freelancer" : "other";
      rows.push({ ...row, party });
    }
  }
  return { escrow, label, state: "read", client, freelancer, rows };
}

/** Reads the stored names and the fUSD transfers in the recorded receipts. A failed read is not a match. */
export async function readPayees(rpc: Rpc): Promise<EscrowPayees[]> {
  const labels = ["A", "B"] as const;
  const rows: EscrowPayees[] = [];
  for (const label of labels) {
    try {
      rows.push(await readOne(rpc, label));
    } catch {
      rows.push({ escrow: getAddress(ESCROWS[label]), label, state: "could-not-read" });
    }
  }
  return rows;
}
