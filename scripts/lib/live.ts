/**
 * Shared reads for the Phase 4 scripts. Nothing here broadcasts.
 * A recipient comes from recipientFromCard, which checks the signed card.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { kemKeySha3 } from "haven-pq-kit/keydir";
import { TESTNET } from "haven-pq-kit/network";
import { evmWindowCost } from "@qorechain/evm";
import type { RecipientCard, SealKeyPair, SealRecipient } from "@qorechain/qoreseal";
import { fetchEvmWindow, type UnifiedAccount } from "@qorechain/sdk";
import {
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { commitmentOf, recipientFromCard, type Manifest } from "../../src/ts/deliverable.js";
import { escrowAbi, type SigningAccount } from "../../src/ts/escrow.js";
import {
  assertUnderCap,
  evmClient,
  loadAccount,
  loadSealKeys,
  sendExpectedRevert,
  type ExpectedRevert,
  type WindowKind,
} from "./chain.js";

export const FUSD = getAddress("0x97143B771D34ddb9130b807b135Ae675A5a963CA");
export const FUSD_DENOM = `erc20:${FUSD}`;
export const CLIENT = "escrow-client";
export const FREELANCER = "escrow-freelancer";
export const ARBITER_NAMES = ["escrow-arb-1", "escrow-arb-2", "escrow-arb-3"] as const;
export const SPIKE = "spike";
export const ACCOUNTS = [SPIKE, CLIENT, FREELANCER, ...ARBITER_NAMES] as const;
export const REFUSAL_GAS = 1_500_000n;
export const DAY = 86_400n;

export const Status = {
  Unfunded: 0,
  Funded: 1,
  Delivered: 2,
  Released: 3,
  Disputed: 4,
  Resolved: 5,
  Refunded: 6,
  Cancelled: 7,
} as const;

const fusdAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export type Tx = { hash: string; tier: "pqc" | "enrollment" | "classical" | "refused"; note: string };
export type Party = { name: string; evm: Address; cosmos: string };

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function brief(text: string): string {
  const noWindow = text.match(/failed to broadcast transaction:.{0,320}/);
  if (noWindow) return noWindow[0].split("Version:")[0].trim();
  const refused = text.match(/Broadcasting transaction failed with code \d+ \(codespace: [^)]+\)\. Log: [^\n]+/);
  if (refused) return refused[0];
  const line = text.split("\n").find((part) => part.startsWith("Details:") || part.startsWith("tx "));
  return (line ?? text).slice(0, 400);
}

export async function party(name: string): Promise<Party> {
  const account = await loadAccount(name);
  return { name, evm: getAddress(account.evm), cosmos: account.cosmos };
}

export async function sortedArbiters(): Promise<Party[]> {
  const rows = await Promise.all(ARBITER_NAMES.map((name) => party(name)));
  rows.sort((a, b) => (a.evm.toLowerCase() < b.evm.toLowerCase() ? -1 : 1));
  return rows;
}

export function signerOf(account: UnifiedAccount): SigningAccount {
  return { evm: getAddress(account.evm), pqc: { secretKey: account.pqc.secretKey } };
}

export function shareOf(account: UnifiedAccount): { account: Address; secretKey: Uint8Array } {
  return { account: getAddress(account.evm), secretKey: account.pqc.secretKey };
}

export async function chainTime(): Promise<bigint> {
  return (await evmClient().getBlock()).timestamp;
}

export async function authDeadline(): Promise<bigint> {
  return (await chainTime()) + 600n;
}

export async function uqorOf(cosmos: string): Promise<bigint> {
  const response = await fetch(`${TESTNET.rest}/cosmos/bank/v1beta1/balances/${cosmos}/by_denom?denom=uqor`);
  if (!response.ok) throw new Error(`uqor balance ${cosmos} returned ${response.status}`);
  const body = (await response.json()) as { balance?: { amount?: string } };
  return BigInt(body.balance?.amount ?? "0");
}

export async function bankFusd(cosmos: string): Promise<bigint> {
  const response = await fetch(
    `${TESTNET.rest}/cosmos/bank/v1beta1/balances/${cosmos}/by_denom?denom=${encodeURIComponent(FUSD_DENOM)}`,
  );
  if (!response.ok) throw new Error(`fUSD bank balance ${cosmos} returned ${response.status}`);
  const body = (await response.json()) as { balance?: { amount?: string } };
  return BigInt(body.balance?.amount ?? "0");
}

export async function fusdOf(holder: Address): Promise<bigint> {
  return evmClient().readContract({ address: FUSD, abi: fusdAbi, functionName: "balanceOf", args: [holder] });
}

export async function snapshotBalances(): Promise<void> {
  const path = "deployments/balances-before.json";
  if (existsSync(path)) return;
  const uqor: Record<string, string> = {};
  for (const name of ACCOUNTS) {
    const who = await party(name);
    uqor[name] = (await uqorOf(who.cosmos)).toString();
  }
  writeJson(path, { network: "qorechain-diana", ranAt: new Date().toISOString(), uqor });
}

export async function printBalanceDelta(): Promise<void> {
  const path = "deployments/balances-before.json";
  if (!existsSync(path)) {
    console.log("no deployments/balances-before.json, so the uqor delta is not available");
    return;
  }
  const before = readJson<{ uqor: Record<string, string> }>(path).uqor;
  console.log("uqor spent (before - after)");
  for (const name of ACCOUNTS) {
    const who = await party(name);
    const after = await uqorOf(who.cosmos);
    const start = BigInt(before[name] ?? "0");
    console.log(`${name} ${start} -> ${after} spent ${start - after}`);
  }
}

/** The local ML-KEM key must be the one the card commits to, or a later open would fail. */
export async function assertSealKey(name: string): Promise<void> {
  const who = await party(name);
  const card = readJson<RecipientCard>(`cards/${who.cosmos}.json`);
  if (card.address !== who.cosmos) throw new Error(`${name} card address does not match the account`);
  const digest = kemKeySha3(loadSealKeys(name).mlkemPublicKey).slice(2).toLowerCase();
  if (digest !== card.mlkemKeySha3.toLowerCase()) throw new Error(`${name} local ML-KEM key does not match its card`);
}

export async function cardRecipient(name: string): Promise<SealRecipient> {
  const who = await party(name);
  const card = readJson<RecipientCard>(`cards/${who.cosmos}.json`);
  return recipientFromCard({ client: evmClient(), rest: TESTNET.rest, address: who.cosmos, card });
}

export function saveManifest(manifest: Manifest): string {
  const path = `deployments/deliverables/${commitmentOf(manifest)}.json`;
  writeJson(path, { ...manifest, milestone: manifest.milestone.toString() });
  return path;
}

export function loadManifest(path: string): Manifest {
  const file = readJson<Omit<Manifest, "milestone"> & { milestone: string }>(path);
  return { ...file, milestone: BigInt(file.milestone) };
}

export async function milestone(escrow: Address, m: bigint): Promise<{
  amount: bigint;
  deadline: bigint;
  deliveredAt: bigint;
  disputedAt: bigint;
  status: number;
  commitment: Hex;
}> {
  const row = await evmClient().readContract({ address: escrow, abi: escrowAbi, functionName: "milestone", args: [m] });
  return {
    amount: row[0],
    deadline: row[1],
    deliveredAt: row[2],
    disputedAt: row[3],
    status: Number(row[4]),
    commitment: row[5],
  };
}

export async function nonces(escrow: Address): Promise<{ client: bigint; freelancer: bigint; arbiter: bigint }> {
  const row = await evmClient().readContract({ address: escrow, abi: escrowAbi, functionName: "nonces" });
  return { client: row[0], freelancer: row[1], arbiter: row[2] };
}

export async function held(escrow: Address): Promise<bigint> {
  return evmClient().readContract({ address: escrow, abi: escrowAbi, functionName: "held" });
}

export async function windowLive(cosmos: string): Promise<boolean> {
  return (await fetchEvmWindow({ rest: TESTNET.rest, address: cosmos })).live;
}

export function deliverData(m: bigint, commitment: Hex, deadline: bigint, sig: Hex): Hex {
  return encodeFunctionData({ abi: escrowAbi, functionName: "deliver", args: [m, commitment, deadline, sig] });
}

export function releaseData(m: bigint, deadline: bigint, sig: Hex): Hex {
  return encodeFunctionData({ abi: escrowAbi, functionName: "release", args: [m, deadline, sig] });
}

export function disputeData(m: bigint, byClient: boolean, deadline: bigint, sig: Hex): Hex {
  return encodeFunctionData({ abi: escrowAbi, functionName: "dispute", args: [m, byClient, deadline, sig] });
}

export function resolveData(m: bigint, splitBps: number, deadline: bigint, who: readonly Address[], sigs: readonly Hex[]): Hex {
  return encodeFunctionData({
    abi: escrowAbi,
    functionName: "resolve",
    args: [m, splitBps, deadline, [...who], [...sigs]],
  });
}

export function autoReleaseData(m: bigint): Hex {
  return encodeFunctionData({ abi: escrowAbi, functionName: "autoRelease", args: [m] });
}

export function fundData(): Hex {
  return encodeFunctionData({ abi: escrowAbi, functionName: "fund" });
}

export function cancelData(m: bigint, deadline: bigint, clientSig: Hex, freelancerSig: Hex): Hex {
  return encodeFunctionData({
    abi: escrowAbi,
    functionName: "cancel",
    args: [m, deadline, clientSig, freelancerSig],
  });
}

export function sweepData(): Hex {
  return encodeFunctionData({ abi: escrowAbi, functionName: "sweep" });
}

export function junkSignature(): Hex {
  return `0x${"00".repeat(4627)}`;
}

export function sealKeys(name: string): SealKeyPair {
  return loadSealKeys(name);
}

/** A refusal whose gas reservation has to stay under 66% of its cap. */
export async function refuse(opts: {
  account: UnifiedAccount;
  to: Address;
  data: Hex;
  kind: WindowKind;
  label: string;
}): Promise<ExpectedRevert> {
  const gasPrice = await evmClient().getGasPrice();
  assertUnderCap(opts.kind, evmWindowCost({ gas: REFUSAL_GAS, maxFeePerGas: gasPrice }), `${opts.label} budget`);
  const result = await sendExpectedRevert({
    account: opts.account,
    to: opts.to,
    data: opts.data,
    gas: REFUSAL_GAS,
    maxFeePerGas: gasPrice,
  });
  assertUnderCap(opts.kind, result.uqor, opts.label);
  return result;
}
