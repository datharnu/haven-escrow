import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { escrowBFile, filesForScene } from "./sealed";

describe("sealed files", () => {
  it("recomputes the commitment that names each published file", () => {
    const shown = [...filesForScene("release"), ...filesForScene("dispute"), escrowBFile];
    const seen = new Set<string>();
    for (const file of shown) {
      seen.add(file.commitment);
      expect(file.commitment).toMatch(/^0x[0-9a-f]{64}$/);
      expect(file.envelopes).toHaveLength(3);
    }
    expect([...seen].sort()).toEqual([
      "0xa5648e81553bd346c427c0cf7929c172a4d560ba8251e16240b61a4ba2d553af",
      "0xc43688aab45fe927513b0f74257f8be5a1f99480e9c62c1cf0c6f73fe7296e63",
      "0xfa3c3d6b2fcc89da2806587392970eb17794f63b2f609a7fafdeb4074825bffd",
    ]);
  });

  it("ships the same bytes as deployments/deliverables", () => {
    for (const id of [
      "0xa5648e81553bd346c427c0cf7929c172a4d560ba8251e16240b61a4ba2d553af",
      "0xc43688aab45fe927513b0f74257f8be5a1f99480e9c62c1cf0c6f73fe7296e63",
      "0xfa3c3d6b2fcc89da2806587392970eb17794f63b2f609a7fafdeb4074825bffd",
    ]) {
      const shipped = readFileSync(new URL(`./sealed/${id}.json`, import.meta.url));
      const published = readFileSync(new URL(`../../../deployments/deliverables/${id}.json`, import.meta.url));
      expect(createHash("sha256").update(shipped).digest("hex")).toBe(createHash("sha256").update(published).digest("hex"));
    }
  });

  it("shows scene 1 both files and scene 3 the disputed one", () => {
    expect(filesForScene("release").map((file) => file.milestone)).toEqual([0n, 1n]);
    expect(filesForScene("dispute").map((file) => file.fileName)).toEqual(["milestone-1.json"]);
    expect(filesForScene("classical")).toEqual([]);
  });
});
