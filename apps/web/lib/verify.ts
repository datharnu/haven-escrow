/**
 * Rebuilds the bytes `PqAuth.encodeMessage` signs, then checks a recorded
 * transaction against the testnet. The verdict comes from the RPC replies,
 * the Foundry ABI, and `mldsa87.verify`. It does not come from the page's text.
 *
 * The eight words are the ones in `lib/haven-pq-kit/src/ts/pqauth.ts`.
 * The action strings and argument hashes are the ones in `src/ts/escrow.ts`
 * and `src/EscrowArgs.sol`. A quorum share signs `quorumAction`, as `PqQuorum` does.
 */
import { mldsa87 } from "@qorechain/pqc";
import {
  decodeErrorResult,
  decodeEventLog,
  decodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  hexToBigInt,
  hexToBytes,
  isAddress,
  keccak256,
  toBytes,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import escrowAbiJson from "./abi/haven-escrow.json";
import transferAbiJson from "./abi/ierc20-transfer.json";
import pqcAbiJson from "./abi/iqore-pqc.json";

export const escrowAbi = escrowAbiJson as Abi;
export const pqcAbi = pqcAbiJson as Abi;
const transferAbi = [transferAbiJson] as Abi;

/** qorechain-diana. The same value as `CHAIN_ID` in `src/ts/escrow.ts`. */
export const CHAIN_ID = 9800n;

/** `PqAuth.PQC_STATUS` in `lib/haven-pq-kit/src/PqAuth.sol`. */
export const PQC_STATUS = "0x0000000000000000000000000000000000000a02" as const;

/** `PqAuth` constants. ML-DSA-87 is algorithm 1. */
export const ML_DSA_87 = 1;
export const PUBKEY_LEN = 2592;
export const SIG_LEN = 4627;

export const EVM_RPC = "https://evm-testnet.qore.host";

export const AUTH_DOMAIN_STRING = "haven-pq-kit.PqAuth.v1";
export const QUORUM_DOMAIN_STRING = "haven-pq-kit.PqQuorum.quorum.v1";
export const AUTH_DOMAIN: Hex = keccak256(toBytes(AUTH_DOMAIN_STRING));
export const QUORUM_DOMAIN: Hex = keccak256(toBytes(QUORUM_DOMAIN_STRING));

export const ACTIONS = {
  deliver: keccak256(toBytes("haven-escrow.deliver")),
  release: keccak256(toBytes("haven-escrow.release")),
  dispute: keccak256(toBytes("haven-escrow.dispute")),
  cancel: keccak256(toBytes("haven-escrow.cancel")),
  resolve: keccak256(toBytes("haven-escrow.resolve")),
} as const;

export const NO_BROADCAST = "Refused before broadcast; there is nothing to check on chain.";
export const NETWORK = "Could not reach the testnet";

export type AuthFields = {
  chainId: bigint;
  contract: Address;
  signer: Address;
  action: Hex;
  nonce: bigint;
  deadline: bigint;
  argsHash: Hex;
};

/** The exact bytes `PqAuth.encodeMessage` signs. Eight 32-byte words. Not a hash of those words. */
export function encodeAuthMessage(fields: AuthFields): Hex {
  return encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "uint256" },
      { type: "address" },
      { type: "address" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "bytes32" },
    ],
    [AUTH_DOMAIN, fields.chainId, fields.contract, fields.signer, fields.action, fields.nonce, fields.deadline, fields.argsHash],
  );
}

/** `PqQuorum.quorumAction`. A plain `PqAuth` action cannot be reused as a share. */
export function quorumAction(action: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [QUORUM_DOMAIN, action]));
}

export function deliverArgs(m: bigint, commitment: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [m, commitment]));
}

export function releaseArgs(m: bigint, amount: bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [m, amount]));
}

export function disputeArgs(m: bigint, byClient: boolean): Hex {
  return keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "bool" }], [m, byClient]));
}

export function cancelArgs(m: bigint): Hex {
  return keccak256(encodeAbiParameters([{ type: "uint256" }], [m]));
}

export function resolveArgs(m: bigint, splitBps: number): Hex {
  return keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint16" }], [m, splitBps]));
}

export type CheckState = "pass" | "fail" | "could-not-check";
export type CheckId = "fetched" | "decoded" | "key" | "signature" | "recipient";

export type CheckLine = {
  id: CheckId;
  label: string;
  state: CheckState;
  reason: string;
};

export type Verdict = {
  reached: boolean;
  noBroadcast?: boolean;
  networkError?: string;
  reverted?: boolean;
  errorName?: string;
  lines: CheckLine[];
};

const LABELS: Record<CheckId, string> = {
  fetched: "Fetched",
  decoded: "Decoded",
  key: "Key read",
  signature: "Signature verified",
  recipient: "Recipient matched",
};

const ORDER: CheckId[] = ["fetched", "decoded", "key", "signature", "recipient"];

export type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

/** A JSON-RPC error that still carried a body. An `eth_call` revert is one of these, not a network failure. */
export class CallError extends Error {
  readonly data?: Hex;
  constructor(message: string, data?: Hex) {
    super(message);
    this.name = "CallError";
    this.data = data;
  }
}

export class NetworkError extends Error {
  constructor() {
    super(NETWORK);
    this.name = "NetworkError";
  }
}

type LineDraft = { state: CheckState; reason: string };

export function summarize(verdict: Verdict): string {
  if (verdict.networkError) return verdict.networkError;
  if (verdict.noBroadcast) return NO_BROADCAST;
  if (verdict.lines.some((line) => line.state === "fail")) return "A check failed. The lines below are the verdict.";
  if (verdict.reverted) return `The receipt reverted${verdict.errorName ? `: ${verdict.errorName}` : ""}.`;
  const signature = verdict.lines.find((line) => line.id === "signature");
  if (signature?.state === "could-not-check") {
    return "This call has no signature to check. The other lines are what the receipt showed.";
  }
  return "The signature verifies over the message the contract builds.";
}

function linesOf(drafts: Partial<Record<CheckId, LineDraft>>, fallback: string): CheckLine[] {
  return ORDER.map((id) => {
    const draft = drafts[id] ?? { state: "could-not-check" as const, reason: fallback };
    return { id, label: LABELS[id], state: draft.state, reason: draft.reason };
  });
}

function networkVerdict(): Verdict {
  return {
    reached: false,
    networkError: NETWORK,
    lines: linesOf({}, NETWORK),
  };
}

function localRefusal(): Verdict {
  return {
    reached: true,
    noBroadcast: true,
    lines: linesOf({}, NO_BROADCAST),
  };
}

type Tx = { blockNumber: bigint; transactionIndex: bigint; to: Address; input: Hex };
type Log = { address: Address; topics: Hex[]; data: Hex };
type Receipt = { status: "success" | "reverted"; logs: Log[] };

function asHex(value: unknown): Hex | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value) ? (value as Hex) : null;
}

function parseTx(value: unknown): Tx | null {
  if (!value || typeof value !== "object") return null;
  const tx = value as Record<string, unknown>;
  const blockNumber = asHex(tx.blockNumber);
  const transactionIndex = asHex(tx.transactionIndex);
  const input = asHex(tx.input);
  if (!blockNumber || !transactionIndex || !input || typeof tx.to !== "string" || !isAddress(tx.to)) return null;
  return { blockNumber: hexToBigInt(blockNumber), transactionIndex: hexToBigInt(transactionIndex), to: getAddress(tx.to), input };
}

function parseReceipt(value: unknown): Receipt | null {
  if (!value || typeof value !== "object") return null;
  const receipt = value as Record<string, unknown>;
  const statusHex = asHex(receipt.status);
  if (!statusHex || !Array.isArray(receipt.logs)) return null;
  const status = hexToBigInt(statusHex);
  if (status !== 0n && status !== 1n) return null;
  const logs: Log[] = [];
  for (const item of receipt.logs) {
    if (!item || typeof item !== "object") return null;
    const log = item as Record<string, unknown>;
    const data = asHex(log.data);
    if (typeof log.address !== "string" || !isAddress(log.address) || !data || !Array.isArray(log.topics)) return null;
    const topics: Hex[] = [];
    for (const topic of log.topics) {
      const hex = asHex(topic);
      if (!hex) return null;
      topics.push(hex);
    }
    logs.push({ address: getAddress(log.address), topics, data });
  }
  return { status: status === 1n ? "success" : "reverted", logs };
}

async function ethCall(rpc: Rpc, to: Address, data: Hex, block: bigint): Promise<Hex> {
  const result = await rpc("eth_call", [{ to, data }, toHex(block)]);
  const hex = asHex(result);
  if (!hex) throw new Error("eth_call returned no hex");
  return hex;
}

async function readView(rpc: Rpc, escrow: Address, functionName: "client" | "freelancer" | "token" | "nonces", block: bigint, args?: readonly unknown[]) {
  const data = encodeFunctionData({ abi: escrowAbi, functionName, args });
  const raw = await ethCall(rpc, escrow, data, block);
  return decodeFunctionResult({ abi: escrowAbi, functionName, data: raw });
}

function asAddress(value: unknown): Address | null {
  return typeof value === "string" && isAddress(value) ? getAddress(value) : null;
}

function asNonce(value: unknown, name: "clientNonce" | "freelancerNonce" | "arbiterNonce"): bigint | null {
  if (Array.isArray(value)) {
    const index = name === "clientNonce" ? 0 : name === "freelancerNonce" ? 1 : 2;
    return typeof value[index] === "bigint" ? value[index] : null;
  }
  if (value && typeof value === "object" && name in value) {
    const nonce = (value as Record<string, unknown>)[name];
    return typeof nonce === "bigint" ? nonce : null;
  }
  return null;
}

function asAmount(value: unknown): bigint | null {
  const tuple = Array.isArray(value) ? value[0] : value;
  if (tuple && typeof tuple === "object" && "amount" in tuple && typeof (tuple as { amount: unknown }).amount === "bigint") {
    return (tuple as { amount: bigint }).amount;
  }
  return null;
}

type Share = { signer: Address; signature: Hex; action: Hex; nonce: bigint; deadline: bigint; argsHash: Hex };

type Call =
  | { kind: "signed"; shares: Share[]; pays: "freelancer" | "none" }
  | { kind: "resolve"; shares: Share[]; toFreelancer: boolean }
  | { kind: "auto"; m: bigint }
  | { kind: "unknown"; name: string };

function bytes32(value: unknown): Hex | null {
  const hex = asHex(value);
  return hex && hex.length === 66 ? hex : null;
}

function sigHex(value: unknown): Hex | null {
  return asHex(value);
}

function buildCall(input: Hex, parties: { client: Address; freelancer: Address }, nonces: { client: bigint; freelancer: bigint; arbiter: bigint }, amountOf: (m: bigint) => bigint | null): { call: Call } | { error: string } {
  let decoded: { functionName: string; args?: readonly unknown[] };
  try {
    decoded = decodeFunctionData({ abi: escrowAbi, data: input });
  } catch {
    return { error: "The input does not match the HavenEscrow ABI." };
  }
  const args = (decoded.args ?? []) as readonly unknown[];
  const name = decoded.functionName;

  if (name === "deliver") {
    const m = args[0];
    const commitment = bytes32(args[1]);
    const deadline = args[2];
    const signature = sigHex(args[3]);
    if (typeof m !== "bigint" || !commitment || typeof deadline !== "bigint" || !signature) return { error: "deliver arguments could not be read." };
    return {
      call: {
        kind: "signed",
        pays: "none",
        shares: [{ signer: parties.freelancer, signature, action: ACTIONS.deliver, nonce: nonces.freelancer, deadline, argsHash: deliverArgs(m, commitment) }],
      },
    };
  }

  if (name === "release") {
    const m = args[0];
    const deadline = args[1];
    const signature = sigHex(args[2]);
    if (typeof m !== "bigint" || typeof deadline !== "bigint" || !signature) return { error: "release arguments could not be read." };
    const amount = amountOf(m);
    if (amount === null) return { error: "The milestone amount could not be read, so the release message cannot be rebuilt." };
    return {
      call: {
        kind: "signed",
        pays: "freelancer",
        shares: [{ signer: parties.client, signature, action: ACTIONS.release, nonce: nonces.client, deadline, argsHash: releaseArgs(m, amount) }],
      },
    };
  }

  if (name === "dispute") {
    const m = args[0];
    const byClient = args[1];
    const deadline = args[2];
    const signature = sigHex(args[3]);
    if (typeof m !== "bigint" || typeof byClient !== "boolean" || typeof deadline !== "bigint" || !signature) return { error: "dispute arguments could not be read." };
    return {
      call: {
        kind: "signed",
        pays: "none",
        shares: [{
          signer: byClient ? parties.client : parties.freelancer,
          signature,
          action: ACTIONS.dispute,
          nonce: byClient ? nonces.client : nonces.freelancer,
          deadline,
          argsHash: disputeArgs(m, byClient),
        }],
      },
    };
  }

  if (name === "cancel") {
    const m = args[0];
    const deadline = args[1];
    const clientSig = sigHex(args[2]);
    const freelancerSig = sigHex(args[3]);
    if (typeof m !== "bigint" || typeof deadline !== "bigint" || !clientSig || !freelancerSig) return { error: "cancel arguments could not be read." };
    const argsHash = cancelArgs(m);
    return {
      call: {
        kind: "signed",
        pays: "none",
        shares: [
          { signer: parties.client, signature: clientSig, action: ACTIONS.cancel, nonce: nonces.client, deadline, argsHash },
          { signer: parties.freelancer, signature: freelancerSig, action: ACTIONS.cancel, nonce: nonces.freelancer, deadline, argsHash },
        ],
      },
    };
  }

  if (name === "resolve") {
    const m = args[0];
    const split = args[1];
    const deadline = args[2];
    const who = args[3];
    const sigs = args[4];
    const splitBps = typeof split === "number" ? split : typeof split === "bigint" ? Number(split) : null;
    if (typeof m !== "bigint" || splitBps === null || typeof deadline !== "bigint" || !Array.isArray(who) || !Array.isArray(sigs)) {
      return { error: "resolve arguments could not be read." };
    }
    if (who.length !== sigs.length) return { error: `resolve has ${who.length} addresses and ${sigs.length} signatures.` };
    const argsHash = resolveArgs(m, splitBps);
    const action = quorumAction(ACTIONS.resolve);
    const shares: Share[] = [];
    for (let i = 0; i < who.length; i++) {
      const signer = asAddress(who[i]);
      const signature = sigHex(sigs[i]);
      if (!signer || !signature) return { error: "A resolve signer could not be read." };
      shares.push({ signer, signature, action, nonce: nonces.arbiter, deadline, argsHash });
    }
    return { call: { kind: "resolve", shares, toFreelancer: true } };
  }

  if (name === "autoRelease") {
    const m = args[0];
    if (typeof m !== "bigint") return { error: "autoRelease arguments could not be read." };
    return { call: { kind: "auto", m } };
  }

  return { call: { kind: "unknown", name } };
}

type KeyResult = { ok: true; pubkey: Uint8Array } | { ok: false; reason: string };

async function readKey(rpc: Rpc, account: Address, block: bigint): Promise<KeyResult> {
  const data = encodeFunctionData({ abi: pqcAbi, functionName: "pqcKeyStatus", args: [account] });
  let raw: Hex;
  try {
    raw = await ethCall(rpc, PQC_STATUS, data, block);
  } catch (error) {
    if (error instanceof CallError) return { ok: false, reason: `pqcKeyStatus refused the read for ${account}.` };
    throw error;
  }
  const byteLength = (raw.length - 2) / 2;
  if (byteLength < 160) return { ok: false, reason: `pqcKeyStatus returned ${byteLength} bytes. Under 160 is not a verdict.` };
  let decoded: readonly unknown[];
  try {
    const result = decodeFunctionResult({ abi: pqcAbi, functionName: "pqcKeyStatus", data: raw });
    decoded = Array.isArray(result) ? result : [];
  } catch {
    return { ok: false, reason: "The pqcKeyStatus reply could not be decoded." };
  }
  const registered = decoded[0] === true;
  const algorithmId = decoded[1];
  const pubkey = asHex(decoded[2]);
  const possession = decoded[3] === true;
  if (!registered) return { ok: false, reason: `${account} has no registered key.` };
  if (algorithmId !== ML_DSA_87) return { ok: false, reason: `${account} is algorithm ${String(algorithmId)}, not ML-DSA-87.` };
  if (!possession) return { ok: false, reason: `${account} has not proved possession of the key.` };
  if (!pubkey) return { ok: false, reason: "The public key was not hex." };
  const pubkeyBytes = hexToBytes(pubkey);
  if (pubkeyBytes.length !== PUBKEY_LEN) return { ok: false, reason: `The public key is ${pubkeyBytes.length} bytes. ML-DSA-87 is ${PUBKEY_LEN}.` };
  return { ok: true, pubkey: pubkeyBytes };
}

function verifyShare(pubkey: Uint8Array, share: Share, escrow: Address): boolean {
  const message = encodeAuthMessage({
    chainId: CHAIN_ID,
    contract: escrow,
    signer: share.signer,
    action: share.action,
    nonce: share.nonce,
    deadline: share.deadline,
    argsHash: share.argsHash,
  });
  const signature = hexToBytes(share.signature);
  if (signature.length !== SIG_LEN) return false;
  return mldsa87.verify(pubkey, hexToBytes(message), signature) === true;
}

type Transfer = { to: Address; value: bigint };

function eventTopics(topics: Hex[]): [Hex, ...Hex[]] | null {
  const [first, ...rest] = topics;
  if (!first) return null;
  return [first, ...rest];
}

function tokenTransfers(logs: Log[], token: Address, escrow: Address): { transfers: Transfer[] } | { error: string } {
  const transfers: Transfer[] = [];
  for (const log of logs) {
    if (log.address !== token) continue;
    const topics = eventTopics(log.topics);
    if (!topics) return { error: "A token log had no topics." };
    try {
      const event = decodeEventLog({ abi: transferAbi, data: log.data, topics });
      if (event.eventName !== "Transfer") continue;
      const args = event.args as unknown as { from?: unknown; to?: unknown; value?: unknown } | undefined;
      const from = asAddress(args?.from);
      const to = asAddress(args?.to);
      const value = args?.value;
      if (!from || !to || typeof value !== "bigint") return { error: "A Transfer log could not be read." };
      if (from !== escrow) return { error: `A Transfer in this receipt came from ${from}, not the escrow.` };
      transfers.push({ to, value });
    } catch {
      return { error: "A token log was not a Transfer." };
    }
  }
  return { transfers };
}

function escrowEvents(logs: Log[], escrow: Address): { name: string; args: Record<string, unknown> }[] {
  const events: { name: string; args: Record<string, unknown> }[] = [];
  for (const log of logs) {
    if (log.address !== escrow) continue;
    const topics = eventTopics(log.topics);
    if (!topics) {
      events.push({ name: "unreadable", args: {} });
      continue;
    }
    try {
      const event = decodeEventLog({ abi: escrowAbi, data: log.data, topics });
      events.push({ name: event.eventName ?? "unreadable", args: (event.args ?? {}) as unknown as Record<string, unknown> });
    } catch {
      events.push({ name: "unreadable", args: {} });
    }
  }
  return events;
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function recipientLine(receipt: Receipt, escrow: Address, token: Address, client: Address, freelancer: Address, expect: "none" | "freelancer" | "split" | "reverted"): LineDraft {
  const parsed = tokenTransfers(receipt.logs, token, escrow);
  if ("error" in parsed) return { state: "fail", reason: parsed.error };
  const { transfers } = parsed;
  const stranger = transfers.find((item) => !sameAddress(item.to, client) && !sameAddress(item.to, freelancer));
  if (stranger) return { state: "fail", reason: `fUSD moved to ${stranger.to}, which is neither party stored on the contract.` };

  if (expect === "reverted" || expect === "none") {
    if (transfers.length > 0) return { state: "fail", reason: "fUSD moved on a call that does not pay." };
    if (expect === "reverted") return { state: "could-not-check", reason: "The receipt reverted, so no fUSD moved." };
    return { state: "could-not-check", reason: "This call does not transfer fUSD. There is no recipient on this step." };
  }

  const events = escrowEvents(receipt.logs, escrow);
  if (events.some((event) => event.name === "unreadable")) return { state: "fail", reason: "An escrow log could not be decoded." };

  if (expect === "freelancer") {
    const released = events.find((event) => event.name === "Released");
    const amount = released?.args.amount;
    if (!released || typeof amount !== "bigint") return { state: "fail", reason: "The receipt has no Released event." };
    const paid = transfers.filter((item) => sameAddress(item.to, freelancer));
    const sum = paid.reduce((total, item) => total + item.value, 0n);
    if (paid.length !== 1 || sum !== amount || transfers.length !== 1) {
      return { state: "fail", reason: `Released ${amount.toString()} to the freelancer. The Transfer logs summed ${sum.toString()} across ${transfers.length} transfers.` };
    }
    const automatic = released.args.automatic === true;
    return { state: "pass", reason: `Released ${amount.toString()} base units, automatic ${String(automatic)}. The Transfer went to the freelancer stored on the contract, ${freelancer}.` };
  }

  const resolved = events.find((event) => event.name === "Resolved");
  const toFreelancer = resolved?.args.toFreelancer;
  const toClient = resolved?.args.toClient;
  if (!resolved || typeof toFreelancer !== "bigint" || typeof toClient !== "bigint") return { state: "fail", reason: "The receipt has no Resolved event." };
  const freelancerSum = transfers.filter((item) => sameAddress(item.to, freelancer)).reduce((total, item) => total + item.value, 0n);
  const clientSum = transfers.filter((item) => sameAddress(item.to, client)).reduce((total, item) => total + item.value, 0n);
  if (freelancerSum !== toFreelancer || clientSum !== toClient) {
    return { state: "fail", reason: `Resolved ${toFreelancer.toString()} and ${toClient.toString()}. The transfers were ${freelancerSum.toString()} and ${clientSum.toString()}.` };
  }
  return { state: "pass", reason: `Resolved ${toFreelancer.toString()} to the freelancer ${freelancer} and ${toClient.toString()} to the client ${client}. No other address was paid.` };
}

function errorNameOf(data: Hex): { name: string } | { error: string } {
  try {
    const decoded = decodeErrorResult({ abi: escrowAbi, data });
    return { name: decoded.errorName };
  } catch {
    return { error: `The revert data ${data.slice(0, 10)} is not in the HavenEscrow ABI.` };
  }
}

export async function verifyStep(hash: string | undefined, rpc: Rpc): Promise<Verdict> {
  if (!hash) return localRefusal();
  try {
    return await verifyHash(hash, rpc);
  } catch (error) {
    if (error instanceof NetworkError) return networkVerdict();
    const reason = error instanceof Error ? error.message : "The reply could not be read.";
    return { reached: true, lines: linesOf({ fetched: { state: "fail", reason } }, "The read stopped before this line.") };
  }
}

async function verifyHash(hash: string, rpc: Rpc): Promise<Verdict> {
  const chainId = await rpc("eth_chainId", []);
  const chainHex = asHex(chainId);
  if (!chainHex || hexToBigInt(chainHex) !== CHAIN_ID) {
    return {
      reached: true,
      lines: linesOf(
        { fetched: { state: "fail", reason: `The RPC chain id is ${chainHex ?? "missing"}. This checker expects ${toHex(CHAIN_ID)}.` } },
        "The chain id was not 9800.",
      ),
    };
  }

  const txValue = await rpc("eth_getTransactionByHash", [hash]);
  const receiptValue = await rpc("eth_getTransactionReceipt", [hash]);
  const tx = parseTx(txValue);
  const receipt = parseReceipt(receiptValue);
  if (!tx || !receipt) {
    const reason = txValue === null || receiptValue === null ? "The testnet has no transaction with this hash." : "The transaction reply was missing a field this check needs.";
    return { reached: true, lines: linesOf({ fetched: { state: "fail", reason } }, "There is nothing further to read.") };
  }

  const drafts: Partial<Record<CheckId, LineDraft>> = {
    fetched: { state: "pass", reason: `Transaction and receipt, block ${tx.blockNumber.toString()}, index ${tx.transactionIndex.toString()}.` },
  };

  if (tx.transactionIndex !== 0n) {
    drafts.decoded = { state: "could-not-check", reason: "This transaction is not first in its block, so the previous block is not the state the contract saw." };
    return { reached: true, reverted: receipt.status === "reverted", lines: linesOf(drafts, "The nonce at the start of the call is not known.") };
  }

  const preBlock = tx.blockNumber - 1n;
  let errorName: string | undefined;
  if (receipt.status === "reverted") {
    let revertData: Hex | undefined;
    try {
      await ethCall(rpc, tx.to, tx.input, preBlock);
    } catch (error) {
      if (error instanceof CallError) revertData = error.data;
      else throw error;
    }
    if (!revertData) {
      drafts.decoded = { state: "fail", reason: "The receipt reverted, but replaying the call at the previous block did not return revert data." };
      return { reached: true, reverted: true, lines: linesOf(drafts, "The error was not decoded.") };
    }
    const named = errorNameOf(revertData);
    if ("error" in named) {
      drafts.decoded = { state: "fail", reason: named.error };
      return { reached: true, reverted: true, lines: linesOf(drafts, "The error was not in the ABI.") };
    }
    errorName = named.name;
    drafts.decoded = { state: "pass", reason: `Receipt status reverted. Error ${named.name}, selector ${revertData.slice(0, 10)}.` };
  }

  let client: Address | null;
  let freelancer: Address | null;
  let token: Address | null;
  let nonceValue: unknown;
  try {
    client = asAddress(await readView(rpc, tx.to, "client", preBlock));
    freelancer = asAddress(await readView(rpc, tx.to, "freelancer", preBlock));
    token = asAddress(await readView(rpc, tx.to, "token", preBlock));
    nonceValue = await readView(rpc, tx.to, "nonces", preBlock);
  } catch (error) {
    if (error instanceof CallError) {
      drafts.decoded = drafts.decoded ?? { state: "fail", reason: "A contract read at the previous block was refused." };
      return { reached: true, reverted: receipt.status === "reverted", errorName, lines: linesOf(drafts, "The parties could not be read from the contract.") };
    }
    throw error;
  }
  if (!client || !freelancer || !token) {
    drafts.decoded = { state: "fail", reason: "client(), freelancer(), or token() did not return an address." };
    return { reached: true, reverted: receipt.status === "reverted", errorName, lines: linesOf(drafts, "The parties could not be read.") };
  }

  const nonces = {
    client: asNonce(nonceValue, "clientNonce"),
    freelancer: asNonce(nonceValue, "freelancerNonce"),
    arbiter: asNonce(nonceValue, "arbiterNonce"),
  };
  if (nonces.client === null || nonces.freelancer === null || nonces.arbiter === null) {
    drafts.decoded = { state: "fail", reason: "nonces() could not be read." };
    return { reached: true, reverted: receipt.status === "reverted", errorName, lines: linesOf(drafts, "The nonce is not known.") };
  }

  const amounts = new Map<string, bigint>();
  let named: { functionName: string; args?: readonly unknown[] };
  try {
    named = decodeFunctionData({ abi: escrowAbi, data: tx.input });
  } catch {
    drafts.decoded = { state: "fail", reason: "The input does not match the HavenEscrow ABI." };
    return { reached: true, reverted: receipt.status === "reverted", errorName, lines: linesOf(drafts, "The call was not decoded.") };
  }
  if (named.functionName === "release") {
    const m = (named.args as readonly unknown[])[0];
    if (typeof m !== "bigint") {
      drafts.decoded = { state: "fail", reason: "release arguments could not be read." };
      return { reached: true, reverted: receipt.status === "reverted", errorName, lines: linesOf(drafts, "The call was not decoded.") };
    }
    try {
      const data = encodeFunctionData({ abi: escrowAbi, functionName: "milestone", args: [m] });
      const raw = await ethCall(rpc, tx.to, data, preBlock);
      const amount = asAmount(decodeFunctionResult({ abi: escrowAbi, functionName: "milestone", data: raw }));
      if (amount === null) {
        drafts.decoded = { state: "fail", reason: "The milestone amount could not be read, so the release message cannot be rebuilt." };
        return { reached: true, reverted: receipt.status === "reverted", errorName, lines: linesOf(drafts, "The amount is not known.") };
      }
      amounts.set(m.toString(), amount);
    } catch (error) {
      if (error instanceof CallError) {
        drafts.decoded = { state: "fail", reason: "milestone() was refused at the previous block." };
        return { reached: true, reverted: receipt.status === "reverted", errorName, lines: linesOf(drafts, "The amount is not known.") };
      }
      throw error;
    }
  }

  const call = buildCall(tx.input, { client, freelancer }, { client: nonces.client, freelancer: nonces.freelancer, arbiter: nonces.arbiter }, (m) => amounts.get(m.toString()) ?? null);
  if ("error" in call) {
    drafts.decoded = { state: "fail", reason: call.error };
    return { reached: true, reverted: receipt.status === "reverted", errorName, lines: linesOf(drafts, "The call was not decoded.") };
  }

  if (!drafts.decoded) {
    const functionName = decodeFunctionData({ abi: escrowAbi, data: tx.input }).functionName;
    drafts.decoded = { state: "pass", reason: `Receipt status success. Function ${functionName}.` };
  }

  if (errorName === "WrongStatus") {
    drafts.key = { state: "could-not-check", reason: "WrongStatus is returned before the signature is read." };
    drafts.signature = { state: "could-not-check", reason: "WrongStatus is returned before the signature is read." };
    drafts.recipient = recipientLine(receipt, tx.to, token, client, freelancer, "reverted");
    return { reached: true, reverted: true, errorName, lines: linesOf(drafts, "") };
  }

  if (call.call.kind === "unknown") {
    drafts.signature = { state: "could-not-check", reason: `${call.call.name} is not a signature this checker rebuilds.` };
    drafts.key = { state: "could-not-check", reason: "No signer was taken from this call." };
    drafts.recipient = recipientLine(receipt, tx.to, token, client, freelancer, receipt.status === "reverted" ? "reverted" : "none");
    return { reached: true, reverted: receipt.status === "reverted", errorName, lines: linesOf(drafts, "") };
  }

  if (call.call.kind === "auto") {
    drafts.key = { state: "could-not-check", reason: "autoRelease takes no signer." };
    drafts.signature = { state: "could-not-check", reason: "autoRelease takes no signature. The review timeout is the path in the contract." };
    drafts.recipient = recipientLine(receipt, tx.to, token, client, freelancer, receipt.status === "reverted" ? "reverted" : "freelancer");
    return { reached: true, reverted: receipt.status === "reverted", errorName, lines: linesOf(drafts, "") };
  }

  const shares = call.call.shares;
  const keyNotes: string[] = [];
  const sigNotes: string[] = [];
  let keysOk = true;
  let sigsOk = shares.length > 0;
  for (const share of shares) {
    const key = await readKey(rpc, share.signer, tx.blockNumber);
    if (!key.ok) {
      keysOk = false;
      sigsOk = false;
      keyNotes.push(key.reason);
      sigNotes.push(`${share.signer} was not checked. The key was refused.`);
      continue;
    }
    keyNotes.push(`${share.signer} is ML-DSA-87, 2592 bytes, possession proved.`);
    const signatureBytes = (share.signature.length - 2) / 2;
    if (signatureBytes !== SIG_LEN) {
      sigsOk = false;
      sigNotes.push(`${share.signer} signed ${signatureBytes} bytes. ML-DSA-87 is ${SIG_LEN}.`);
      continue;
    }
    const ok = verifyShare(key.pubkey, share, tx.to);
    if (!ok) sigsOk = false;
    sigNotes.push(`${share.signer} ${ok ? "verifies" : "does not verify"} over the message this call builds.`);
  }

  drafts.key = { state: keysOk ? "pass" : "fail", reason: keyNotes.join(" ") };
  drafts.signature = {
    state: sigsOk ? "pass" : "fail",
    reason: shares.length === 0 ? "The call carried no signature." : sigNotes.join(" "),
  };

  const expect = receipt.status === "reverted" ? "reverted" : call.call.kind === "resolve" ? "split" : call.call.kind === "signed" && call.call.pays === "freelancer" ? "freelancer" : "none";
  drafts.recipient = recipientLine(receipt, tx.to, token, client, freelancer, expect);
  return { reached: true, reverted: receipt.status === "reverted", errorName, lines: linesOf(drafts, "") };
}
