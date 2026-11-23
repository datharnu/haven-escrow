# Rerunning the QCAI audit

Both committed reports (21 November 2026) score 35/100, and all 12 findings are false positives (8 name functions that are not in the source). This checklist reruns the dashboard auditor so the result can be compared and recorded. It does not replace the two committed stages; keep both PDFs.

What the repo documents about the tool (`docs/qcai.md`, from the Builder FAQ and https://docs.qorechain.io/dashboard/contract-auditor/):

- It runs at https://dashboard.qorechain.io/audit. Sign-in is required. The first audit each UTC day is free.
- It reviews only the source that is pasted. It does not compile or test.
- For Solidity, use an EVM/Solidity setting such as "Ethereum (EVM/Solidity)". Do not use "QoreChain (CosmWasm + PQC)": on Solidity it reports a "mismatch".
- Quantum readiness shows "Not scored" on EVM settings. That is expected.
- The FAQ says a QoreChain EVM setting that knows the PQC precompiles is *planned*. The repo does not record whether it exists yet: check the dashboard's setting list.
- Use the same setting for runs you want to compare. Both committed stages used "Ethereum (EVM/Solidity)".

## Checklist

1. **Confirm the source is current.** From the repo root: `git status` shows no changes under `src/` or `lib/haven-pq-kit/src/`, and `npm run audit:check` prints `12 of 12 finding checks passed`.
2. **Build the paste.** The escrow imports its PQC checks from the vendored kit, so paste the escrow with the code it calls, in this order:
   ```bash
   for f in src/HavenEscrow.sol src/EscrowArgs.sol src/EscrowFactory.sol \
            lib/haven-pq-kit/src/PqAuth.sol lib/haven-pq-kit/src/PqQuorum.sol lib/haven-pq-kit/src/IQorePQC.sol; do
     printf '\n// ===== %s =====\n' "$f"; cat "$f"
   done | pbcopy
   ```
   About 24 KB. `forge-std`'s `IERC20` interface is not needed. If the dashboard rejects the length, paste `src/HavenEscrow.sol` alone, which is what both committed stages reviewed, and note that in `docs/AUDIT.md`.
3. **Pick the setting.** If the dashboard now lists a QoreChain EVM/Solidity setting, use it and record its exact name. Otherwise use "Ethereum (EVM/Solidity)" so the result compares with the committed stages.
4. **Run Security Audit, then Export PDF.** Save it as `docs/audit/rerun-<YYYY-MM-DD>.pdf`. Do not overwrite `stage-1-2026-11-21.pdf` or `stage-2-2026-11-21.pdf`.
5. **Read the findings' Location column.** If findings now cite real functions (`release`, `resolve`, `_pay`, `fund`, `sweep`, ...), the auditor read the source; triage each one on its merits. If they again cite `withdraw`, `setFee`, `deposit` or similar, it did not.

## Recording the result

1. **`docs/AUDIT.md`:** add a row to the stage table (report link, generated time from the PDF header, score, risk level, finding count, setting name), then a section with one row per finding: severity, location as printed, and the result: fixed (with commit), regression test (with its name), or false positive and why. Record the score as printed, even if lower.
2. **`scripts/lib/audit-names.ts`:** add each new finding to `FINDINGS` only if it names something that should not exist (a function, role, or pattern). A finding about a function that does exist needs a real answer in `docs/AUDIT.md`, not this check. Then run `npm run audit:check` and `npm run test:ts`; update the `toHaveLength` counts in `test/ts/audit-names.test.ts`.
3. **`README.md`:** update the "Audit score in context" line near the top, the **Two-stage QCAI audit** row of the rubric table, and the "Evidence: two-stage QCAI audit findings" section with the new PDF, date, score, and counts.
4. **`docs/PROJECT_PAGE.md`** and the project page's "How it's made" field: update the one-line audit note.
5. **`apps/web/components/questions.tsx`:** update the QCAI question if the score or finding counts changed.
