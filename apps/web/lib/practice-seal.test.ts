import { getAddress, keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import { RECORDED_CONVERSATION, conversationFor, encodeReceipt, sealPracticeFile } from "./practice-seal";

describe("practice seal", () => {
  it("seals a file whose ciphertext hash is the word inside the receipt", async () => {
    const escrow = getAddress(`0x${"44".repeat(20)}`);
    const sealed = await sealPracticeFile(escrow);
    expect(sealed.conversationId).not.toBe(RECORDED_CONVERSATION);
    expect(sealed.conversationId).toBe(conversationFor(escrow));
    expect(sealed.ciphertextHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(sealed.commitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(sealed.commitment).not.toBe(sealed.ciphertextHash);
    const message = encodeReceipt({
      conversationId: sealed.conversationId,
      counter: 0,
      ciphertextHash: sealed.ciphertextHash,
      recipient: getAddress(`0x${"55".repeat(20)}`),
    });
    expect(message.startsWith(keccak256(toBytes("courier.receipt.v1")))).toBe(true);
    expect(message.includes(sealed.ciphertextHash.slice(2))).toBe(true);
    expect(message.includes(RECORDED_CONVERSATION.slice(2))).toBe(false);
  });
});
