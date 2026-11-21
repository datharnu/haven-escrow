import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { PRACTICE_AMOUNT, REFUSAL_GAS, REVIEW_SECONDS, SIGNATURE_BYTES, isForbidden, practiceTerms, sortAddresses, suggestedQor } from "./practice";

describe("practice terms", () => {
  const client = getAddress("0x1111111111111111111111111111111111111111");
  const freelancer = getAddress("0x2222222222222222222222222222222222222222");
  const arbiters = [
    getAddress("0x0000000000000000000000000000000000000005"),
    getAddress("0x0000000000000000000000000000000000000003"),
    getAddress("0x0000000000000000000000000000000000000004"),
  ] as const;

  it("names only the two parties and sorts the panel", () => {
    const terms = practiceTerms({ client, freelancer, arbiters, now: 1_700_000_000n });
    expect(terms.client).toBe(client);
    expect(terms.freelancer).toBe(freelancer);
    expect(terms.amounts).toEqual([PRACTICE_AMOUNT]);
    expect(terms.reviewPeriod).toBe(BigInt(REVIEW_SECONDS));
    expect(terms.arbiters.map((item) => item.toLowerCase())).toEqual(sortAddresses(arbiters).map((item) => item.toLowerCase()));
    expect(Object.keys(terms)).toEqual([
      "client",
      "freelancer",
      "token",
      "arbiters",
      "reviewPeriod",
      "arbiterTimeout",
      "defaultSplitBps",
      "amounts",
      "deadlines",
    ]);
  });

  it("refuses a project account and a party used as an arbiter", () => {
    expect(isForbidden("0xE22ff1Cd5d4B9a496C68FeD4946f2cE1dd8954Bd")).toBe(true);
    expect(isForbidden(client)).toBe(false);
    expect(() => practiceTerms({ client, freelancer: client, arbiters, now: 1n })).toThrow(/same address/);
    expect(() =>
      practiceTerms({
        client,
        freelancer,
        arbiters: [client, arbiters[1], arbiters[2]],
        now: 1n,
      }),
    ).toThrow(/arbiter/i);
  });

  it("asks for the window caps plus five fees", () => {
    expect(suggestedQor()).toBe(5_000_000n + 2_000_000n * 4n + 180_000n * 5n);
  });

  it("keeps the refusal gas and the signature length used by the scenes", () => {
    expect(REFUSAL_GAS).toBe(1_500_000n);
    expect(SIGNATURE_BYTES).toBe(4627);
  });
});
