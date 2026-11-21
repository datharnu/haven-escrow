import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import escrowAbi from "./abi/haven-escrow.json";

type Item = {
  type?: string;
  name?: string;
  stateMutability?: string;
  inputs?: { name?: string; type?: string }[];
};

function addressInputs(abi: readonly Item[]) {
  return abi
    .filter((item) => item.type === "function" && item.stateMutability !== "view" && item.stateMutability !== "pure")
    .flatMap((item) =>
      (item.inputs ?? [])
        .filter((input) => input.type === "address" || input.type === "address[]")
        .map((input) => `${item.name} ${input.type} ${input.name}`),
    );
}

describe("escrow address arguments", () => {
  it("finds only resolve's signers on the shipped ABI", () => {
    expect(addressInputs(escrowAbi as Item[])).toEqual(["resolve address[] who"]);
  });

  it("matches the compiled artifact", () => {
    const compiled = JSON.parse(readFileSync(new URL("../../../out/HavenEscrow.sol/HavenEscrow.json", import.meta.url), "utf8")) as {
      abi: Item[];
    };
    expect(addressInputs(compiled.abi)).toEqual(addressInputs(escrowAbi as Item[]));
  });
});
