import { readFileSync } from "node:fs";
import { decodeErrorResult, getAddress, type Abi, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import escrowAbi from "./abi/haven-escrow.json";
import recorded from "./fixtures/recorded-rpc.json";
import { SCENES } from "./record";
import {
  ACTIONS,
  CallError,
  CHAIN_ID,
  NETWORK,
  NO_BROADCAST,
  cancelArgs,
  deliverArgs,
  disputeArgs,
  encodeAuthMessage,
  quorumAction,
  releaseArgs,
  resolveArgs,
  summarize,
  verifyStep,
  type Rpc,
} from "./verify";

type Vectors = {
  chainId: number;
  escrow: Address;
  client: Address;
  freelancer: Address;
  m: number;
  commitment: Hex;
  amount: number;
  splitBps: number;
  nonce: number;
  deadline: number;
  actions: typeof ACTIONS;
  args: {
    deliver: Hex;
    release: Hex;
    disputeByClient: Hex;
    disputeByFreelancer: Hex;
    cancel: Hex;
    resolve: Hex;
  };
  messages: {
    deliver: Hex;
    release: Hex;
    disputeByClient: Hex;
    disputeByFreelancer: Hex;
    cancelClient: Hex;
    cancelFreelancer: Hex;
  };
  quorumAction: Hex;
};

const vectors = JSON.parse(readFileSync(new URL("../../../vectors/escrow.json", import.meta.url), "utf8")) as Vectors;

function message(signer: Address, action: Hex, argsHash: Hex): Hex {
  return encodeAuthMessage({
    chainId: CHAIN_ID,
    contract: getAddress(vectors.escrow),
    signer: getAddress(signer),
    action,
    nonce: BigInt(vectors.nonce),
    deadline: BigInt(vectors.deadline),
    argsHash,
  });
}

describe("the message builder", () => {
  it("rebuilds vectors/escrow.json byte for byte", () => {
    const m = BigInt(vectors.m);
    expect(vectors.chainId).toBe(Number(CHAIN_ID));
    expect(vectors.actions).toEqual(ACTIONS);
    expect(deliverArgs(m, vectors.commitment)).toBe(vectors.args.deliver);
    expect(releaseArgs(m, BigInt(vectors.amount))).toBe(vectors.args.release);
    expect(disputeArgs(m, true)).toBe(vectors.args.disputeByClient);
    expect(disputeArgs(m, false)).toBe(vectors.args.disputeByFreelancer);
    expect(cancelArgs(m)).toBe(vectors.args.cancel);
    expect(resolveArgs(m, vectors.splitBps)).toBe(vectors.args.resolve);
    expect(quorumAction(ACTIONS.resolve)).toBe(vectors.quorumAction);
    expect(message(vectors.freelancer, ACTIONS.deliver, vectors.args.deliver)).toBe(vectors.messages.deliver);
    expect(message(vectors.client, ACTIONS.release, vectors.args.release)).toBe(vectors.messages.release);
    expect(message(vectors.client, ACTIONS.dispute, vectors.args.disputeByClient)).toBe(vectors.messages.disputeByClient);
    expect(message(vectors.freelancer, ACTIONS.dispute, vectors.args.disputeByFreelancer)).toBe(vectors.messages.disputeByFreelancer);
    expect(message(vectors.client, ACTIONS.cancel, vectors.args.cancel)).toBe(vectors.messages.cancelClient);
    expect(message(vectors.freelancer, ACTIONS.cancel, vectors.args.cancel)).toBe(vectors.messages.cancelFreelancer);
  });

  it("names selector 0x37e8456b as SignatureInvalid from the Foundry ABI", () => {
    expect(decodeErrorResult({ abi: escrowAbi as Abi, data: "0x37e8456b" }).errorName).toBe("SignatureInvalid");
  });
});

type Recorded = {
  method: string;
  params: unknown[];
  result?: unknown;
  error?: { message: string; data?: string };
};

function fixtureRpc(): Rpc {
  const replies = new Map<string, Recorded>();
  for (const entry of recorded as Recorded[]) replies.set(JSON.stringify([entry.method, entry.params]), entry);
  return async (method, params) => {
    const entry = replies.get(JSON.stringify([method, params]));
    if (!entry) throw new Error(`no recorded reply for ${method}`);
    if (entry.error) throw new CallError(entry.error.message, entry.error.data as Hex | undefined);
    return entry.result ?? null;
  };
}

/** States read from the testnet on 21 November 2026, then replayed from the saved replies. */
const EXPECTED: Record<string, { errorName?: string; states: string }> = {
  "deliver-0": { states: "pass pass pass pass could-not-check" },
  "release-0": { states: "pass pass pass pass pass" },
  "relay-deliver": { states: "pass pass pass pass could-not-check" },
  "no-window": { states: "could-not-check could-not-check could-not-check could-not-check could-not-check" },
  "classical-open": { states: "could-not-check could-not-check could-not-check could-not-check could-not-check" },
  junk: { errorName: "SignatureInvalid", states: "pass pass pass fail could-not-check" },
  replay: { errorName: "SignatureInvalid", states: "pass pass pass fail could-not-check" },
  cancel: { errorName: "WrongStatus", states: "pass pass could-not-check could-not-check could-not-check" },
  dispute: { states: "pass pass pass pass could-not-check" },
  "one-arbiter": { errorName: "TooFew", states: "pass pass pass pass could-not-check" },
  "two-arbiters": { states: "pass pass pass pass pass" },
  "deliver-b": { states: "pass pass pass pass could-not-check" },
  "too-early": { errorName: "TooEarly", states: "pass pass could-not-check could-not-check could-not-check" },
  auto: { states: "pass pass could-not-check could-not-check pass" },
};

describe("recorded replies", () => {
  it("replays every step offline", async () => {
    const rpc = fixtureRpc();
    for (const scene of SCENES) {
      for (const step of scene.steps) {
        const verdict = await verifyStep(step.hash, rpc);
        const states = verdict.lines.map((line) => line.state).join(" ");
        const expected = EXPECTED[step.id];
        expect(states, step.id).toBe(expected.states);
        expect(verdict.errorName).toBe(expected.errorName);
        expect(verdict.lines.some((line) => line.state === "pass" && verdict.networkError)).toBe(false);
      }
    }
  });

  it("does not call the network when there is no hash", async () => {
    let calls = 0;
    const verdict = await verifyStep(undefined, async () => {
      calls += 1;
      return null;
    });
    expect(calls).toBe(0);
    expect(summarize(verdict)).toBe(NO_BROADCAST);
    expect(verdict.lines.every((line) => line.state === "could-not-check")).toBe(true);
  });

  it("does not turn a network failure into a pass", async () => {
    const { NetworkError } = await import("./verify");
    const verdict = await verifyStep(SCENES[0].steps[0].hash, async () => {
      throw new NetworkError();
    });
    expect(verdict.reached).toBe(false);
    expect(summarize(verdict)).toBe(NETWORK);
    expect(verdict.lines.every((line) => line.state !== "pass")).toBe(true);
  });

  it("checks both arbiter signatures on the two-arbiter resolve", async () => {
    const step = SCENES.flatMap((scene) => scene.steps).find((item) => item.id === "two-arbiters");
    const verdict = await verifyStep(step?.hash, fixtureRpc());
    const signature = verdict.lines.find((line) => line.id === "signature");
    expect(signature?.state).toBe("pass");
    expect(signature?.reason).toContain("0x00fb3E9Bf1A0cb4DF325010004a59722f0c6a248");
    expect(signature?.reason).toContain("0x55937e32E4B3Bd62a49CB7726fB64E7f9AAd945C");
  });
});

