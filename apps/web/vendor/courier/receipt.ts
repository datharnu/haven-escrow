import { pqSign, pqVerify } from "@qorechain/qoresign";
import { SIG_LEN } from "./siglen";
import { bytesToHex, encodeAbiParameters, hexToBytes, keccak256, toBytes, type Address, type Hex } from "viem";

import { CourierError } from "./bytes";
import { toEvm, type ChainReader } from "./address";

export const RECEIPT_DOMAIN = keccak256(toBytes("courier.receipt.v1"));

const WORD = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * A recipient-signed delivery acknowledgement.
 * The signed bytes are ABI-encoded so both clients and `DeliveryReceipts.sol` verify the exact same message.
 */
export type DeliveryReceipt = {
  conversationId: Hex;
  counter: number;
  ciphertextHash: Hex;
  recipient: string;
  signature: Hex;
};

export function encodeReceipt(args: {
  chainId?: bigint;
  conversationId: Hex;
  counter: number;
  ciphertextHash: Hex;
  recipient: string;
}): Hex {
  if (!WORD.test(args.conversationId)) throw new CourierError("RECEIPT", "conversationId is not 32 bytes");
  if (!WORD.test(args.ciphertextHash)) throw new CourierError("RECEIPT", "ciphertextHash is not 32 bytes");
  if (!Number.isSafeInteger(args.counter) || args.counter < 0 || args.counter > 0xffffffff) {
    throw new CourierError("RECEIPT", "counter is not a uint32");
  }
  const recipient = toEvm(args.recipient) as Address;
  const chainId = args.chainId ?? 9800n;
  return encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "uint256" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "bytes32" },
      { type: "address" },
    ],
    [
      RECEIPT_DOMAIN,
      chainId,
      args.conversationId.toLowerCase() as Hex,
      BigInt(args.counter),
      args.ciphertextHash.toLowerCase() as Hex,
      recipient,
    ],
  );
}

export function checkReceipt(receipt: DeliveryReceipt): void {
  if (!receipt || typeof receipt !== "object") throw new CourierError("RECEIPT", "receipt is missing");
  if (!WORD.test(receipt.conversationId ?? "")) throw new CourierError("RECEIPT", "conversationId is not 32 bytes");
  if (!WORD.test(receipt.ciphertextHash ?? "")) throw new CourierError("RECEIPT", "ciphertextHash is not 32 bytes");
  if (!ADDRESS.test(receipt.recipient ?? "")) throw new CourierError("RECEIPT", "recipient is not an address");
  if (!Number.isSafeInteger(receipt.counter) || receipt.counter < 0 || receipt.counter > 0xffffffff) {
    throw new CourierError("RECEIPT", "counter is not a uint32");
  }
  if (
    typeof receipt.signature !== "string" ||
    !/^0x[0-9a-fA-F]+$/.test(receipt.signature) ||
    (receipt.signature.length - 2) / 2 !== SIG_LEN
  ) {
    throw new CourierError("RECEIPT", "receipt signature is not an ML-DSA-87 signature");
  }
}

export function signReceipt(
  secretKey: Uint8Array,
  args: {
    chainId?: bigint;
    conversationId: Hex;
    counter: number;
    ciphertextHash: Hex;
    recipient: string;
  },
): DeliveryReceipt {
  const recipient = toEvm(args.recipient);
  const message = encodeReceipt({ ...args, recipient });
  const receipt: DeliveryReceipt = {
    conversationId: args.conversationId.toLowerCase() as Hex,
    counter: args.counter,
    ciphertextHash: args.ciphertextHash.toLowerCase() as Hex,
    recipient,
    signature: bytesToHex(pqSign(secretKey, hexToBytes(message))),
  };
  checkReceipt(receipt);
  return receipt;
}

export async function verifyReceipt(
  chain: ChainReader,
  receipt: DeliveryReceipt,
  opts?: { chainId?: bigint; expectedRecipient?: string; expectedConversationId?: string; expectedCiphertextHash?: string },
): Promise<void> {
  checkReceipt(receipt);
  const recipient = toEvm(receipt.recipient);
  if (opts?.expectedRecipient && recipient !== toEvm(opts.expectedRecipient)) {
    throw new CourierError("RECEIPT", "receipt recipient does not match");
  }
  if (opts?.expectedConversationId && receipt.conversationId.toLowerCase() !== opts.expectedConversationId.toLowerCase()) {
    throw new CourierError("RECEIPT", "receipt conversationId does not match");
  }
  if (opts?.expectedCiphertextHash && receipt.ciphertextHash.toLowerCase() !== opts.expectedCiphertextHash.toLowerCase()) {
    throw new CourierError("RECEIPT", "receipt ciphertextHash does not match");
  }
  const message = encodeReceipt({
    chainId: opts?.chainId ?? 9800n,
    conversationId: receipt.conversationId,
    counter: receipt.counter,
    ciphertextHash: receipt.ciphertextHash,
    recipient,
  });
  let key: Uint8Array;
  try {
    key = await chain.mldsaKey(recipient);
  } catch (error) {
    throw new CourierError("RECEIPT", error instanceof Error ? error.message : "recipient has no ML-DSA key on chain");
  }
  if (!pqVerify(key, hexToBytes(message), hexToBytes(receipt.signature))) {
    throw new CourierError("RECEIPT", "receipt signature does not match the recipient's on-chain key");
  }
}
