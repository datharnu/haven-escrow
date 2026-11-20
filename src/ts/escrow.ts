// SPDX-License-Identifier: Apache-2.0
/**
 * Client for HavenEscrow. Signatures are ML-DSA-87 over chain 9800.
 * No function here can name a payee. The contract pays the two parties it already stores.
 */
import { TESTNET } from "haven-pq-kit/network";
import { encodeAuthMessage, signAuth } from "haven-pq-kit/pqauth";
import { quorumAction, signQuorumShares, type QuorumShares, type ShareSigner } from "haven-pq-kit/quorum";
import {
  encodeAbiParameters,
  keccak256,
  parseAbi,
  toBytes,
  type Address,
  type Hex,
} from "viem";

if (TESTNET.evmChainId !== 9800) {
  throw new Error(`expected EVM chain 9800, found ${TESTNET.evmChainId}`);
}

/** Solidity `block.chainid` on qorechain-diana. Never the string chain id. */
export const CHAIN_ID = 9800n;

export const ACTIONS = {
  deliver: keccak256(toBytes("haven-escrow.deliver")),
  release: keccak256(toBytes("haven-escrow.release")),
  dispute: keccak256(toBytes("haven-escrow.dispute")),
  cancel: keccak256(toBytes("haven-escrow.cancel")),
  resolve: keccak256(toBytes("haven-escrow.resolve")),
} as const;

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

export type StatusName = keyof typeof Status;

/** An account that can produce an ML-DSA-87 signature. `evm` is the signer the contract expects. */
export type SigningAccount = {
  evm: Address;
  pqc: { secretKey: Uint8Array };
};

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

const terms =
  "(address client, address freelancer, address token, address[] arbiters, uint64 reviewPeriod, uint64 arbiterTimeout, uint16 defaultSplitBps, uint128[] amounts, uint64[] deadlines)";

export const escrowAbi = parseAbi([
  `constructor(${terms} t)`,
  "function fund()",
  "function deliver(uint256 m, bytes32 commitment, uint256 deadline, bytes sig)",
  "function release(uint256 m, uint256 deadline, bytes sig)",
  "function autoRelease(uint256 m)",
  "function refund(uint256 m)",
  "function dispute(uint256 m, bool byClient, uint256 deadline, bytes sig)",
  "function resolve(uint256 m, uint16 splitBps, uint256 deadline, address[] who, bytes[] sigs)",
  "function resolveTimeout(uint256 m)",
  "function cancel(uint256 m, uint256 deadline, bytes clientSig, bytes freelancerSig)",
  "function sweep()",
  "function milestoneCount() view returns (uint256)",
  "function milestone(uint256 m) view returns (uint128 amount, uint64 deadline, uint64 deliveredAt, uint64 disputedAt, uint8 status, bytes32 commitment)",
  "function nonces() view returns (uint256 clientNonce, uint256 freelancerNonce, uint256 arbiterNonce)",
  "function arbiters() view returns (address[])",
  "function held() view returns (uint256)",
  "function client() view returns (address)",
  "function freelancer() view returns (address)",
  "function token() view returns (address)",
  "function reviewPeriod() view returns (uint64)",
  "function arbiterTimeout() view returns (uint64)",
  "function defaultSplitBps() view returns (uint16)",
  "function totalFunded() view returns (uint256)",
  "function paidToClient() view returns (uint256)",
  "function paidToFreelancer() view returns (uint256)",
  "event Funded(uint256 m, uint256 amount)",
  "event Delivered(uint256 m, bytes32 commitment)",
  "event Released(uint256 m, uint256 amount, bool automatic)",
  "event Refunded(uint256 m, uint256 amount)",
  "event Disputed(uint256 m, bool byClient)",
  "event Resolved(uint256 m, uint256 toFreelancer, uint256 toClient, bool byTimeout)",
  "event Cancelled(uint256 m, uint256 refunded)",
  "event Swept(uint256 amount)",
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
  "error NothingToFund()",
  "error NothingToSweep()",
  "error NoSuchMilestone(uint256 m)",
  "error WrongStatus(uint256 m, uint8 status)",
  "error TooEarly(uint256 now_, uint256 at)",
  "error TooLate(uint256 now_, uint256 at)",
  "error ZeroCommitment()",
  "error TransferFailed()",
  "error Reentrancy()",
]);

export const factoryAbi = parseAbi([
  `function create(${terms} t) returns (address escrow)`,
  "function isEscrow(address) view returns (bool)",
  "event EscrowCreated(address indexed escrow, address indexed client, address indexed freelancer, bytes32 termsHash)",
]);

type Signed = { escrow: Address; m: bigint; nonce: bigint; deadline: bigint };

function sign(account: SigningAccount, action: Hex, argsHash: Hex, fields: Signed): Hex {
  return signAuth(account.pqc.secretKey, {
    chainId: CHAIN_ID,
    contract: fields.escrow,
    signer: account.evm,
    action,
    nonce: fields.nonce,
    deadline: fields.deadline,
    argsHash,
  }).signature;
}

export function signDeliver(account: SigningAccount, fields: Signed & { commitment: Hex }): Hex {
  return sign(account, ACTIONS.deliver, deliverArgs(fields.m, fields.commitment), fields);
}

export function signRelease(account: SigningAccount, fields: Signed & { amount: bigint }): Hex {
  return sign(account, ACTIONS.release, releaseArgs(fields.m, fields.amount), fields);
}

export function signDispute(account: SigningAccount, fields: Signed & { byClient: boolean }): Hex {
  return sign(account, ACTIONS.dispute, disputeArgs(fields.m, fields.byClient), fields);
}

export function signCancel(account: SigningAccount, fields: Signed): Hex {
  return sign(account, ACTIONS.cancel, cancelArgs(fields.m), fields);
}

/** Two or three arbiters. `who` comes back in strictly ascending order. */
export function signResolve(
  arbiters: readonly ShareSigner[],
  fields: Signed & { splitBps: number },
): QuorumShares {
  return signQuorumShares(arbiters, {
    chainId: CHAIN_ID,
    contract: fields.escrow,
    action: ACTIONS.resolve,
    nonce: fields.nonce,
    deadline: fields.deadline,
    argsHash: resolveArgs(fields.m, fields.splitBps),
  });
}

export { encodeAuthMessage, quorumAction };
