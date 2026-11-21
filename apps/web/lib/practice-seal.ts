/**
 * A practice file sealed the way `src/ts/deliverable.ts` seals one.
 * The seal keys exist only while this function runs. The page cannot open the file.
 * Courier's receipt is a different hash. The shared word is keccak256 of the ciphertext.
 */
import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { generateSealKeys, recipientOf, seal, type SealRecipient } from "@qorechain/qoreseal";
import { split } from "shamir-secret-sharing";
import { encodeAbiParameters, getAddress, hexToBytes, keccak256, toBytes, toHex, type Address, type Hex } from "viem";
import { commitmentOf } from "./sealed";

const CHAIN = "qorechain-diana";
const CHAIN_ID = 9800n;
const FILE_KEY_PURPOSE = "haven-escrow.file-key";
const SHARE_PURPOSE = "haven-escrow.arbiter-share";

export const DELIVERY_RECEIPTS = getAddress("0x06b52afc4a151b0efa260e2adcdf2d477632cb56");
/** The live group receipt. This path must not use it. */
export const RECORDED_CONVERSATION = "0xee9e929e97f3b026bd1c537e98d628c60005d8d522b74a4104d94055012cb714" as Hex;
export const RECORDED_RECEIPT = "0x3dfdb6bdf8a11a81792129083642f706a9b4547a62d4d8ebbe3eceb645566a89" as Hex;
export const RECEIPT_COUNTER = 0;
const RECEIPT_DOMAIN = keccak256(toBytes("courier.receipt.v1"));

export function conversationFor(escrow: Address): Hex {
  const id = keccak256(toBytes(`haven-escrow.practice.receipt:${getAddress(escrow)}`));
  if (id.toLowerCase() === RECORDED_CONVERSATION.toLowerCase()) {
    throw new Error("This conversation is the recorded group receipt. Nothing was signed.");
  }
  return id;
}

/** The six words `DeliveryReceipts.signingMessage` encodes. Chain id 9800. */
export function encodeReceipt(args: {
  conversationId: Hex;
  counter: number;
  ciphertextHash: Hex;
  recipient: Address;
}): Hex {
  return encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "uint256" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "bytes32" },
      { type: "address" },
    ],
    [RECEIPT_DOMAIN, CHAIN_ID, args.conversationId, BigInt(args.counter), args.ciphertextHash, args.recipient],
  );
}

function aadBytes(escrow: Address, m: bigint): Uint8Array {
  return hexToBytes(encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "uint256" }], [CHAIN_ID, escrow, m]));
}

async function sealFile(input: {
  file: Uint8Array;
  escrow: Address;
  m: bigint;
  client: SealRecipient;
  arbiters: [SealRecipient, SealRecipient, SealRecipient];
}): Promise<{ ciphertext: Hex; clientEnvelope: Hex; arbiterEnvelopes: [Hex, Hex, Hex] }> {
  const fileKey = randomBytes(32);
  const nonce = randomBytes(gcm.nonceLength);
  const aad = aadBytes(input.escrow, input.m);
  const ciphertext = gcm(fileKey, nonce, aad).encrypt(input.file);
  const clientEnvelope = seal({
    chainId: CHAIN,
    purpose: FILE_KEY_PURPOSE,
    recipients: [input.client],
    plaintext: fileKey,
    aad,
  });
  const shares = await split(fileKey, 3, 2);
  const arbiterEnvelopes = shares.map((share, i) =>
    seal({
      chainId: CHAIN,
      purpose: SHARE_PURPOSE,
      recipients: [input.arbiters[i]],
      plaintext: share,
      aad,
    }),
  );
  return {
    ciphertext: toHex(ciphertext),
    clientEnvelope: toHex(clientEnvelope),
    arbiterEnvelopes: arbiterEnvelopes.map((envelope) => toHex(envelope)) as [Hex, Hex, Hex],
  };
}

/** Seals one practice file and returns the two hashes. The keys are not returned. */
export async function sealPracticeFile(escrow: Address): Promise<{ commitment: Hex; ciphertextHash: Hex; conversationId: Hex }> {
  const file = new TextEncoder().encode("haven practice file");
  const client = generateSealKeys();
  const arbiters = [generateSealKeys(), generateSealKeys(), generateSealKeys()] as const;
  const sealed = await sealFile({
    file,
    escrow: getAddress(escrow),
    m: 0n,
    client: recipientOf(client),
    arbiters: [recipientOf(arbiters[0]), recipientOf(arbiters[1]), recipientOf(arbiters[2])],
  });
  const ciphertextHash = keccak256(sealed.ciphertext);
  return {
    commitment: commitmentOf({
      escrow: getAddress(escrow),
      milestone: 0n,
      ciphertext: sealed.ciphertext,
      clientEnvelope: sealed.clientEnvelope,
      arbiterEnvelopes: sealed.arbiterEnvelopes,
    }),
    ciphertextHash,
    conversationId: conversationFor(escrow),
  };
}
