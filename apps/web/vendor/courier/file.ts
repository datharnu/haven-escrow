import { randomBytes } from "@noble/ciphers/utils.js";
import { keccak256 } from "viem";

import { bytes, CourierError, utf8 } from "./bytes";
import { freshNonce, open, seal } from "./crypto";

export type FileBlob = {
  hash: string;
  nonce: string;
  ciphertext: string;
};

/** A file key is 32 random bytes. It travels inside a ratchet message, never inside a KEM to a long-term key. */
export function sealFile(plain: Uint8Array): { blob: FileBlob; key: Uint8Array } {
  const key = randomBytes(32);
  const nonce = freshNonce();
  const hash = keccak256(plain);
  const ciphertext = seal(key, nonce, utf8(`courier.file.v1|${hash}`), plain);
  return { blob: { hash, nonce: hex(nonce), ciphertext: hex(ciphertext) }, key };
}

export function openFile(blob: FileBlob, key: Uint8Array): Uint8Array {
  if (key.length !== 32) throw new CourierError("AEAD", "a file key is 32 bytes");
  let plain: Uint8Array;
  try {
    plain = open(key, fromHex(blob.nonce, 24), utf8(`courier.file.v1|${blob.hash}`), fromHex(blob.ciphertext));
  } catch (err) {
    if (err instanceof CourierError) throw err;
    throw new CourierError("AEAD", "file tag failed");
  }
  if (keccak256(plain) !== blob.hash) throw new CourierError("FILE_HASH", "file hash does not match");
  return plain;
}

function hex(value: Uint8Array): string {
  let out = "0x";
  for (const byte of value) out += byte.toString(16).padStart(2, "0");
  return out;
}

function fromHex(value: string, byteLength?: number): Uint8Array {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/.test(value)) {
    throw new CourierError("BUNDLE_SHAPE", "file field is not lowercase hex");
  }
  if (byteLength !== undefined && value.length !== 2 + byteLength * 2) {
    throw new CourierError("BUNDLE_SHAPE", "file field has the wrong length");
  }
  const out = new Uint8Array((value.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(value.slice(2 + i * 2, 4 + i * 2), 16);
  return bytes(out);
}
