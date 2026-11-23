import { describe, expect, it } from "vitest";
import { FINDINGS, checkFindings, loadAbiNames, loadSources } from "../../scripts/lib/audit-names.js";

describe("QCAI findings against the source", () => {
  it("lists all 12 findings from both PDFs", () => {
    expect(FINDINGS).toHaveLength(12);
    expect(FINDINGS.filter((f) => f.name)).toHaveLength(8);
  });

  it("finds none of the cited functions, and passes each category check", () => {
    const results = checkFindings(loadSources(), loadAbiNames());
    expect(results.filter((r) => !r.ok)).toEqual([]);
  });

  it("would catch a withdraw, a fee setter, an owner, or a second external call", () => {
    const planted = {
      path: "src/HavenEscrow.sol",
      text: [
        "pragma solidity 0.8.28;",
        "uint256 internal constant MAX_MILESTONES = 8;",
        "address public owner;",
        "function withdraw(address to) external { payable(to).transfer(1); }",
        "function setFee(uint256 f) external {}",
      ].join("\n"),
    };
    const failed = checkFindings([planted], ["deposit"]).filter((r) => !r.ok).map((r) => r.finding.location);
    expect(failed).toContain("HavenEscrow.sol:withdraw function");
    expect(failed).toContain("HavenEscrow.sol:setFee function");
    expect(failed).toContain("HavenEscrow.sol:deposit function");
    expect(failed).toContain("HavenEscrow.sol:admin functions");
    expect(failed).toContain("HavenEscrow.sol:transfer functions");
  });
});
