import { describe, expect, it } from "vitest";
import { guideStep, nextStep, stepState, type NextInput } from "./practice-steps";

const escrow = "0x1111111111111111111111111111111111111111";
const receipt = { commitment: "0x" };

describe("step state", () => {
  it("asks for an escrow before either step can start", () => {
    expect(stepState({}, "client", "receipt")).toBe("Create the escrow first.");
    expect(stepState({}, "freelancer", "deliver")).toBe("Create the escrow first.");
  });

  it("puts Now only on the receipt while the client is selected", () => {
    const deal = { escrow };
    expect(stepState(deal, "client", "receipt")).toBe("Now. Receipt this file.");
    expect(stepState(deal, "client", "deliver")).toBe("Waiting for the receipt.");
    expect(stepState(deal, "freelancer", "receipt")).toBe("Switch to the client.");
    expect(stepState(deal, "freelancer", "deliver")).toBe("Switch to the client.");
  });

  it("puts Now only on the delivery while the freelancer is selected", () => {
    const deal = { escrow, receipt };
    expect(stepState(deal, "client", "receipt")).toBe("Landed.");
    expect(stepState(deal, "client", "deliver")).toBe("Switch to the freelancer.");
    expect(stepState(deal, "freelancer", "receipt")).toBe("Landed.");
    expect(stepState(deal, "freelancer", "deliver")).toBe("Now. Deliver this file.");
  });

  it("marks both steps landed after delivery", () => {
    const deal = { escrow, receipt, delivered: true };
    expect(stepState(deal, "client", "receipt")).toBe("Landed.");
    expect(stepState(deal, "freelancer", "deliver")).toBe("Landed.");
  });
});

const rich = 30_000_000n;
const passed = [2_000_000n, 2_000_000n, 2_000_000n, 2_000_000n];
const keys = { client: true, freelancer: true, "arbiter-1": true, "arbiter-2": true, "arbiter-3": true };

function ready(over: Partial<NextInput> = {}): NextInput {
  return {
    phase: "ready",
    clientUqor: rich,
    otherUqor: passed,
    registered: keys,
    escrow: true,
    fusd: 100_000n,
    milestone: 1,
    receipt: false,
    side: "client",
    ...over,
  };
}

describe("next step", () => {
  it("starts at the faucet when the client cannot pay the fee", () => {
    expect(nextStep(ready({ clientUqor: 0n, phase: "reading", registered: null })).text).toBe("Fund the client from the faucet.");
  });

  it("registers the client before passing QOR", () => {
    expect(nextStep(ready({ registered: { ...keys, client: false }, escrow: false })).primary).toBe("register");
  });

  it("asks for more QOR when the pass would not fit", () => {
    const step = nextStep(ready({ clientUqor: 200_000n, otherUqor: [0n, 0n, 0n, 0n], registered: { ...keys, freelancer: false }, escrow: false }));
    expect(step.primary).toBe("faucet");
    expect(step.fund).toBe("more");
  });

  it("passes QOR, then registers the other four, then creates", () => {
    const unregistered = { client: true, freelancer: false, "arbiter-1": false, "arbiter-2": false, "arbiter-3": false };
    expect(nextStep(ready({ otherUqor: [0n, 0n, 0n, 0n], registered: unregistered, escrow: false })).primary).toBe("pass");
    expect(nextStep(ready({ registered: { ...keys, freelancer: false, "arbiter-1": false }, escrow: false })).text).toBe(
      "Register the freelancer and the panel.",
    );
    expect(nextStep(ready({ escrow: false, milestone: null })).primary).toBe("create");
  });

  it("asks for fUSD before convert, then follows the funded deal", () => {
    expect(nextStep(ready({ milestone: 0, fusd: 0n })).fund).toBe("fusd");
    expect(nextStep(ready({ milestone: 0, side: "freelancer" })).primary).toBe("client");
    expect(nextStep(ready({ milestone: 0 })).primary).toBe("convert");
    expect(nextStep(ready({ side: "freelancer" })).primary).toBe("client");
    expect(nextStep(ready()).primary).toBe("receipt");
    expect(nextStep(ready({ receipt: true })).primary).toBe("freelancer");
    expect(nextStep(ready({ receipt: true, side: "freelancer" })).primary).toBe("deliver");
    expect(nextStep(ready({ milestone: 2 })).primary).toBe("release");
    expect(nextStep(ready({ milestone: 4 })).primary).toBe("resolve");
    expect(nextStep(ready({ milestone: 3 })).text).toBe("The milestone is Released.");
  });

  it("keeps Now off the receipt card until that card is the step", () => {
    expect(guideStep("Now. Receipt this file.", "convert", "receipt")).toBe("Waiting until the earlier steps are done.");
    expect(guideStep("Now. Receipt this file.", "receipt", "receipt")).toBe("Now. Receipt this file.");
    expect(guideStep("Create the escrow first.", "faucet", "deliver")).toBe("Create the escrow first.");
  });
});
