import { checkFindings, loadAbiNames, loadSources } from "./lib/audit-names.js";

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
if (passed !== results.length) process.exit(1);
