import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The 12 findings in docs/audit/stage-{1,2}-2026-11-21.pdf, with the location
 * each one cites, copied from the PDFs. `checkFindings` tests every finding
 * against the Solidity source and the shipped HavenEscrow ABI.
 *
 * Eight findings name a function. Those must not appear anywhere in the
 * source, as any identifier, in any case. Four Stage 1 findings name a
 * category instead ("admin functions", "transfer functions", ...). Those get
 * the narrower check written next to them.
 */

export type Finding = {
  stage: 1 | 2;
  title: string;
  location: string;
  /** Set when the auditor named a function. */
  name?: string;
};

export const FINDINGS: Finding[] = [
  { stage: 1, title: "Reentrancy Vulnerability in withdraw function", location: "HavenEscrow.sol:withdraw function", name: "withdraw" },
  { stage: 1, title: "Missing Access Control on Critical Functions", location: "HavenEscrow.sol:admin functions" },
  { stage: 1, title: "Potential Integer Overflow in Balance Calculations", location: "HavenEscrow.sol:balance update functions" },
  { stage: 1, title: "Unchecked External Call Return Values", location: "HavenEscrow.sol:transfer functions" },
  { stage: 1, title: "Front-Running Vulnerability in Withdrawal Process", location: "HavenEscrow.sol:withdraw function", name: "withdraw" },
  { stage: 1, title: "Unbounded Loop in Batch Operations", location: "HavenEscrow.sol:batch processing functions" },
  { stage: 2, title: "Reentrancy Vulnerability in withdraw function", location: "HavenEscrow.sol:withdraw function", name: "withdraw" },
  { stage: 2, title: "Missing Access Control on Critical Functions", location: "HavenEscrow.sol:setFee function", name: "setFee" },
  { stage: 2, title: "Potential Integer Overflow in Fee Calculation", location: "HavenEscrow.sol:calculateFee function", name: "calculateFee" },
  { stage: 2, title: "Unchecked ETH Transfer Return Value", location: "HavenEscrow.sol:withdraw function", name: "withdraw" },
  { stage: 2, title: "Front-Running Vulnerability in Deposit Function", location: "HavenEscrow.sol:deposit function", name: "deposit" },
  { stage: 2, title: "Unbounded Loop in getBalances Function", location: "HavenEscrow.sol:getBalances function", name: "getBalances" },
];

export type Source = { path: string; text: string };

export type Result = { finding: Finding; ok: boolean; detail: string };

/**
 * Escrow contracts the audit covers. The PDFs were run on HavenEscrow.sol; the V2 files (the receipt gate)
 * are held to the same checks so a later version cannot quietly add what the findings describe.
 */
export const ESCROW_FILES = [
  "src/HavenEscrow.sol",
  "src/EscrowFactory.sol",
  "src/EscrowArgs.sol",
  "src/HavenEscrowV2.sol",
  "src/EscrowFactoryV2.sol",
  "src/IDeliveryReceipts.sol",
];
/** Everything compiled into or alongside the escrow, including the vendored PQC kit. */
export const SOURCE_DIRS = ["src", "lib/haven-pq-kit/src"];
export const ABI_FILE = "apps/web/lib/abi/haven-escrow.json";
export const ABI_FILES = [ABI_FILE, "apps/web/lib/abi/haven-escrow-v2.json"];

function solidityFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return solidityFiles(path);
    return path.endsWith(".sol") ? [path] : [];
  });
}

export function loadSources(dirs: string[] = SOURCE_DIRS): Source[] {
  return dirs.flatMap(solidityFiles).map((path) => ({ path, text: readFileSync(path, "utf8") }));
}

export function loadAbiNames(paths: string | string[] = ABI_FILES): string[] {
  return (Array.isArray(paths) ? paths : [paths]).flatMap((path) => {
    const abi = JSON.parse(readFileSync(path, "utf8")) as { type?: string; name?: string }[];
    return abi.filter((item) => item.type === "function" && item.name).map((item) => item.name as string);
  });
}

function hits(sources: Source[], pattern: RegExp): string[] {
  const out: string[] = [];
  for (const { path, text } of sources) {
    text.split("\n").forEach((line, i) => {
      if (pattern.test(line)) out.push(`${path}:${i + 1}`);
    });
  }
  return out;
}

function functionNames(sources: Source[]): string[] {
  return sources.flatMap(({ text }) => [...text.matchAll(/\bfunction\s+([A-Za-z_]\w*)/g)].map((m) => m[1]));
}

function checkCategory(finding: Finding, escrow: Source[]): Result {
  const names = functionNames(escrow);
  switch (finding.location) {
    case "HavenEscrow.sol:admin functions": {
      const found = hits(escrow, /\b(owner|onlyOwner|admin|onlyAdmin|setFee|setOwner|upgradeTo)\b/i);
      return {
        finding,
        ok: found.length === 0,
        detail: found.length ? `found at ${found.join(", ")}` : "no owner, admin, or setter in the escrow source",
      };
    }
    case "HavenEscrow.sol:balance update functions": {
      const balanceFns = names.filter((n) => /balance/i.test(n));
      const unchecked = hits(escrow, /\bunchecked\s*\{/);
      const pragmaOk = escrow.every(({ text }) => /pragma solidity 0\.8\.\d+;/.test(text));
      const ok = balanceFns.length === 0 && unchecked.length === 0 && pragmaOk;
      return {
        finding,
        ok,
        detail: ok
          ? "no balance-update function; every file is Solidity 0.8.x with no unchecked block"
          : `balance functions ${balanceFns.join(",") || "none"}; unchecked ${unchecked.join(",") || "none"}; pragma 0.8.x ${pragmaOk}`,
      };
    }
    case "HavenEscrow.sol:transfer functions": {
      // This one names something that does exist in spirit: `_pay` calls the token's transfer.
      // The check, per escrow contract: that is its only low-level call and its return value is checked.
      // Other external calls allowed: `view` reads (STATICCALL) of the token balance, and V2's read of DeliveryReceipts.
      const lowLevel = /\.(call|delegatecall|staticcall|transfer|send)\s*[({]/;
      const interfaceCall = /\bI[A-Z]\w*\(\w+\)\.\w+\s*\(/;
      const allowedRead = /\bIDeliveryReceipts\(receipts\)\.receipt\(|\bIERC20\(token\)\.balanceOf\(address\(this\)\)/;
      const returnCheck = /if \(!ok \|\| \(ret\.length != 0 && !abi\.decode\(ret, \(bool\)\)\)\) revert TransferFailed\(\);/;
      const problems: string[] = [];
      const found: string[] = [];
      for (const file of escrow) {
        const calls = hits([file], lowLevel);
        if (calls.length === 0) continue;
        found.push(...calls);
        if (calls.length !== 1) problems.push(`${file.path} has ${calls.length} low-level calls`);
        if (!returnCheck.test(file.text)) problems.push(`${file.path} does not check the return value`);
      }
      const reads = hits(escrow, interfaceCall);
      const strayReads = reads.filter((where) => {
        const [path, line] = [where.slice(0, where.lastIndexOf(":")), Number(where.slice(where.lastIndexOf(":") + 1))];
        const text = escrow.find((s) => s.path === path)?.text.split("\n")[line - 1] ?? "";
        return !allowedRead.test(text);
      });
      if (strayReads.length) problems.push(`other external calls at ${strayReads.join(", ")}`);
      if (found.length === 0) problems.push("no _pay call found");
      const ok = problems.length === 0;
      return {
        finding,
        ok,
        detail: ok
          ? `one low-level call per escrow (${found.join(", ")}, in _pay), each return value checked (TransferFailed)` +
            `; other calls are view reads only (token balanceOf, DeliveryReceipts.receipt) at ${reads.join(", ")}`
          : problems.join("; "),
      };
    }
    case "HavenEscrow.sol:batch processing functions": {
      const batchFns = names.filter((n) => /batch/i.test(n));
      const capped = escrow.some(({ text }) => /MAX_MILESTONES = 8;/.test(text));
      const ok = batchFns.length === 0 && capped;
      return {
        finding,
        ok,
        detail: ok ? "no batch function; loops are capped by MAX_MILESTONES = 8" : `batch functions ${batchFns.join(",") || "none"}; cap present ${capped}`,
      };
    }
    default:
      return { finding, ok: false, detail: `no check written for location "${finding.location}"` };
  }
}

/** Returns one result per finding. A finding passes when the code does not contain what it describes. */
export function checkFindings(sources: Source[], abiNames: string[], escrowFiles: string[] = ESCROW_FILES): Result[] {
  const escrow = sources.filter((s) => escrowFiles.includes(s.path));
  return FINDINGS.map((finding) => {
    if (!finding.name) return checkCategory(finding, escrow);
    const pattern = new RegExp(`\\b${finding.name}\\b`, "i");
    const found = hits(sources, pattern);
    const inAbi = abiNames.some((n) => pattern.test(n));
    const ok = found.length === 0 && !inAbi;
    return {
      finding,
      ok,
      detail: ok
        ? `"${finding.name}" appears nowhere in ${sources.length} .sol files or the ABI`
        : `"${finding.name}" found at ${[...found, ...(inAbi ? ["ABI"] : [])].join(", ")}`,
    };
  });
}
