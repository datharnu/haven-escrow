/**
 * Sealed milestone files. The chain stores only the commitment.
 * A recipient is accepted only from `recipientFromCard`, which checks the ML-DSA-signed card.
 * This file never reads a KEM key from REST by itself.
 */
import { randomBytes } from "@noble/ciphers/utils.js";
import { gcm } from "@noble/ciphers/aes.js";
import { split, combine } from "shamir-secret-sharing";
import { open, seal, type RecipientCard, type SealKeyPair, type SealRecipient } from "@qorechain/qoreseal";
import { readVerifiedKemKey } from "haven-pq-kit/keydir";
import { TESTNET } from "haven-pq-kit/network";
import {
  encodeAbiParameters,
  hexToBytes,
  keccak256,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { CHAIN_ID } from "./escrow.js";

const FILE_KEY_PURPOSE = "haven-escrow.file-key";
const SHARE_PURPOSE = "haven-escrow.arbiter-share";

export type Manifest = {
  version: 1;
  escrow: Address;
  milestone: bigint;
  fileName: string;
  size: number;
  plaintextHash: Hex;
  nonce: Hex;
  ciphertext: Hex;
  clientEnvelope: Hex;
  arbiterEnvelopes: [Hex, Hex, Hex];
};

/** The only way to turn a published card into a seal recipient. */
export async function recipientFromCard(opts: {
  client: PublicClient;
  rest: string;
  address: string;
  card: RecipientCard;
}): Promise<SealRecipient> {
  const verified = await readVerifiedKemKey({
    client: opts.client,
    rest: opts.rest,
    chainId: TESTNET.chainId,
    address: opts.address,
    card: opts.card,
  });
  return verified.recipient;
}

export async function sealDeliverable(input: {
  file: Uint8Array;
  fileName: string;
  escrow: Address;
  m: bigint;
  client: SealRecipient;
  arbiters: [SealRecipient, SealRecipient, SealRecipient];
}): Promise<Manifest> {
  const fileKey = randomBytes(32);
  const nonce = randomBytes(gcm.nonceLength);
  const aad = aadBytes(input.escrow, input.m);
  const ciphertext = gcm(fileKey, nonce, aad).encrypt(input.file);
  const clientEnvelope = seal({
    chainId: TESTNET.chainId,
    purpose: FILE_KEY_PURPOSE,
    recipients: [input.client],
    plaintext: fileKey,
    aad,
  });
  const shares = await split(fileKey, 3, 2);
  const arbiterEnvelopes = shares.map((share, i) =>
    seal({
      chainId: TESTNET.chainId,
      purpose: SHARE_PURPOSE,
      recipients: [input.arbiters[i]],
      plaintext: share,
      aad,
    }),
  ) as [Uint8Array, Uint8Array, Uint8Array];
  return {
    version: 1,
    escrow: input.escrow,
    milestone: input.m,
    fileName: input.fileName,
    size: input.file.byteLength,
    plaintextHash: keccak256(input.file),
    nonce: toHex(nonce),
    ciphertext: toHex(ciphertext),
    clientEnvelope: toHex(clientEnvelope),
    arbiterEnvelopes: arbiterEnvelopes.map((envelope) => toHex(envelope)) as [Hex, Hex, Hex],
  };
}

export function commitmentOf(manifest: Manifest): Hex {
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
      [
        manifest.escrow,
        manifest.milestone,
        keccak256(manifest.ciphertext),
        keccak256(manifest.clientEnvelope),
        keccak256(manifest.arbiterEnvelopes[0]),
        keccak256(manifest.arbiterEnvelopes[1]),
        keccak256(manifest.arbiterEnvelopes[2]),
      ],
    ),
  );
}

export function openAsClient(manifest: Manifest, keys: SealKeyPair): Uint8Array {
  const aad = aadBytes(manifest.escrow, manifest.milestone);
  const fileKey = open({
    chainId: TESTNET.chainId,
    purpose: FILE_KEY_PURPOSE,
    envelope: hexToBytes(manifest.clientEnvelope),
    keys,
    aad,
  });
  return decryptFile(manifest, fileKey, aad);
}

export function openShare(manifest: Manifest, i: 0 | 1 | 2, keys: SealKeyPair): Uint8Array {
  return open({
    chainId: TESTNET.chainId,
    purpose: SHARE_PURPOSE,
    envelope: hexToBytes(manifest.arbiterEnvelopes[i]),
    keys,
    aad: aadBytes(manifest.escrow, manifest.milestone),
  });
}

export async function openWithShares(manifest: Manifest, shares: Uint8Array[]): Promise<Uint8Array> {
  if (shares.length < 2) throw new Error("two arbiter shares are required");
  const fileKey = await combine(shares);
  return decryptFile(manifest, fileKey, aadBytes(manifest.escrow, manifest.milestone));
}

function decryptFile(manifest: Manifest, fileKey: Uint8Array, aad: Uint8Array): Uint8Array {
  const file = gcm(fileKey, hexToBytes(manifest.nonce), aad).decrypt(hexToBytes(manifest.ciphertext));
  if (keccak256(file) !== manifest.plaintextHash) {
    throw new Error("plaintext hash does not match the manifest");
  }
  return file;
}

function aadBytes(escrow: Address, m: bigint): Uint8Array {
  return hexToBytes(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "uint256" }],
      [CHAIN_ID, escrow, m],
    ),
  );
}
