# QCAI audit

The Post-Quantum dApp track asks for a two-stage QCAI audit. QCAI here is the Contract Auditor on the QoreChain dashboard, not the AI precompiles. Those precompiles (`0x…0b01`, `0x…0b02`) are not active on testnet or mainnet, and this audit does not call them.

## Where this comes from

Builder FAQ, "QCAI audit (Post-Quantum dApp track)", read 20 November 2026:

https://build.qorechain.io/faq

Quoted:

> Which audit setting should I use for QoreChain EVM (Solidity) contracts?
> An EVM/Solidity setting, for example "Ethereum (EVM/Solidity)". The "QoreChain (CosmWasm + PQC)" setting is for CosmWasm contracts. On Solidity it reports a "mismatch", which is not a finding about your contract.
>
> Why do I see "Not scored" for quantum readiness?
> The readiness rating is only produced by the CosmWasm setting today, so EVM settings show "Not scored". That is expected and does not count against you. A QoreChain EVM setting that knows the PQC precompiles is planned. Meanwhile, explain your PQC design in `docs/AUDIT.md`: where you call pqcVerify or pqcKeyStatus, what each call protects, and which tests cover it.
>
> What counts as Stage 2?
> A second QCAI run after you have worked through every Stage 1 finding. Fixing a finding, adding a regression test for it, or documenting why it is a false positive or does not need a contract change are all valid ways to work through it. Zero findings is not required.
>
> My Stage 2 score is lower than Stage 1. Is that bad?
> Not by itself. The audit score is not fed into judging automatically. Jurors score by hand and read the reports together with your explanations.
>
> Is there a submission field for the audit?
> No. Put it in your repo:
> - `docs/audit/` with both reports (PDF), each with its date;
> - `docs/AUDIT.md` mapping each Stage 1 finding to what you did (fixed, regression test with its name, or false positive and why), or a link to your public audit response;
> - one line in your README and in the "How it's made" field of your project page pointing to it.
> Use the same audit setting for both stages so the reports can be compared.

The tool itself is described at https://docs.qorechain.io/dashboard/contract-auditor/ . It runs at https://dashboard.qorechain.io/audit . Sign-in is required. The first audit each UTC day is free. Export PDF saves the report. The auditor reviews only the source that is pasted. It does not compile or test.

## Stage 1

Input: the Solidity source of HavenEscrow and EscrowFactory, pasted into the auditor. Setting: "Ethereum (EVM/Solidity)". Do not use "QoreChain (CosmWasm + PQC)".

Output: the PDF report, saved as `docs/audit/stage-1-<date>.pdf`, plus `docs/AUDIT.md` explaining where the contracts call `pqcVerify` and `pqcKeyStatus`, what each call protects, and which tests cover it. "Not scored" for quantum readiness is expected and is recorded as such.

This stage cannot run until those contracts exist. The dashboard also needs a signed-in person to press Run Security Audit and export the PDF. No score will be invented.

## Stage 2

Input: the same source after every Stage 1 finding has been fixed, covered by a named regression test, or written up as a false positive that does not need a contract change.

Output: a second PDF from the same "Ethereum (EVM/Solidity)" setting, saved as `docs/audit/stage-2-<date>.pdf`. `docs/AUDIT.md` maps each Stage 1 finding to fixed, regression test name, or false positive and why. A lower score is recorded, not hidden. Zero findings is not required.

## Other places searched

- https://docs.qorechain.io/dashboard/contract-auditor/ describes the same dashboard auditor. It does not add a second procedure.
- https://docs.qorechain.io/developer-guide/evm-precompiles/ says the AI precompiles are not active. They are not the audit.
- `@qorechain/mcp` 0.1.1 tools, read from `node_modules`: `get_address_info`, `get_block`, `get_chain_info`, `simulate_tx`, `estimate_fee`, `prepare_transfer`, `get_pq_status`, `read_contract`, `get_transaction`, `get_validators`, `search`, `get_staking_tiers`, `get_token_holders`, `request_faucet`. None of them runs a QCAI audit.
- `@qorechain/sdk` exposes `/qorechain/ai/v1/stats` and `/qorechain/ai/v1/fee-estimate`. Those are fee and network stats, not a contract audit.
