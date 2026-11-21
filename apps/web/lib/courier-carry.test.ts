import { describe, expect, it } from "vitest";
import { keccak256 } from "viem";
import { CourierError, utf8 } from "../vendor/courier/bytes";
import { openFile, sealFile } from "../vendor/courier/file";

describe("Courier carries the file", () => {
  it("opens the same plaintext and uses keccak256 of the ciphertext", () => {
    const plain = utf8("Courier carried this file.");
    const carried = sealFile(plain);
    const opened = openFile(carried.blob, carried.key);
    expect(Array.from(opened)).toEqual(Array.from(plain));
    expect(keccak256(carried.blob.ciphertext as `0x${string}`)).toMatch(/^0x[0-9a-f]{64}$/);
    carried.key.fill(0);
  });

  it("refuses a file the client cannot open", () => {
    const carried = sealFile(utf8("Courier carried this file."));
    const wrong = new Uint8Array(32);
    expect(() => openFile(carried.blob, wrong)).toThrow(CourierError);
    carried.key.fill(0);
  });
});
