import { encodeFunctionResult, keccak256, toBytes, toFunctionSelector, type Abi, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import escrowV2Abi from "./abi/haven-escrow-v2.json";
import recorded from "./receipt-gate.json";
import { GATE, checkGate, parseGate, type GateRecord } from "./receipt-gate";

const abi = escrowV2Abi as Abi;
const word = (s: string) => keccak256(toBytes(s));
const sample: GateRecord = {
  recorded: "2026-11-24",
  network: "qorechain-diana",
  escrow: `0x${"d0".repeat(20)}`,
  factory: `0x${"f2".repeat(20)}`,
  deliveryReceipts: "0x06b52afc4a151b0efa260e2adcdf2d477632cb56",
  client: "0xB911fD43FC85826947d1E11084e594f8b9D466bf",
  freelancer: "0x4D0D492100220F97d07fEa68612fee70ff037764",
  commitment: word("commitment"),
  conversationId: word("conversation"),
  arbiterTimeout: "180",
  disputedAt: "1795399995",
  receivedAt: "1795400000",
  recordedAt: "1795399990",
  paidToFreelancer: "100000",
  paidToClient: "0",
  steps: [{ id: "acknowledge", title: "acknowledge(0)", outcome: "held", hash: word("tx"), who: "Spike, no role" }],
};

describe("receipt gate record", () => {
  it("is shown only when the scene was recorded", () => {
    expect(GATE).toEqual(parseGate(recorded));
    if (recorded === null) expect(GATE).toBeNull();
  });

  it("accepts a well-formed record and refuses a malformed one", () => {
    expect(parseGate(sample)).toEqual(sample);
    expect(parseGate(null)).toBeNull();
    expect(parseGate({ ...sample, commitment: "0x1234" })).toBeNull();
    expect(parseGate({ ...sample, steps: [] })).toBeNull();
    expect(parseGate({ ...sample, steps: [{ ...sample.steps[0], outcome: "maybe" }] })).toBeNull();
  });

  it("checks the escrow, milestone 0, and the client's stored receipt from chain reads only", async () => {
    const calls: { to: string; selector: string }[] = [];
    const answers: Record<string, Hex> = {
      [toFunctionSelector("receipts()")]: encodeFunctionResult({ abi, functionName: "receipts", result: sample.deliveryReceipts }),
      [toFunctionSelector("client()")]: encodeFunctionResult({ abi, functionName: "client", result: sample.client }),
      [toFunctionSelector("receivedSplitBps()")]: encodeFunctionResult({ abi, functionName: "receivedSplitBps", result: 10000 }),
      [toFunctionSelector("milestone(uint256)")]: encodeFunctionResult({
        abi,
        functionName: "milestone",
        result: { amount: 100000n, deadline: 1n, deliveredAt: 2n, receivedAt: 1795400000n, disputedAt: 1795399995n, status: 5, commitment: sample.commitment },
      }),
      [toFunctionSelector("receipt(bytes32,uint256,bytes32,address)")]: `0x${"00".repeat(12)}${"ab".repeat(20)}${(1795399990).toString(16).padStart(64, "0")}`,
    };
    const rpc = async (method: string, params: unknown[]) => {
      expect(method).toBe("eth_call");
      const { to, data } = params[0] as { to: string; data: Hex };
      calls.push({ to: to.toLowerCase(), selector: data.slice(0, 10) });
      return answers[data.slice(0, 10)];
    };
    const result = await checkGate(rpc, sample);
    expect(result).toEqual({
      receiptsMatch: true,
      clientMatches: true,
      receiptRecordedAt: 1795399990n,
      receivedAt: 1795400000n,
      status: 5,
      commitmentMatches: true,
      receivedSplitBps: 10000,
    });
    expect(calls.at(-1)?.to).toBe(sample.deliveryReceipts.toLowerCase());
  });
});
