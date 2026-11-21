import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The web app ships a copy of the Foundry ABI. This fails if the copy drifts from `out/`. */
describe("web ABI copies", () => {
  it("matches the HavenEscrow artifact", () => {
    const artifact = JSON.parse(readFileSync("out/HavenEscrow.sol/HavenEscrow.json", "utf8")) as { abi: unknown };
    const copy = JSON.parse(readFileSync("apps/web/lib/abi/haven-escrow.json", "utf8"));
    expect(copy).toEqual(artifact.abi);
  });

  it("matches the IQorePQC artifact", () => {
    const artifact = JSON.parse(readFileSync("out/IQorePQC.sol/IQorePQC.json", "utf8")) as { abi: unknown };
    const copy = JSON.parse(readFileSync("apps/web/lib/abi/iqore-pqc.json", "utf8"));
    expect(copy).toEqual(artifact.abi);
  });

  it("matches the IERC20 Transfer event", () => {
    const artifact = JSON.parse(readFileSync("out/IERC20.sol/IERC20.json", "utf8")) as { abi: { type?: string; name?: string }[] };
    const transfer = artifact.abi.find((item) => item.type === "event" && item.name === "Transfer");
    const copy = JSON.parse(readFileSync("apps/web/lib/abi/ierc20-transfer.json", "utf8"));
    expect(copy).toEqual(transfer);
  });
});
