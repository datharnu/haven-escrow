/**
 * Shared reads and the plan printer for the receipt-gate scripts (`deploy-v2.ts`, `scene-6-receipt-gate.ts`).
 * Nothing in this file sends a transaction. The scripts send only when `--broadcast` is passed.
 */
import { BinaryWriter } from "cosmjs-types/binary";
import { qorechainRegistry } from "@qorechain/sdk";
import { encodeFunctionData, getAddress, keccak256, parseAbi, type Address, type Hex } from "viem";
import {
  DELIVERY_RECEIPTS,
  DELIVERY_RECEIPTS_CODEHASH,
  deliveryReceiptsAbi,
  escrowV2Abi,
  type Parts,
} from "../../src/ts/receipt-gate.js";
import { broadcast, evmClient, loadAccount } from "./chain.js";
import { FUSD_DENOM, party, uqorOf, type Party } from "./live.js";

export const COURIER_CAROL = "courier-carol";
export const BROADCAST = process.argv.includes("--broadcast");
/** Measured on qorechain-diana, 20 to 23 November 2026. Used only to print the plan. */
export const COST = {
  windowOpenClose: 360_000n,
  convert: 180_000n,
  refusal: 84_375n,
} as const;

const keyStatusAbi = parseAbi([
  "function pqcKeyStatus(address account) view returns (bool registered, uint8 algorithmId, bytes pubkey, bool possessionProven)",
]);
const PQC_STATUS = getAddress("0x0000000000000000000000000000000000000a02");

export type AccountRow = Party & { uqor: bigint; mlDsa87: boolean };

/** Balance and on-chain ML-DSA-87 status for each named account. Read-only. */
export async function accountRows(names: readonly string[]): Promise<AccountRow[]> {
  const rows: AccountRow[] = [];
  for (const name of names) {
    const who = await party(name);
    const [uqor, status] = await Promise.all([
      uqorOf(who.cosmos),
      evmClient().readContract({ address: PQC_STATUS, abi: keyStatusAbi, functionName: "pqcKeyStatus", args: [who.evm] }),
    ]);
    const [registered, algorithmId, pubkey, possession] = status;
    rows.push({ ...who, uqor, mlDsa87: registered && algorithmId === 1 && possession && (pubkey.length - 2) / 2 === 2592 });
  }
  return rows;
}

export function qor(uqor: bigint): string {
  const whole = uqor / 1_000_000n;
  const frac = (uqor % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${frac} QOR`;
}

/** Prints what would be sent and by whom, then the per-account estimate against the live balance. */
export function printPlan(
  title: string,
  steps: string[],
  spend: Record<string, bigint>,
  rows: AccountRow[],
): void {
  console.log(`\n${title}\n${"=".repeat(title.length)}`);
  steps.forEach((step, i) => console.log(`${String(i + 1).padStart(2)}. ${step}`));
  console.log("\nAccount                 balance            ML-DSA-87   estimated spend");
  for (const row of rows) {
    const est = spend[row.name] ?? 0n;
    const flag = est > row.uqor ? "  NOT ENOUGH" : "";
    console.log(
      `${row.name.padEnd(22)}  ${qor(row.uqor).padEnd(17)}  ${String(row.mlDsa87).padEnd(10)}  ${qor(est)}${flag}`,
    );
  }
  console.log(
    `\nEstimates use measured fees: ${qor(COST.windowOpenClose)} per window (open + close), ${qor(COST.refusal)} per ` +
      "reverted call, gas at 112,500,000,000 wei. Nothing above was sent.",
  );
}

/** Stops unless `--broadcast` was passed. */
export function stopUnlessBroadcast(): void {
  if (!BROADCAST) {
    console.log("\nPlan only. Re-run with --broadcast to send these transactions.");
    process.exit(0);
  }
}

/** The deployed DeliveryReceipts must be the Courier build the escrow was tested against. */
export async function checkDeliveryReceipts(): Promise<{ ok: boolean; codehash: Hex }> {
  const code = await evmClient().getCode({ address: DELIVERY_RECEIPTS });
  const codehash = code && code !== "0x" ? keccak256(code) : ("0x" as Hex);
  return { ok: codehash === DELIVERY_RECEIPTS_CODEHASH, codehash };
}

export type MilestoneV2 = {
  amount: bigint;
  deadline: bigint;
  deliveredAt: bigint;
  receivedAt: bigint;
  disputedAt: bigint;
  status: number;
  commitment: Hex;
};

export async function milestoneV2(escrow: Address, m: bigint): Promise<MilestoneV2> {
  const row = await evmClient().readContract({ address: escrow, abi: escrowV2Abi, functionName: "milestone", args: [m] });
  return {
    amount: row[0],
    deadline: row[1],
    deliveredAt: row[2],
    receivedAt: row[3],
    disputedAt: row[4],
    status: Number(row[5]),
    commitment: row[6],
  };
}

export async function storedReceipt(conversationId: Hex, counter: bigint, hash: Hex, recipient: Address): Promise<bigint> {
  const [, recordedAt] = await evmClient().readContract({
    address: DELIVERY_RECEIPTS,
    abi: deliveryReceiptsAbi,
    functionName: "receipt",
    args: [conversationId, counter, hash, recipient],
  });
  return recordedAt;
}

export function acknowledgeData(m: bigint, conversationId: Hex, counter: bigint, parts: Parts): Hex {
  return encodeFunctionData({
    abi: escrowV2Abi,
    functionName: "acknowledge",
    args: [m, conversationId, counter, [...parts] as [Hex, Hex, Hex, Hex, Hex]],
  });
}

export function recordData(conversationId: Hex, counter: bigint, hash: Hex, recipient: Address, signature: Hex): Hex {
  return encodeFunctionData({
    abi: deliveryReceiptsAbi,
    functionName: "record",
    args: [conversationId, counter, hash, recipient, signature],
  });
}

const CONVERT = "/cosmos.evm.erc20.v1.MsgConvertCoin";

/** The same MsgConvertCoin codec scene 5 and fund-client use. */
const ConvertCoin = {
  typeUrl: CONVERT,
  fromPartial(value: { coin?: { denom?: string; amount?: string }; receiver?: string; sender?: string }) {
    return {
      coin: { denom: value.coin?.denom ?? "", amount: value.coin?.amount ?? "0" },
      receiver: value.receiver ?? "",
      sender: value.sender ?? "",
    };
  },
  encode(
    message: { coin: { denom: string; amount: string }; receiver: string; sender: string },
    writer = new BinaryWriter(),
  ) {
    const coin = new BinaryWriter();
    coin.uint32(10).string(message.coin.denom);
    coin.uint32(18).string(message.coin.amount);
    writer.uint32(10).bytes(coin.finish());
    writer.uint32(18).string(message.receiver);
    writer.uint32(26).string(message.sender);
    return writer;
  },
  decode() {
    throw new Error("decode is unused");
  },
};

/** Hybrid-signed MsgConvertCoin of bank fUSD straight to `receiver`'s EVM address. Sends. */
export async function convertFusd(name: string, receiver: Address, amount: bigint): Promise<string> {
  const account = await loadAccount(name);
  return broadcast(
    account,
    [{ typeUrl: CONVERT, value: { coin: { denom: FUSD_DENOM, amount: amount.toString() }, receiver, sender: account.cosmos } }],
    "hybrid",
    qorechainRegistry([[CONVERT, ConvertCoin]]),
  );
}

export function resolveTimeoutData(m: bigint): Hex {
  return encodeFunctionData({ abi: escrowV2Abi, functionName: "resolveTimeout", args: [m] });
}
