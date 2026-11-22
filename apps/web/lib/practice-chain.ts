import { BinaryWriter } from "cosmjs-types/binary";
import { evmWindowCost, weiToUqorCeil } from "@qorechain/evm";
import {
  buildRegisterPqcKeyMsg,
  EthNativeSigner,
  closeEvmWindowMsg,
  deriveUnifiedAccount,
  fetchEvmWindow,
  fetchPqcStatus,
  generateMnemonic,
  isRegisteredPqcKey,
  openEvmWindowMsg,
  pqcSign,
  qorechainRegistry,
  signProofOfPossession,
  type EncodeObject,
  type EthBroadcaster,
  type UnifiedAccount,
} from "@qorechain/sdk";
import {
  BaseError,
  RawContractError,
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  decodeEventLog,
  encodeFunctionData,
  getAddress,
  hexToBytes,
  http,
  keccak256,
  parseAbi,
  toBytes,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ACTIONS, CHAIN_ID, NETWORK, deliverArgs, disputeArgs, encodeAuthMessage, escrowAbi, quorumAction, releaseArgs, resolveArgs } from "./verify";
import { DELIVERY_RECEIPTS, RECEIPT_COUNTER, RECORDED_RECEIPT, encodeReceipt, sealPracticeFile } from "./practice-seal";
import {
  FACTORY,
  FUSD,
  FUSD_DENOM,
  NATIVE_FEE,
  PRACTICE_AMOUNT,
  REFUSAL_GAS,
  ROLES,
  SIGNATURE_BYTES,
  WINDOW_CAP,
  type Role,
  type WindowKind,
  assertUnderCap,
  isForbidden,
  practiceTerms,
} from "./practice";

const REST = "/qore-rest";
const RPC = "/qore-rpc";
const CHAIN = "qorechain-diana";
const CONVERT = "/cosmos.evm.erc20.v1.MsgConvertCoin";

const diana = {
  id: 9800,
  name: "QoreChain Diana",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: ["https://evm-testnet.qore.host"] } },
} as const;

const termsType =
  "(address client, address freelancer, address token, address[] arbiters, uint64 reviewPeriod, uint64 arbiterTimeout, uint16 defaultSplitBps, uint128[] amounts, uint64[] deadlines)";

const factoryAbi = parseAbi([
  `function create(${termsType} t) returns (address escrow)`,
  "event EscrowCreated(address indexed escrow, address indexed client, address indexed freelancer, bytes32 termsHash)",
]);

/** Errors the factory create can bubble from the escrow constructor and the PQC precompile. */
const callErrors = parseAbi([
  "error KeyNotRegistered(address account)",
  "error WrongAlgorithm(address account, uint8 algorithmId)",
  "error PossessionNotProven(address account)",
  "error BadKeyLength(address account, uint256 length)",
  "error PqPrecompileUnavailable()",
  "error Unsorted(address previous, address next)",
  "error ZeroAddress()",
  "error SameParty()",
  "error PartyIsArbiter(address who)",
  "error BadMilestoneCount(uint256 count)",
  "error EscrowLengthMismatch()",
  "error ZeroAmount(uint256 m)",
  "error BadDeadline(uint256 m)",
  "error BadPeriod()",
  "error BadSplit(uint16 splitBps)",
  "error BadArbiterCount(uint256 count)",
  "error SignatureInvalid()",
]);

const erc20Abi = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

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
    throw new Error("This page does not decode a conversion.");
  },
};

const convertRegistry = qorechainRegistry([[CONVERT, ConvertCoin as never]]);

function publicClient() {
  return createPublicClient({ chain: diana, transport: http(diana.rpcUrls.default.http[0]) });
}

async function accountAuth(account: UnifiedAccount): Promise<{ accountNumber: bigint; sequence: bigint }> {
  let response: Response;
  try {
    response = await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${account.cosmos}`);
  } catch {
    throw new Error(NETWORK);
  }
  if (response.status === 404) {
    throw new Error("This identity is not on chain yet. It needs test QOR before it can register.");
  }
  if (!response.ok) throw new Error(NETWORK);
  const body = (await response.json()) as {
    account?: { account_number?: string; sequence?: string; base_account?: { account_number?: string; sequence?: string } };
  };
  const accountNumber = body.account?.account_number ?? body.account?.base_account?.account_number;
  if (!accountNumber) throw new Error("The account is on chain but has no account number.");
  const restSequence = body.account?.sequence ?? body.account?.base_account?.sequence;
  const pending = await publicClient().getTransactionCount({ address: getAddress(account.evm), blockTag: "pending" });
  return {
    accountNumber: BigInt(accountNumber),
    sequence: chooseSequence(
      restSequence === undefined ? null : BigInt(restSequence),
      BigInt(pending),
      heldSequence.get(account.cosmos) ?? null,
    ),
  };
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

async function broadcastTx(tx: Uint8Array): Promise<{ code: number; transactionHash: string; rawLog?: string }> {
  let response: Response;
  try {
    response = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "broadcast_tx_sync", params: { tx: toBase64(tx) } }),
    });
  } catch {
    throw new Error(NETWORK);
  }
  if (!response.ok) throw new Error(NETWORK);
  const body = (await response.json()) as {
    error?: { message?: string };
    result?: { code?: number; hash?: string; log?: string };
  };
  if (body.error) throw new Error(body.error.message || "The node refused the transaction.");
  const result = body.result;
  if (!result?.hash) throw new Error("The node returned no transaction hash.");
  return { code: result.code ?? 0, transactionHash: result.hash, rawLog: result.log };
}

const transport: EthBroadcaster = { broadcastTx };

/** Shown when a send is signed with a sequence the chain has already passed. */
export const SEQUENCE_SLIP =
  "This send did not land. The account had already counted the previous one. Click the action again.";

/**
 * The next sequence to sign with. The REST account can lag an EVM send, and the
 * EVM nonce can lag a Cosmos send, so the higher of the two is the live one.
 * `held` is the sequence this page already consumed and the RPCs may not show yet.
 */
export function chooseSequence(rest: bigint | null, pending: bigint, held: bigint | null): bigint {
  let sequence = pending;
  if (rest !== null && rest > sequence) sequence = rest;
  if (held !== null && held > sequence) sequence = held;
  return sequence;
}

const heldSequence = new Map<string, bigint>();

function noteUsed(cosmos: string, used: bigint) {
  const next = used + 1n;
  const current = heldSequence.get(cosmos);
  if (current === undefined || next > current) heldSequence.set(cosmos, next);
}

function sequenceSlipped(log: string) {
  return /account sequence mismatch|incorrect account sequence/.test(log);
}

async function broadcast(
  account: UnifiedAccount,
  messages: readonly EncodeObject[],
  signMode: "hybrid" | "classical",
  registry?: ReturnType<typeof qorechainRegistry>,
): Promise<{ hash: string; code: number; log: string; sequence: bigint }> {
  let slipped = false;
  for (;;) {
    const auth = await accountAuth(account);
    const signer = new EthNativeSigner(account, { signMode, rest: REST, signBytesVersion: "auto", registry });
    try {
      const result = await signer.signAndBroadcast(transport, {
        chainId: CHAIN,
        messages,
        fee: { amount: [...NATIVE_FEE.amount], gas: NATIVE_FEE.gas },
        accountNumber: auth.accountNumber,
        sequence: auth.sequence,
      });
      noteUsed(account.cosmos, auth.sequence);
      return { hash: result.transactionHash, code: 0, log: result.rawLog ?? "", sequence: auth.sequence };
    } catch (caught) {
      const log = caught instanceof Error ? caught.message : "The node refused the transaction.";
      if (!slipped && sequenceSlipped(log)) {
        heldSequence.delete(account.cosmos);
        slipped = true;
        await new Promise((resolve) => setTimeout(resolve, 800));
        continue;
      }
      if (sequenceSlipped(log)) throw new Error(SEQUENCE_SLIP);
      throw caught;
    }
  }
}

export async function makePhrases(): Promise<Record<Role, string>> {
  const phrases = {} as Record<Role, string>;
  const accounts: UnifiedAccount[] = [];
  for (const role of ROLES) {
    phrases[role] = generateMnemonic(128);
    accounts.push(await deriveUnifiedAccount(phrases[role]));
  }
  if (accounts.some((account) => isForbidden(account.evm))) {
    throw new Error("A new identity matched a project account. Nothing was kept.");
  }
  return phrases;
}

export async function accountsFrom(phrases: Record<Role, string>): Promise<Record<Role, UnifiedAccount>> {
  const out = {} as Record<Role, UnifiedAccount>;
  for (const role of ROLES) out[role] = await deriveUnifiedAccount(phrases[role]);
  return out;
}

export async function readCoin(cosmos: string, denom: string): Promise<bigint> {
  let response: Response;
  try {
    response = await fetch(`${REST}/cosmos/bank/v1beta1/balances/${cosmos}`);
  } catch {
    throw new Error(NETWORK);
  }
  if (response.status === 404) return 0n;
  if (!response.ok) throw new Error(NETWORK);
  const body = (await response.json()) as { balances?: { denom: string; amount: string }[] };
  return BigInt(body.balances?.find((coin) => coin.denom === denom)?.amount ?? "0");
}

export async function readUqor(cosmos: string): Promise<bigint> {
  return readCoin(cosmos, "uqor");
}

export async function readFusd(cosmos: string): Promise<bigint> {
  return readCoin(cosmos, FUSD_DENOM);
}

export async function registered(account: UnifiedAccount): Promise<boolean> {
  const status = await fetchPqcStatus({ rest: REST, address: account.cosmos });
  return isRegisteredPqcKey(status, account.pqc.publicKey) === true;
}

export async function registerIdentity(account: UnifiedAccount): Promise<string> {
  if (await registered(account)) return "already";
  const proof = signProofOfPossession({ chainId: CHAIN, account: account.cosmos, algorithmId: 1, keypair: account.pqc });
  const sent = await broadcast(
    account,
    [
      buildRegisterPqcKeyMsg(account.cosmos, {
        pqcKeypair: account.pqc,
        ecdsaPubkey: hexToBytes(account.publicKey as Hex),
        proofOfPossession: proof,
        keyType: "hybrid",
      }),
    ],
    "classical",
  );
  if (sent.code !== 0) throw new Error(sent.log || `Registration was refused, code ${sent.code}.`);
  return sent.hash;
}

async function waitForWindow(cosmos: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const window = await fetchEvmWindow({ rest: REST, address: cosmos });
    if (window.live) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("The window did not become live.");
}

function revertData(error: unknown): Hex | undefined {
  if (!(error instanceof BaseError)) return undefined;
  const raw = error.walk((item) => item instanceof RawContractError);
  if (raw instanceof RawContractError && typeof raw.data === "string" && raw.data.startsWith("0x")) return raw.data as Hex;
  return undefined;
}

export function errorName(data: Hex): string {
  for (const abi of [escrowAbi, callErrors]) {
    try {
      return decodeErrorResult({ abi, data }).errorName;
    } catch {
      continue;
    }
  }
  return "undecoded";
}

/** A revert the page can show. Never includes the call arguments. */
export function plainRevert(data: Hex): string {
  for (const abi of [callErrors, escrowAbi]) {
    try {
      const decoded = decodeErrorResult({ abi, data });
      if (decoded.errorName === "KeyNotRegistered") {
        const who = decoded.args?.[0] ?? "this address";
        return `The contract refused this: KeyNotRegistered for ${who}. Register the five identities first.`;
      }
      if (decoded.errorName === "WrongStatus") {
        const code = Number(decoded.args?.[1]);
        const word = STATUS_WORD[code] ?? "in another state";
        return `The milestone is ${word}. This action does not apply to that state.`;
      }
      return `The contract refused this: ${decoded.errorName}.`;
    } catch {
      continue;
    }
  }
  return "The contract refused this before it was sent.";
}

async function priced(kind: WindowKind, from: Address, to: Address, data: Hex, label: string) {
  const client = publicClient();
  const gasPrice = await client.getGasPrice();
  let estimated: bigint;
  try {
    estimated = await client.estimateGas({ account: from, to, data });
  } catch (error) {
    const dataHex = revertData(error);
    throw new Error(dataHex ? plainRevert(dataHex) : "The contract refused this before it was sent.");
  }
  const buffered = estimated + estimated / 5n;
  const gas = evmWindowCost({ gas: buffered, maxFeePerGas: gasPrice }) <= (WINDOW_CAP[kind] * 66n) / 100n ? buffered : estimated;
  const budget = evmWindowCost({ gas, maxFeePerGas: gasPrice });
  assertUnderCap(kind, budget, label);
  return { gas, gasPrice, budget };
}

async function submitEvm(account: UnifiedAccount, to: Address, data: Hex, gas: bigint, gasPrice: bigint, nonce: bigint) {
  const signer = privateKeyToAccount(account.privateKey as Hex);
  const wallet = createWalletClient({ account: signer, chain: diana, transport: http(diana.rpcUrls.default.http[0]) });
  const hash = await wallet.sendTransaction({
    to,
    data,
    gas,
    nonce: Number(nonce),
    maxFeePerGas: gasPrice,
    maxPriorityFeePerGas: gasPrice,
  });
  noteUsed(account.cosmos, nonce);
  const receipt = await publicClient().waitForTransactionReceipt({ hash });
  return { hash, receipt };
}

async function sendEvm(account: UnifiedAccount, to: Address, data: Hex, gas: bigint, gasPrice: bigint, nonce: bigint): Promise<Hex> {
  const { hash, receipt } = await submitEvm(account, to, data, gas, gasPrice, nonce);
  const cost = weiToUqorCeil(receipt.gasUsed * receipt.effectiveGasPrice);
  if (receipt.status !== "success") {
    throw new Error(`The transaction reverted. ${hash}. It cost ${cost} uqor.`);
  }
  return hash;
}

async function inWindow(
  account: UnifiedAccount,
  target: Address,
  kind: WindowKind,
  data: Hex,
  label: string,
): Promise<Hex> {
  const price = await priced(kind, getAddress(account.evm), target, data, label);
  const opened = await broadcast(account, [
    openEvmWindowMsg({
      sender: account.cosmos,
      blocks: 120,
      maxTxs: 1,
      maxValue: price.budget.toString(),
      allowedTargets: [target],
    }),
  ], "hybrid");
  if (opened.code !== 0) throw new Error(opened.log || `The window was refused, code ${opened.code}.`);
  let bodyError: unknown;
  let hash: Hex = "0x";
  try {
    await waitForWindow(account.cosmos);
    hash = await sendEvm(account, target, data, price.gas, price.gasPrice, opened.sequence + 1n);
  } catch (error) {
    bodyError = error;
  }
  const closed = await broadcast(account, [closeEvmWindowMsg(account.cosmos)], "hybrid");
  if (closed.code !== 0) throw new Error(closed.log || "The window did not close.");
  if (bodyError) throw bodyError;
  return hash;
}

export async function classicalWindow(account: UnifiedAccount): Promise<{ refused: boolean; detail: string }> {
  const sent = await broadcast(
    account,
    [openEvmWindowMsg({ sender: account.cosmos, blocks: 120, maxTxs: 1, maxValue: "2000000", allowedTargets: [FACTORY] })],
    "classical",
  );
  if (sent.code === 0) {
    throw new Error("The classical key opened a window. Stop. That must not succeed.");
  }
  return { refused: true, detail: sent.log || `Refused with code ${sent.code}.` };
}

async function now(): Promise<bigint> {
  const block = await publicClient().getBlock();
  return block.timestamp;
}

function sign(account: UnifiedAccount, fields: Parameters<typeof encodeAuthMessage>[0]): Hex {
  return toHex(pqcSign(account.pqc.secretKey, hexToBytes(encodeAuthMessage(fields))));
}

/** The node returns the three nonces as a list. Some decoders also name them. */
export function nonceFrom(result: unknown, index: 0 | 1 | 2, name: "clientNonce" | "freelancerNonce" | "arbiterNonce"): bigint {
  if (Array.isArray(result) && typeof result[index] === "bigint") return result[index];
  if (result && typeof result === "object" && name in result) {
    const value = (result as Record<string, unknown>)[name];
    if (typeof value === "bigint") return value;
  }
  throw new Error("The escrow did not return its nonces.");
}

async function nonces(escrow: Address): Promise<{ client: bigint; freelancer: bigint; arbiter: bigint }> {
  const result = await publicClient().readContract({ address: escrow, abi: escrowAbi, functionName: "nonces" });
  return {
    client: nonceFrom(result, 0, "clientNonce"),
    freelancer: nonceFrom(result, 1, "freelancerNonce"),
    arbiter: nonceFrom(result, 2, "arbiterNonce"),
  };
}

export async function createEscrow(parties: Record<Role, UnifiedAccount>): Promise<Address> {
  const timestamp = await now();
  const terms = practiceTerms({
    client: getAddress(parties.client.evm),
    freelancer: getAddress(parties.freelancer.evm),
    arbiters: [
      getAddress(parties["arbiter-1"].evm),
      getAddress(parties["arbiter-2"].evm),
      getAddress(parties["arbiter-3"].evm),
    ],
    now: timestamp,
  });
  const data = encodeFunctionData({
    abi: factoryAbi,
    functionName: "create",
    args: [terms],
  });
  const hash = await inWindow(parties.client, FACTORY, "deploy", data, "Create");
  const receipt = await publicClient().getTransactionReceipt({ hash });
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== FACTORY.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "EscrowCreated") return getAddress(decoded.args.escrow);
    } catch {
      continue;
    }
  }
  throw new Error("The factory receipt had no EscrowCreated log.");
}

export async function convertAndFund(client: UnifiedAccount, escrow: Address): Promise<void> {
  const sent = await broadcast(
    client,
    [{
      typeUrl: CONVERT,
      value: {
        coin: { denom: FUSD_DENOM, amount: "100000" },
        receiver: escrow,
        sender: client.cosmos,
      },
    }],
    "hybrid",
    convertRegistry,
  );
  if (sent.code !== 0) throw new Error(sent.log || "The fUSD conversion was refused.");
  const data = encodeFunctionData({ abi: escrowAbi, functionName: "fund" });
  await inWindow(client, escrow, "call", data, "Fund");
}

const receiptAbi = parseAbi([
  "function record(bytes32 conversationId, uint256 counter, bytes32 ciphertextHash, address recipient, bytes signature)",
  "function receipt(bytes32 conversationId, uint256 counter, bytes32 ciphertextHash, address recipient) view returns (address submitter, uint256 recordedAt)",
]);

function guardPractice(account: UnifiedAccount, escrow: Address): void {
  if (isForbidden(account.evm) || isForbidden(escrow)) {
    throw new Error("This path does not use a recorded account or a recorded escrow.");
  }
}

export async function receiptSealedFile(
  client: UnifiedAccount,
  escrow: Address,
): Promise<{ conversationId: Hex; counter: number; ciphertextHash: Hex; commitment: Hex; recordHash: Hex }> {
  guardPractice(client, escrow);
  await registerIdentity(client);
  const sealed = await sealPracticeFile(escrow);
  const recipient = getAddress(client.evm);
  const signature = toHex(
    pqcSign(
      client.pqc.secretKey,
      hexToBytes(
        encodeReceipt({
          conversationId: sealed.conversationId,
          counter: RECEIPT_COUNTER,
          ciphertextHash: sealed.ciphertextHash,
          recipient,
        }),
      ),
    ),
  );
  const data = encodeFunctionData({
    abi: receiptAbi,
    functionName: "record",
    args: [sealed.conversationId, BigInt(RECEIPT_COUNTER), sealed.ciphertextHash, recipient, signature],
  });
  const recordHash = await inWindow(client, DELIVERY_RECEIPTS, "call", data, "Receipt");
  if (recordHash.toLowerCase() === RECORDED_RECEIPT.toLowerCase()) {
    throw new Error("The recorded receipt was reused. Stop.");
  }
  const stored = await publicClient().readContract({
    address: DELIVERY_RECEIPTS,
    abi: receiptAbi,
    functionName: "receipt",
    args: [sealed.conversationId, BigInt(RECEIPT_COUNTER), sealed.ciphertextHash, recipient],
  });
  if (stored[1] === 0n) throw new Error("The receipt was not stored.");
  return { ...sealed, counter: RECEIPT_COUNTER, recordHash };
}

export async function deliver(freelancer: UnifiedAccount, escrow: Address): Promise<void> {
  const commitment = keccak256(toBytes(`haven-escrow.practice:${escrow}`));
  await deliverCommitment(freelancer, escrow, commitment);
}

export async function deliverCommitment(freelancer: UnifiedAccount, escrow: Address, commitment: Hex): Promise<void> {
  guardPractice(freelancer, escrow);
  const nonce = (await nonces(escrow)).freelancer;
  const timestamp = await now();
  const deadline = timestamp + 3600n;
  const signature = sign(freelancer, {
    chainId: CHAIN_ID,
    contract: escrow,
    signer: getAddress(freelancer.evm),
    action: ACTIONS.deliver,
    nonce,
    deadline,
    argsHash: deliverArgs(0n, commitment),
  });
  const data = encodeFunctionData({
    abi: escrowAbi,
    functionName: "deliver",
    args: [0n, commitment, deadline, signature],
  });
  await inWindow(freelancer, escrow, "call", data, "Deliver");
}

export async function release(client: UnifiedAccount, escrow: Address): Promise<Hex> {
  const amount = PRACTICE_AMOUNT;
  const nonce = (await nonces(escrow)).client;
  const deadline = (await now()) + 3600n;
  const signature = sign(client, {
    chainId: CHAIN_ID,
    contract: escrow,
    signer: getAddress(client.evm),
    action: ACTIONS.release,
    nonce,
    deadline,
    argsHash: releaseArgs(0n, amount),
  });
  const data = encodeFunctionData({
    abi: escrowAbi,
    functionName: "release",
    args: [0n, deadline, signature],
  });
  await inWindow(client, escrow, "call", data, "Release");
  return signature;
}

export async function previewCall(to: Address, data: Hex): Promise<{ reverted: boolean; name: string }> {
  try {
    await publicClient().call({ to, data });
    return { reverted: false, name: "" };
  } catch (error) {
    const dataHex = revertData(error);
    if (!dataHex) throw new Error(error instanceof Error ? error.message : NETWORK);
    return { reverted: true, name: errorName(dataHex) };
  }
}

export async function wrongMilestone(escrow: Address): Promise<string> {
  const data = encodeFunctionData({ abi: escrowAbi, functionName: "release", args: [1n, 0n, "0x"] });
  const preview = await previewCall(escrow, data);
  if (!preview.reverted) throw new Error("Milestone 1 was accepted. Stop.");
  return preview.name;
}

export async function earlyRelease(escrow: Address): Promise<string> {
  const data = encodeFunctionData({ abi: escrowAbi, functionName: "autoRelease", args: [0n] });
  const preview = await previewCall(escrow, data);
  if (!preview.reverted) throw new Error("The early release was accepted. Stop.");
  return preview.name;
}

export async function replayRelease(escrow: Address, signature: Hex): Promise<string> {
  const deadline = (await now()) + 3600n;
  const data = encodeFunctionData({ abi: escrowAbi, functionName: "release", args: [0n, deadline, signature] });
  const preview = await previewCall(escrow, data);
  if (!preview.reverted) throw new Error("The old signature was accepted. Stop.");
  return preview.name;
}

export async function dispute(who: UnifiedAccount, escrow: Address, byClient: boolean): Promise<void> {
  const nonce = byClient ? (await nonces(escrow)).client : (await nonces(escrow)).freelancer;
  const deadline = (await now()) + 3600n;
  const signature = sign(who, {
    chainId: CHAIN_ID,
    contract: escrow,
    signer: getAddress(who.evm),
    action: ACTIONS.dispute,
    nonce,
    deadline,
    argsHash: disputeArgs(0n, byClient),
  });
  const data = encodeFunctionData({
    abi: escrowAbi,
    functionName: "dispute",
    args: [0n, byClient, deadline, signature],
  });
  await inWindow(who, escrow, "call", data, "Dispute");
}

export async function resolveHalf(
  submitter: UnifiedAccount,
  first: UnifiedAccount,
  second: UnifiedAccount,
  escrow: Address,
): Promise<void> {
  const pair = [first, second].sort((a, b) => (a.evm.toLowerCase() < b.evm.toLowerCase() ? -1 : 1));
  const nonce = (await nonces(escrow)).arbiter;
  const deadline = (await now()) + 3600n;
  const argsHash = resolveArgs(0n, 5000);
  const action = quorumAction(ACTIONS.resolve);
  const who = pair.map((account) => getAddress(account.evm));
  const sigs = pair.map((account) =>
    sign(account, {
      chainId: CHAIN_ID,
      contract: escrow,
      signer: getAddress(account.evm),
      action,
      nonce,
      deadline,
      argsHash,
    }),
  );
  const data = encodeFunctionData({
    abi: escrowAbi,
    functionName: "resolve",
    args: [0n, 5000, deadline, who, sigs],
  });
  await inWindow(submitter, escrow, "resolve", data, "Resolve");
}

export async function passQor(client: UnifiedAccount, others: readonly UnifiedAccount[]): Promise<string> {
  const messages = others.map((account) => ({
    typeUrl: "/cosmos.bank.v1beta1.MsgSend",
    value: {
      fromAddress: client.cosmos,
      toAddress: account.cosmos,
      amount: [{ denom: "uqor", amount: "2000000" }],
    },
  }));
  const sent = await broadcast(client, messages, "hybrid");
  if (sent.code !== 0) throw new Error(sent.log || "The QOR transfer was refused.");
  return sent.hash;
}

export async function dealStatus(escrow: Address): Promise<{ status: number; client: Address; freelancer: Address }> {
  const client = publicClient();
  const [statusRow, clientAddress, freelancerAddress] = await Promise.all([
    client.readContract({ address: escrow, abi: escrowAbi, functionName: "milestone", args: [0n] }),
    client.readContract({ address: escrow, abi: escrowAbi, functionName: "client" }),
    client.readContract({ address: escrow, abi: escrowAbi, functionName: "freelancer" }),
  ]);
  const row = statusRow as { status: number };
  return { status: Number(row.status), client: getAddress(clientAddress as Address), freelancer: getAddress(freelancerAddress as Address) };
}

export async function tokenBalance(escrow: Address): Promise<bigint> {
  return publicClient().readContract({ address: FUSD, abi: erc20Abi, functionName: "balanceOf", args: [escrow] });
}

export const STATUS_WORD = ["Unfunded", "Funded", "Delivered", "Released", "Disputed", "Resolved", "Refunded", "Cancelled"] as const;

export type StealLine = { attempt: string; detail: string };

function zeroSignature(): Hex {
  return `0x${"00".repeat(SIGNATURE_BYTES)}`;
}

async function revertInWindow(account: UnifiedAccount, target: Address, data: Hex, label: string): Promise<Hex> {
  const gasPrice = await publicClient().getGasPrice();
  const budget = evmWindowCost({ gas: REFUSAL_GAS, maxFeePerGas: gasPrice });
  assertUnderCap("call", budget, label);
  const opened = await broadcast(
    account,
    [
      openEvmWindowMsg({
        sender: account.cosmos,
        blocks: 120,
        maxTxs: 1,
        maxValue: budget.toString(),
        allowedTargets: [target],
      }),
    ],
    "hybrid",
  );
  if (opened.code !== 0) throw new Error(opened.log || `The window was refused, code ${opened.code}.`);
  let bodyError: unknown;
  let hash: Hex = "0x";
  try {
    await waitForWindow(account.cosmos);
    const preview = await previewCall(target, data);
    if (!preview.reverted) throw new Error(`${label} no longer reverts. Stop. The call was not sent.`);
    const sent = await submitEvm(account, target, data, REFUSAL_GAS, gasPrice, opened.sequence + 1n);
    hash = sent.hash;
    if (sent.receipt.status !== "reverted") {
      throw new Error(`${label} was mined as a success. ${hash}. Stop.`);
    }
  } catch (error) {
    bodyError = error;
  }
  const closed = await broadcast(account, [closeEvmWindowMsg(account.cosmos)], "hybrid");
  if (closed.code !== 0) throw new Error(closed.log || "The window did not close.");
  if (bodyError) throw bodyError;
  return hash;
}

/** The four attempts an attacker can make. A success throws. The page must stop. */
export async function stealPay(client: UnifiedAccount, escrow: Address, releaseSignature: Hex | null): Promise<StealLine[]> {
  const lines: StealLine[] = [];
  const classical = await classicalWindow(client);
  lines.push({
    attempt: "Classical open",
    detail: `Refused before a successful broadcast. ${classical.detail}`,
  });

  const deadline = (await now()) + 3600n;
  const data = encodeFunctionData({
    abi: escrowAbi,
    functionName: "release",
    args: [0n, deadline, zeroSignature()],
  });
  const preview = await previewCall(escrow, data);
  if (!preview.reverted) throw new Error("A release signed with 4627 zero bytes was accepted. Stop.");
  if (preview.name !== "SignatureInvalid") {
    lines.push({
      attempt: "Release with a zero signature",
      detail: `Not broadcast. The contract returned ${preview.name}. Deliver the milestone before this attempt can reach the signature.`,
    });
  } else {
    const hash = await revertInWindow(client, escrow, data, "Junk release");
    lines.push({
      attempt: "Release with a zero signature",
      detail: `Receipt ${hash} reverted. Replaying the call returned SignatureInvalid. The window was opened with the registered key so the call could be mined. The signature is 4627 zero bytes.`,
    });
  }

  if (!releaseSignature) {
    lines.push({ attempt: "Replay", detail: "Not broadcast. This browser has no release signature yet." });
  } else {
    const name = await replayRelease(escrow, releaseSignature);
    if (name !== "SignatureInvalid") throw new Error(`The old signature came back as ${name}. Stop.`);
    lines.push({
      attempt: "Replay",
      detail: "Read, not broadcast. The contract returned SignatureInvalid. The signed message carries the nonce from the check, so a used signature does not match.",
    });
  }

  lines.push({
    attempt: "Send it somewhere else",
    detail:
      "Not called. release takes a milestone, a deadline, and a signature. resolve takes the signers in address[] who. The transfer inside the contract goes to the stored client or the stored freelancer.",
  });
  return lines;
}
