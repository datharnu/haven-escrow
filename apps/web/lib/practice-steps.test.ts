import { describe, expect, it } from "vitest";
import { stepState } from "./practice-steps";

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
