import { generateSealKeys, recipientOf } from "@qorechain/qoreseal";
import { getAddress, hexToBytes, toHex } from "viem";
import { describe, expect, it } from "vitest";
import {
  commitmentOf,
  openAsClient,
  openShare,
  openWithShares,
  sealDeliverable,
} from "../../src/ts/deliverable.js";

const escrow = getAddress(`0x${"33".repeat(20)}`);
const file = new TextEncoder().encode("milestone file");

describe("deliverable", () => {
  it("opens for the client and for every pair of arbiters", async () => {
    const client = generateSealKeys();
    const arbiters = [generateSealKeys(), generateSealKeys(), generateSealKeys()] as const;
    const manifest = await sealDeliverable({
      file,
      fileName: "notes.txt",
      escrow,
      m: 1n,
      client: recipientOf(client),
      arbiters: [recipientOf(arbiters[0]), recipientOf(arbiters[1]), recipientOf(arbiters[2])],
    });

    expect(manifest.version).toBe(1);
    expect(manifest.size).toBe(file.byteLength);
    expect(openAsClient(manifest, client)).toEqual(file);

    const shares = [0, 1, 2].map((i) => openShare(manifest, i as 0 | 1 | 2, arbiters[i]));
    for (const pair of [
      [shares[0], shares[1]],
      [shares[0], shares[2]],
      [shares[1], shares[2]],
    ]) {
      expect(await openWithShares(manifest, pair)).toEqual(file);
    }
    await expect(openWithShares(manifest, [shares[0]])).rejects.toThrow(/two arbiter shares/);

    const flipped = hexToBytes(manifest.ciphertext);
    flipped[0] ^= 0xff;
    expect(() => openAsClient({ ...manifest, ciphertext: toHex(flipped) }, client)).toThrow();

    const swapped = {
      ...manifest,
      arbiterEnvelopes: [manifest.arbiterEnvelopes[1], manifest.arbiterEnvelopes[0], manifest.arbiterEnvelopes[2]] as [
        typeof manifest.arbiterEnvelopes[0],
        typeof manifest.arbiterEnvelopes[1],
        typeof manifest.arbiterEnvelopes[2],
      ],
    };
    expect(commitmentOf(swapped)).not.toBe(commitmentOf(manifest));
  });
});
