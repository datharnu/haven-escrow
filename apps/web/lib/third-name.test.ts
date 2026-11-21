import { describe, expect, it } from "vitest";
import { factoryCalls, escrowCalls, readPayees } from "./third-name";
import { NetworkError } from "./verify";

describe("no third name", () => {
  it("finds who on resolve and no other address on a state-changing escrow function", () => {
    const addresses = escrowCalls.flatMap((call) => call.addresses.map((param) => ({ functionName: call.name, ...param })));
    expect(addresses).toEqual([{ functionName: "resolve", name: "who", type: "address[]" }]);
    expect(escrowCalls.map((call) => call.name)).toEqual([
      "autoRelease",
      "cancel",
      "deliver",
      "dispute",
      "fund",
      "refund",
      "release",
      "resolve",
      "resolveTimeout",
      "sweep",
    ]);
  });

  it("names the client, the freelancer, the token, and the arbiters on factory create", () => {
    expect(factoryCalls.map((call) => call.name)).toEqual(["create"]);
    expect(factoryCalls[0].addresses.map((param) => param.name)).toEqual(["client", "freelancer", "token", "arbiters"]);
  });

  it("does not treat a failed read as a match", async () => {
    const rows = await readPayees(async () => {
      throw new NetworkError();
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.state === "could-not-read")).toBe(true);
  });
});
