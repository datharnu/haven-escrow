/** Shared byte helpers. Hex in a bundle is lowercase and `0x`-prefixed, so two clients hash the same JSON. */

export type CourierCode =
  | "ADDRESS"
  | "AEAD"
  | "BUNDLE_EXPIRED"
  | "BUNDLE_HASH"
  | "BUNDLE_SHAPE"
  | "COUNTER"
  | "FILE_HASH"
  | "GROUP"
  | "IDENTITY_KEM"
  | "INVOICE"
  | "KEM_STEP"
  | "KEY"
  | "ONE_TIME_INDEX"
  | "ONE_TIME_REUSED"
  | "RECEIPT"
  | "SENDER_CARD"
  | "SIGNATURE";

export class CourierError extends Error {
  readonly code: CourierCode;

  constructor(code: CourierCode, message: string) {
    super(message);
    this.name = "CourierError";
    this.code = code;
  }
}

export function isCourierError(err: unknown, code?: CourierCode): err is CourierError {
  return err instanceof CourierError && (code === undefined || err.code === code);
}

type Canonical = null | boolean | number | string | Canonical[] | { [key: string]: Canonical };

/** Sorted keys, no spaces. `undefined` is a mistake, not a missing field. */
export function canonical(value: Canonical): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new CourierError("BUNDLE_SHAPE", "canonical numbers are safe integers");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  const parts = keys.map((key) => {
    const item = value[key];
    if (item === undefined) throw new CourierError("BUNDLE_SHAPE", `missing ${key}`);
    return `${JSON.stringify(key)}:${canonical(item)}`;
  });
  return `{${parts.join(",")}}`;
}

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** A copy, so wiping the source does not wipe the value we kept. */
export function bytes(input: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.length);
  out.set(input);
  return out;
}

export function wipe(input: Uint8Array | undefined): void {
  input?.fill(0);
}

export function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

export function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}
