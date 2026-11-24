import { describe, expect, it } from "vitest";
import {
  FINDINGS,
  FINDINGS_V2,
  V2_ABI_FILE,
  V2_PASTE,
  checkFindings,
  checkFindingsV2,
  loadAbiNames,
  loadPaste,
  loadSources,
} from "../../scripts/lib/audit-names.js";

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

  it("would catch a V2 escrow that calls out to anything but its two view reads", () => {
    const planted = {
      path: "src/HavenEscrowV2.sol",
      text: [
        "pragma solidity 0.8.28;",
        "uint256 internal constant MAX_MILESTONES = 8;",
        "(bool ok, bytes memory ret) = token.call(data);",
        "if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();",
        "(, uint256 at) = IDeliveryReceipts(receipts).receipt(c, n, h, client);",
        "IHook(hook).notify(m);",
      ].join("\n"),
    };
    const results = checkFindings([planted], []);
    const transfer = results.find((r) => r.finding.location === "HavenEscrow.sol:transfer functions");
    expect(transfer?.ok).toBe(false);
    expect(transfer?.detail).toContain("src/HavenEscrowV2.sol:6");
  });

  describe("HavenEscrowV2 stage 1", () => {
    const realPay = [
      "function _pay(bool toFreelancer, uint256 amount) internal {",
      "(bool ok, bytes memory ret) = token.call(",
      "    abi.encodeWithSelector(IERC20.transfer.selector, toFreelancer ? freelancer : client, amount)",
      ");",
      "if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();",
    ];

    it("lists all 6 findings from the V2 PDF over the 7 pasted files", () => {
      expect(FINDINGS_V2).toHaveLength(6);
      expect(V2_PASTE).toHaveLength(7);
    });

    it("passes every V2 check against the source and the shipped V2 ABI", () => {
      const results = checkFindingsV2(loadPaste(), loadAbiNames(V2_ABI_FILE));
      expect(results.filter((r) => !r.ok)).toEqual([]);
    });

    it("would catch a withdraw, a transfer() function, or an unchecked token call", () => {
      const planted = (lines: string[]) => [{ path: "src/HavenEscrowV2.sol", text: lines.join("\n") }];
      const fail = (lines: string[], abi: string[] = []) =>
        checkFindingsV2(planted(lines), abi).filter((r) => !r.ok).map((r) => r.finding.name);
      expect(fail(realPay)).toEqual([]);
      expect(fail([...realPay, "function withdraw(address to) external {}"])).toContain("withdraw");
      expect(fail([...realPay, "function transfer(address to, uint256 a) external {}"])).toContain("transfer");
      expect(fail(realPay.filter((line) => !line.includes("revert TransferFailed")))).toContain("transfer");
      expect(fail(realPay, ["getBalances"])).toContain("getBalances");
    });
  });
});
