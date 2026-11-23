import { readFileSync } from "node:fs";
import { mldsa87 } from "@qorechain/pqc";
import { generateSealKeys, recipientOf } from "@qorechain/qoreseal";
import { getAddress, hexToBytes, keccak256, toFunctionSelector, toBytes, type Abi, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { commitmentOf, sealDeliverable } from "../../src/ts/deliverable.js";
import {
  RECEIPT_DOMAIN,
  clientReceiptFor,
  commitmentOfParts,
  conversationFor,
  encodeCourierReceipt,
  escrowV2Abi,
  factoryV2Abi,
  partsOf,
  signCourierReceipt,
} from "../../src/ts/receipt-gate.js";

const escrow = getAddress(`0x${"44".repeat(20)}`);
const client = getAddress(`0x${"c1".repeat(20)}`);

function selectors(abi: Abi, type: "function" | "event" | "error"): string[] {
  return abi
    .filter((item) => item.type === type)
    .map((item) => toFunctionSelector(item as Parameters<typeof toFunctionSelector>[0]))
    .sort();
}

function artifact(path: string): Abi {
  return (JSON.parse(readFileSync(path, "utf8")) as { abi: Abi }).abi;
}

async function sealed(m: bigint) {
  const keys = [generateSealKeys(), generateSealKeys(), generateSealKeys(), generateSealKeys()] as const;
  return sealDeliverable({
    file: new TextEncoder().encode("receipt-gate file"),
    fileName: "gate.txt",
    escrow,
    m,
    client: recipientOf(keys[0]),
    arbiters: [recipientOf(keys[1]), recipientOf(keys[2]), recipientOf(keys[3])],
  });
}

describe("receipt gate", () => {
  it("parts open exactly commitmentOf, and bind the escrow and the milestone", async () => {
    const manifest = await sealed(1n);
    const parts = partsOf(manifest);
    expect(commitmentOfParts(escrow, 1n, parts)).toBe(commitmentOf(manifest));
    expect(commitmentOfParts(escrow, 0n, parts)).not.toBe(commitmentOf(manifest));
    expect(commitmentOfParts(getAddress(`0x${"45".repeat(20)}`), 1n, parts)).not.toBe(commitmentOf(manifest));
    expect(parts[0]).toBe(keccak256(manifest.ciphertext));
  });

  it("the client's receipt is over the commitment, not the bare ciphertext hash", async () => {
    const manifest = await sealed(0n);
    const fields = clientReceiptFor(manifest, client, 0n);
    expect(fields.ciphertextHash).toBe(commitmentOf(manifest));
    expect(fields.ciphertextHash).not.toBe(keccak256(manifest.ciphertext));
    expect(fields.conversationId).toBe(conversationFor(escrow));
    expect(fields.recipient).toBe(client);
  });

  it("encodes the same bytes as Courier's own receipt encoder", async () => {
    // A computed path keeps the root typecheck off the web app's vendored files; vitest still loads them.
    const vendored = "../../apps/web/vendor/courier/receipt.ts";
    const { encodeReceipt: courierEncodeReceipt } = (await import(/* @vite-ignore */ vendored)) as {
      encodeReceipt: (args: { conversationId: Hex; counter: number; ciphertextHash: Hex; recipient: string }) => Hex;
    };
    const fields = {
      conversationId: keccak256(toBytes("conversation")),
      counter: 3n,
      ciphertextHash: keccak256(toBytes("commitment")),
      recipient: client,
    };
    const ours = encodeCourierReceipt(fields);
    const courier = courierEncodeReceipt({ ...fields, counter: 3 });
    expect(ours.toLowerCase()).toBe(courier.toLowerCase());
    expect(ours.slice(0, 66)).toBe(RECEIPT_DOMAIN);
    expect((ours.length - 2) / 2).toBe(6 * 32);
  });

  it("signs an ML-DSA-87 receipt that verifies only for its own message", () => {
    const keys = mldsa87.keygen();
    const fields = {
      conversationId: conversationFor(escrow),
      counter: 0n,
      ciphertextHash: keccak256(toBytes("c")),
      recipient: client,
    };
    const sig: Hex = signCourierReceipt(keys.secretKey, fields);
    expect((sig.length - 2) / 2).toBe(4627);
    const message = hexToBytes(encodeCourierReceipt(fields));
    expect(mldsa87.verify(keys.publicKey, message, hexToBytes(sig))).toBe(true);
    const other = hexToBytes(encodeCourierReceipt({ ...fields, counter: 1n }));
    expect(mldsa87.verify(keys.publicKey, other, hexToBytes(sig))).toBe(false);
  });

  it("matches the HavenEscrowV2 and EscrowFactoryV2 artifacts", () => {
    // The artifacts also list the PqAuth and PqQuorum errors, so errors are checked one way.
    const pairs = [
      [escrowV2Abi as unknown as Abi, artifact("out/HavenEscrowV2.sol/HavenEscrowV2.json")],
      [factoryV2Abi, artifact("out/EscrowFactoryV2.sol/EscrowFactoryV2.json")],
    ] as const;
    for (const [ours, built] of pairs) {
      expect(selectors(ours, "function")).toEqual(selectors(built, "function"));
      expect(selectors(ours, "event")).toEqual(selectors(built, "event"));
      expect(new Set(selectors(built, "error"))).toEqual(new Set([...selectors(built, "error")].concat(selectors(ours, "error"))));
    }
  });

  it("V2 still has no recipient parameter on any state-changing function", () => {
    const functions = artifact("out/HavenEscrowV2.sol/HavenEscrowV2.json").filter(
      (item) => item.type === "function" && item.stateMutability !== "view" && item.stateMutability !== "pure",
    ) as unknown as { name: string; inputs: { type: string }[] }[];
    for (const fn of functions) {
      expect(fn.inputs.some((input) => input.type === "address" || input.type === "address[]") && fn.name !== "resolve").toBe(false);
    }
  });
});
