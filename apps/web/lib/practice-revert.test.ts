import { describe, expect, it } from "vitest";
import { encodeErrorResult, type Hex } from "viem";
import escrowAbi from "./abi/haven-escrow.json";
import { chooseSequence, nonceFrom, plainRevert } from "./practice-chain";

describe("plainRevert", () => {
  it("names an unregistered key without the call arguments", () => {
    const data =
      "0x099326a900000000000000000000000015592bcdd82f47d80f186594b0997d3464655f47" as Hex;
    const text = plainRevert(data);
    expect(text).toContain("KeyNotRegistered");
    expect(text).toContain("0x15592bcDD82f47d80F186594b0997d3464655f47");
    expect(text).toContain("Register the five identities first.");
    expect(text).not.toContain("Estimate Gas");
  });

  it("names a known escrow error", () => {
    expect(plainRevert("0x37e8456b")).toBe("The contract refused this: SignatureInvalid.");
  });
});

describe("chooseSequence", () => {
  it("uses the Cosmos sequence when the EVM nonce is behind", () => {
    expect(chooseSequence(11n, 10n, null)).toBe(11n);
  });

  it("uses the EVM nonce when the account query is behind", () => {
    expect(chooseSequence(2n, 3n, null)).toBe(3n);
  });

  it("keeps a sequence this page already consumed", () => {
    expect(chooseSequence(11n, 11n, 12n)).toBe(12n);
  });
});

describe("nonceFrom", () => {
  it("reads the list the node returns", () => {
    const row = [4n, 5n, 6n];
    expect(nonceFrom(row, 0, "clientNonce")).toBe(4n);
    expect(nonceFrom(row, 1, "freelancerNonce")).toBe(5n);
    expect(nonceFrom(row, 2, "arbiterNonce")).toBe(6n);
  });

  it("reads named nonces when a decoder adds them", () => {
    expect(nonceFrom({ clientNonce: 1n, freelancerNonce: 2n, arbiterNonce: 3n }, 1, "freelancerNonce")).toBe(2n);
  });
});

describe("plainRevert status", () => {
  it("names an unfunded milestone without the raw arguments", () => {
    const data = encodeErrorResult({ abi: escrowAbi, errorName: "WrongStatus", args: [0n, 0] });
    const text = plainRevert(data as Hex);
    expect(text).toBe("The milestone is Unfunded. This action does not apply to that state.");
  });
});
