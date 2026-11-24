import { V2_ABI_FILE, checkFindings, checkFindingsV2, loadAbiNames, loadPaste, loadSources } from "./lib/audit-names.js";

/**
 * `npm run audit:check`: checks every QCAI finding in docs/audit/ against the
 * source. Exits 1 if any cited function exists or a category check fails.
 * No chain, no keys.
 */

const sources = loadSources();
const results = checkFindings(sources, loadAbiNames());

for (const { finding, ok, detail } of results) {
  console.log(`${ok ? "PASS" : "FAIL"}  stage ${finding.stage}  ${finding.location.padEnd(44)}  ${detail}`);
}

const named = results.filter((r) => r.finding.name);
const passed = results.filter((r) => r.ok).length;
console.log(
  `\n${passed} of ${results.length} finding checks passed against src/ and lib/haven-pq-kit/src/ (${sources.length} .sol files). ` +
    `${named.filter((r) => r.ok).length} of ${named.length} name a function that does not exist.`,
);

const paste = loadPaste();
const v2 = checkFindingsV2(paste, loadAbiNames(V2_ABI_FILE));
console.log("\nHavenEscrowV2, stage 1 (docs/audit/v2-stage-1-2026-11-24.pdf):");
for (const { finding, ok, detail } of v2) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${finding.severity.padEnd(8)}  ${finding.location.padEnd(34)}  ${detail}`);
}
const v2Passed = v2.filter((r) => r.ok).length;
console.log(`\n${v2Passed} of ${v2.length} V2 finding checks passed against the ${paste.length} pasted files.`);
if (passed !== results.length || v2Passed !== v2.length) process.exit(1);
