import { readFileSync } from "node:fs";
import { mldsa87 } from "@qorechain/pqc";
import { encodeAuthMessage } from "haven-pq-kit/pqauth";
import { quorumAction } from "haven-pq-kit/quorum";
import { getAddress, hexToBytes, keccak256, toBytes, toFunctionSelector, type Abi, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  CHAIN_ID,
  cancelArgs,
  deliverArgs,
  disputeArgs,
  escrowAbi,
  factoryAbi,
  releaseArgs,
  resolveArgs,
  signCancel,
  signDeliver,
  signDispute,
  signRelease,
  signResolve,
  type SigningAccount,
} from "../../src/ts/escrow.js";

const escrow = getAddress(`0x${"33".repeat(20)}`);
const m = 1n;
const commitment = keccak256(toBytes("haven-escrow.vectors.commitment"));
const amount = 1_000_000n;
const nonce = 4n;
const deadline = 1_700_003_600n;

function account(): SigningAccount & { publicKey: Uint8Array } {
  const keys = mldsa87.keygen();
  return {
    evm: getAddress(`0x${"ab".repeat(20)}`),
    pqc: { secretKey: keys.secretKey },
    publicKey: keys.publicKey,
  };
}

describe("vectors", () => {
  it("matches the TypeScript hashes", () => {
    const file = JSON.parse(readFileSync("vectors/escrow.json", "utf8")) as {
      actions: typeof ACTIONS;
      args: Record<string, Hex>;
      messages: Record<string, Hex>;
      quorumAction: Hex;
      commitment: Hex;
    };
    expect(file.actions).toEqual(ACTIONS);
    expect(file.commitment).toBe(commitment);
    expect(file.args.deliver).toBe(deliverArgs(m, commitment));
    expect(file.args.release).toBe(releaseArgs(m, amount));
    expect(file.args.disputeByClient).toBe(disputeArgs(m, true));
    expect(file.args.disputeByFreelancer).toBe(disputeArgs(m, false));
    expect(file.args.cancel).toBe(cancelArgs(m));
    expect(file.args.resolve).toBe(resolveArgs(m, 7000));
    expect(file.quorumAction).toBe(quorumAction(ACTIONS.resolve));
    expect(file.messages.deliver).toBe(
      encodeAuthMessage({
        chainId: CHAIN_ID,
        contract: escrow,
        signer: getAddress(`0x${"22".repeat(20)}`),
        action: ACTIONS.deliver,
        nonce,
        deadline,
        argsHash: file.args.deliver,
      }),
    );
  });
});

describe("signatures", () => {
  it("verifies with the signer's ML-DSA-87 key", () => {
    const client = account();
    const freelancer = { ...account(), evm: getAddress(`0x${"cd".repeat(20)}`) };
    const fields = { escrow, m, nonce, deadline };
    const cases = [
      {
        who: freelancer,
        signature: signDeliver(freelancer, { ...fields, commitment }),
        action: ACTIONS.deliver,
        argsHash: deliverArgs(m, commitment),
      },
      {
        who: client,
        signature: signRelease(client, { ...fields, amount }),
        action: ACTIONS.release,
        argsHash: releaseArgs(m, amount),
      },
      {
        who: client,
        signature: signDispute(client, { ...fields, byClient: true }),
        action: ACTIONS.dispute,
        argsHash: disputeArgs(m, true),
      },
      {
        who: client,
        signature: signCancel(client, fields),
        action: ACTIONS.cancel,
        argsHash: cancelArgs(m),
      },
    ];
    for (const row of cases) {
      const message = encodeAuthMessage({
        chainId: CHAIN_ID,
        contract: escrow,
        signer: row.who.evm,
        action: row.action,
        nonce,
        deadline,
        argsHash: row.argsHash,
      });
      expect(mldsa87.verify(row.who.publicKey, hexToBytes(message), hexToBytes(row.signature))).toBe(true);
    }

    const arbiters = [account(), account(), account()].map((signer, index) => ({
      account: getAddress(`0x${(index + 3).toString(16).padStart(40, "f")}`),
      secretKey: signer.pqc.secretKey,
      publicKey: signer.publicKey,
    }));
    const shares = signResolve(
      [...arbiters].reverse().map(({ account: evm, secretKey }) => ({ account: evm, secretKey })),
      { ...fields, splitBps: 7000 },
    );
    const sorted = [...arbiters].sort((a, b) => (a.account.toLowerCase() < b.account.toLowerCase() ? -1 : 1));
    expect(shares.who.map((who) => who.toLowerCase())).toEqual(sorted.map((who) => who.account.toLowerCase()));
    shares.signatures.forEach((signature, index) => {
      const message = encodeAuthMessage({
        chainId: CHAIN_ID,
        contract: escrow,
        signer: shares.who[index],
        action: quorumAction(ACTIONS.resolve),
        nonce,
        deadline,
        argsHash: resolveArgs(m, 7000),
      });
      expect(mldsa87.verify(sorted[index].publicKey, hexToBytes(message), hexToBytes(signature))).toBe(true);
    });
  });
});

describe("abi", () => {
  it("test_abi_hasNoRecipientParameter", () => {
    const artifact = JSON.parse(readFileSync("out/HavenEscrow.sol/HavenEscrow.json", "utf8")) as { abi: Abi };
    const functions = artifact.abi.filter((item) => item.type === "function");
    const addressInputs = functions
      .filter((item) => item.stateMutability !== "view" && item.stateMutability !== "pure")
      .flatMap((item) =>
        item.inputs
          .filter((input) => input.type.includes("address"))
          .map((input) => ({ name: item.name, input: input.name, type: input.type })),
      );
    expect(addressInputs).toEqual([{ name: "resolve", input: "who", type: "address[]" }]);

    const artifactSelectors = functions.map((item) => toFunctionSelector(item)).sort();
    const abiSelectors = escrowAbi.filter((item) => item.type === "function").map((item) => toFunctionSelector(item)).sort();
    expect(abiSelectors).toEqual(artifactSelectors);

    const factory = JSON.parse(readFileSync("out/EscrowFactory.sol/EscrowFactory.json", "utf8")) as { abi: Abi };
    const factorySelectors = factory.abi.filter((item) => item.type === "function").map((item) => toFunctionSelector(item)).sort();
    const declared = factoryAbi.filter((item) => item.type === "function").map((item) => toFunctionSelector(item)).sort();
    expect(declared).toEqual(factorySelectors);
  });
});
