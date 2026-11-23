// SPDX-License-Identifier: Apache-2.0
/**
 * HavenEscrowV2: the client's own Courier receipt, recorded on the escrow, decides the silent-panel split.
 *
 * The client's device signs Courier's receipt message (the bytes `DeliveryReceipts.signingMessage` builds)
 * with `ciphertextHash` set to the milestone commitment, which binds the escrow, the milestone, the
 * ciphertext, the client envelope, and the three arbiter envelopes. Anyone may then call
 * `acknowledge(m, conversationId, counter, parts)` while the milestone is Delivered or Disputed. If the
 * arbiters stay silent, `resolveTimeout` pays `receivedSplitBps` instead of `defaultSplitBps`.
 * No function here can name a payee.
 */
import { pqcSign } from "@qorechain/sdk";
import {
  encodeAbiParameters,
  getAddress,
  hexToBytes,
  keccak256,
  parseAbi,
  toBytes,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { commitmentOf, type Manifest } from "./deliverable.js";
import { CHAIN_ID, escrowAbi } from "./escrow.js";

/** Courier's live `DeliveryReceipts` on qorechain-diana. Its code hash is pinned below. */
export const DELIVERY_RECEIPTS = getAddress("0x06b52afc4a151b0efa260e2adcdf2d477632cb56");
/** keccak256 of the runtime code at DELIVERY_RECEIPTS, equal to Courier's build of src/DeliveryReceipts.sol. */
export const DELIVERY_RECEIPTS_CODEHASH: Hex = "0xcedfc1642c2ec50dc06b3b67975ebfbb6938204aa8a8774dba19769e9114391f";
/** `DeliveryReceipts.DOMAIN`. */
export const RECEIPT_DOMAIN: Hex = keccak256(toBytes("courier.receipt.v1"));

export type Parts = readonly [Hex, Hex, Hex, Hex, Hex];

/** The five hashes `commitmentOf` binds, in the order `acknowledge` takes them. All public. */
export function partsOf(manifest: Pick<Manifest, "ciphertext" | "clientEnvelope" | "arbiterEnvelopes">): Parts {
  return [
    keccak256(manifest.ciphertext),
    keccak256(manifest.clientEnvelope),
    keccak256(manifest.arbiterEnvelopes[0]),
    keccak256(manifest.arbiterEnvelopes[1]),
    keccak256(manifest.arbiterEnvelopes[2]),
  ];
}

/** What `acknowledge` recomputes on chain: keccak256(abi.encode(escrow, m, parts)). Equal to `commitmentOf`. */
export function commitmentOfParts(escrow: Address, m: bigint, parts: Parts): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [escrow, m, ...parts],
    ),
  );
}

/** One conversation id per escrow, so receipts for this escrow are easy to find. The escrow does not require it. */
export function conversationFor(escrow: Address): Hex {
  return keccak256(toBytes(`haven-escrow.receipt-gate:${getAddress(escrow)}`));
}

export type ReceiptFields = { conversationId: Hex; counter: bigint; ciphertextHash: Hex; recipient: Address };

/** The exact bytes `DeliveryReceipts.signingMessage` returns on chain 9800. */
export function encodeCourierReceipt(fields: ReceiptFields): Hex {
  return encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "uint256" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "bytes32" },
      { type: "address" },
    ],
    [RECEIPT_DOMAIN, CHAIN_ID, fields.conversationId, fields.counter, fields.ciphertextHash, fields.recipient],
  );
}

/** ML-DSA-87 over the receipt message. `DeliveryReceipts.record` verifies it against `recipient`'s registered key. */
export function signCourierReceipt(secretKey: Uint8Array, fields: ReceiptFields): Hex {
  return toHex(pqcSign(secretKey, hexToBytes(encodeCourierReceipt(fields))));
}

/**
 * The client device's side: it signs only a commitment it recomputed from the bytes it holds.
 * Call this after opening the file, so a receipt means the device could read it.
 */
export function clientReceiptFor(manifest: Manifest, client: Address, counter: bigint): ReceiptFields {
  const parts = partsOf(manifest);
  const commitment = commitmentOfParts(manifest.escrow, manifest.milestone, parts);
  if (commitment !== commitmentOf(manifest)) throw new Error("commitment layout drifted from commitmentOf");
  return { conversationId: conversationFor(manifest.escrow), counter, ciphertextHash: commitment, recipient: getAddress(client) };
}

export const deliveryReceiptsAbi = parseAbi([
  "function record(bytes32 conversationId, uint256 counter, bytes32 ciphertextHash, address recipient, bytes signature)",
  "function receipt(bytes32 conversationId, uint256 counter, bytes32 ciphertextHash, address recipient) view returns (address submitter, uint256 recordedAt)",
  "function signingMessage(bytes32 conversationId, uint256 counter, bytes32 ciphertextHash, address recipient) view returns (bytes)",
  "event Delivered(bytes32 indexed conversationId, uint256 indexed counter, bytes32 indexed ciphertextHash, address recipient, address submitter)",
  "error ZeroWord()",
  "error ZeroRecipient()",
  "error AlreadyRecorded(bytes32 receiptId)",
]);

const terms =
  "(address client, address freelancer, address token, address[] arbiters, uint64 reviewPeriod, uint64 arbiterTimeout, uint16 defaultSplitBps, uint16 receivedSplitBps, uint128[] amounts, uint64[] deadlines)";

const v1Kept = escrowAbi.filter(
  (item) => !(item.type === "constructor") && !(item.type === "function" && item.name === "milestone"),
);

export const escrowV2Abi = [
  ...v1Kept,
  ...parseAbi([
    `constructor(${terms} t, address receipts_)`,
    "function milestone(uint256 m) view returns (uint128 amount, uint64 deadline, uint64 deliveredAt, uint64 receivedAt, uint64 disputedAt, uint8 status, bytes32 commitment)",
    "function acknowledge(uint256 m, bytes32 conversationId, uint256 counter, bytes32[5] parts)",
    "function receipts() view returns (address)",
    "function receivedSplitBps() view returns (uint16)",
    "event Received(uint256 m, bytes32 conversationId, uint256 counter, uint256 recordedAt)",
    "error CommitmentMismatch(uint256 m)",
    "error NoReceipt(uint256 m)",
    "error AlreadyReceived(uint256 m)",
  ]),
] as const;

export const factoryV2Abi = parseAbi([
  "constructor(address receipts_)",
  `function create(${terms} t) returns (address escrow)`,
  "function isEscrow(address) view returns (bool)",
  "function receipts() view returns (address)",
  "event EscrowCreated(address indexed escrow, address indexed client, address indexed freelancer, bytes32 termsHash)",
  "error NoReceiptsCode(address receipts)",
]);
