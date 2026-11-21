import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes } from "viem";

import { bytes, concat, CourierError, u32, utf8, wipe } from "./bytes";

export const SALT = sha256(utf8("courier.v1"));

export const KEM_PUBLIC_BYTES = 1568;
export const KEM_SECRET_BYTES = 3168;
export const KEM_CIPHERTEXT_BYTES = 1568;
export const X25519_BYTES = 32;

export function derive(ikm: Uint8Array, info: Uint8Array, length: number): Uint8Array {
  return bytes(hkdf(sha256, ikm, SALT, info, length));
}

export function handshakeRoot(terms: Uint8Array[]): Uint8Array {
  const ikm = concat(...terms);
  const root = derive(ikm, utf8("courier.handshake.v1"), 32);
  wipe(ikm);
  for (const term of terms) wipe(term);
  return root;
}

export type Direction = { root: Uint8Array; chain: Uint8Array };

/** Wipes `shared`. `aToB` is initiator to responder. */
export function splitRoot(shared: Uint8Array): { aToB: Direction; bToA: Direction } {
  const out = derive(shared, utf8("courier.directions.v1"), 128);
  wipe(shared);
  const parts = {
    aToB: { root: out.slice(0, 32), chain: out.slice(32, 64) },
    bToA: { root: out.slice(64, 96), chain: out.slice(96, 128) },
  };
  wipe(out);
  return parts;
}

/** A new root and chain for one direction. Does not wipe `root`. The caller wipes `secret`. */
export function mixDirection(root: Uint8Array, secret: Uint8Array, counter: number): Direction {
  const ikm = concat(root, secret);
  const out = derive(ikm, concat(utf8("courier.kem.v1"), u32(counter)), 64);
  wipe(ikm);
  const parts = { root: out.slice(0, 32), chain: out.slice(32, 64) };
  wipe(out);
  return parts;
}

/** The next chain and the message key. Does not wipe `chain`. */
export function peek(chain: Uint8Array): { next: Uint8Array; key: Uint8Array } {
  const out = derive(chain, utf8("courier.msg.v1"), 64);
  const parts = { next: out.slice(0, 32), key: out.slice(32, 64) };
  wipe(out);
  return parts;
}

export function aadBytes(
  sender: string,
  recipient: string,
  conversationId: string,
  counter: number,
  kemPublic?: Uint8Array,
  kemCiphertext?: Uint8Array,
  groupId?: string,
): Uint8Array {
  const parts = [
    addressBytes(sender),
    addressBytes(recipient),
    hexBytes(conversationId, 32),
    u32(counter),
    prefixed(kemPublic),
    prefixed(kemCiphertext),
  ];
  if (groupId !== undefined) parts.push(hexBytes(groupId, 32));
  return concat(...parts);
}

export function seal(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, plain: Uint8Array): Uint8Array {
  return bytes(xchacha20poly1305(key, nonce, aad).encrypt(plain));
}

export function open(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  try {
    return bytes(xchacha20poly1305(key, nonce, aad).decrypt(ciphertext));
  } catch {
    throw new CourierError("AEAD", "tag failed");
  }
}

export function freshNonce(): Uint8Array {
  return randomBytes(24);
}

function prefixed(value: Uint8Array | undefined): Uint8Array {
  const body = value ?? new Uint8Array();
  if (body.length > 0xffff) throw new CourierError("BUNDLE_SHAPE", "header is too long");
  const out = new Uint8Array(2 + body.length);
  out[0] = body.length >> 8;
  out[1] = body.length & 0xff;
  out.set(body, 2);
  return out;
}

function addressBytes(value: string): Uint8Array {
  return hexBytes(value, 20);
}

function hexBytes(value: string, byteLength: number): Uint8Array {
  if (!value.startsWith("0x") || value.length !== 2 + byteLength * 2) {
    throw new CourierError("BUNDLE_SHAPE", "bad hex length");
  }
  return hexToBytes(value as `0x${string}`);
}
