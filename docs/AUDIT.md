# Audit

Both reports used the Ethereum (EVM/Solidity) setting on the same source. The PDF headers say blockchain `ethereum`. Quantum readiness is not scored in either. That is expected for this setting.

| Stage | Report | Generated | Score | Risk level | Findings |
| --- | --- | --- | --- | --- | --- |
| 1 | [stage-1-2026-11-21.pdf](audit/stage-1-2026-11-21.pdf) | 21 November 2026, 09:04 | 35/100 | CRITICAL | 6 |
| 2 | [stage-2-2026-11-21.pdf](audit/stage-2-2026-11-21.pdf) | 21 November 2026, 09:22 | 35/100 | HIGH | 6 |

The scores are the auditor's own numbers.

All 12 findings are false positives. 8 name a function that does not exist in `src/` (`withdraw` four times, `setFee`, `calculateFee`, `deposit`, `getBalances`). The other 4, all in Stage 1, name a category instead of a function (admin, balance-update, transfer, and batch functions); each is answered below.

To re-check all 12 against `src/`, the vendored `lib/haven-pq-kit/src/`, and the shipped HavenEscrow ABI (no chain, no keys):

```bash
npm run audit:check
```

It prints PASS or FAIL per finding and exits 1 if any cited function name appears, as any identifier in any case. For the 4 category findings it checks: no owner, admin, or setter; no balance or batch function and no `unchecked` block; exactly one external call, with its return value checked; `MAX_MILESTONES = 8`. `test/ts/audit-names.test.ts` runs the same check in `npm run test:ts` and plants a `withdraw`, a `setFee`, and an `owner` in a fake source to show the check catches them.

The Stage 1 report names functions that are not in `HavenEscrow.sol`: `withdraw`, `admin`, balance-update helpers, and batch processing. A search of `src/` finds none of those names, and no `onlyOwner` or `SafeMath`. Each finding below is a false positive for that reason. The contract was not changed to chase them.

## Where the PQC checks are

`HavenEscrow` does not call the precompiles itself. It uses `PqAuth` and `PqQuorum` from haven-pq-kit.

- Key status, `0x0000000000000000000000000000000000000a02`. `PqAuth.init` loads the registered ML-DSA-87 key. The constructor calls it for the client, the freelancer, and each of the three arbiters. A missing key, the wrong algorithm, or an unproven key reverts the deployment.
- Signature check, `0x0000000000000000000000000000000000000a01`. `PqAuth.authorize` verifies one ML-DSA-87 signature. `deliver`, `release`, `dispute`, and `cancel` use it. `resolve` uses `PqQuorum`, which verifies two signatures over the same action. The transaction sender is never treated as the signer.

What that protects: a release, a delivery, a dispute, a cancel, and a resolution are refused without a fresh signature from the named party or from two arbiters. A stolen secp256k1 key cannot produce one. The rehearsal on testnet recorded that refusal.

Tests: `test/HavenEscrow.t.sol` covers the stolen-classical-key cases, `SignatureInvalid`, `TooFew`, and `WrongStatus`. `test/Vectors.t.sol` checks the signed message bytes.

## Stage 1 findings

| Finding | Severity | Auditor location | Result |
| --- | --- | --- | --- |
| Reentrancy in `withdraw` | CRITICAL | `HavenEscrow.sol` `withdraw` | False positive. There is no `withdraw`. The only low-level call is `_pay`, which sends the stored token to the client or the freelancer. `paidToClient` or `paidToFreelancer` is updated before that call. Every state-changing function uses the `lock` modifier, which reverts with `Reentrancy` if `entered` is already set. |
| Missing access control on admin functions | HIGH | `HavenEscrow.sol` admin functions | False positive. There is no admin, owner, or upgrade role. `fund`, `autoRelease`, `refund`, `resolveTimeout`, and `sweep` are callable by anyone because none of them can choose a recipient. `deliver`, `release`, `dispute`, `cancel`, and `resolve` ignore `msg.sender` and check an ML-DSA signature instead. |
| Integer overflow in balance calculations | HIGH | balance update functions | False positive. There is no separate balance-update function. The file is `pragma solidity 0.8.28`, so an overflowing addition or subtraction reverts. `held` sums at most 8 milestone amounts. |
| Unchecked external call return values | MEDIUM | transfer functions | False positive. `_pay` is the only external call. It reverts with `TransferFailed` when the call fails, or when the returned data is present and is not `true`. |
| Front-running in the withdrawal process | MEDIUM | `withdraw` | False positive. There is no withdrawal function to front-run. Paying out requires a signature over the milestone and the amount, or a timeout whose split was fixed when the escrow was created. |
| Unbounded loop in batch operations | LOW | batch processing functions | False positive. There is no batch function. `fund`, `sweep`, and `held` walk the milestone array. The constructor rejects more than 8 milestones (`MAX_MILESTONES`). |

## Stage 2 findings

Stage 2 ran on the same source, because no Stage 1 finding required a contract change. It again names functions that are not in `src/`: `withdraw`, `setFee`, `calculateFee`, `deposit`, and `getBalances`. A search of `src/` for those names, for `fee`, and for `.transfer(` and `.send(` finds nothing. HavenEscrow holds an ERC-20 token, not ETH, and charges no fee.

| Finding | Severity | Auditor location | Result |
| --- | --- | --- | --- |
| Reentrancy in `withdraw` | CRITICAL | `withdraw` | False positive, same as Stage 1. No `withdraw`; `_pay` runs under `lock` after the paid counter is updated. |
| Missing access control on `setFee` | HIGH | `setFee` | False positive. There is no fee and no setter. Every term is an immutable set in the constructor. |
| Integer overflow in `calculateFee` | HIGH | `calculateFee` | False positive. There is no fee calculation. The only percentage is `amount * splitBps / 10000` in `_settle`, with `splitBps` capped at 10000 and checked arithmetic from Solidity 0.8.28. |
| Unchecked ETH transfer return value | MEDIUM | `withdraw` | False positive. No ETH is sent. `_pay` checks the token call and reverts with `TransferFailed`. |
| Front-running in `deposit` | MEDIUM | `deposit` | False positive. There is no `deposit`. Tokens arrive by plain transfer; `fund()` only marks milestones that the balance covers, in order, and cannot change who is paid. |
| Unbounded loop in `getBalances` | LOW | `getBalances` | False positive. There is no `getBalances`. `held` loops over at most 8 milestones. |

Neither report named a finding that applies to the pasted source, so the score did not move.

## HavenEscrowV2

Both PDFs were run on `src/HavenEscrow.sol` before `src/HavenEscrowV2.sol` existed. The QCAI dashboard has not been run on V2. `HavenEscrowV2` is a copy of `HavenEscrow` with these changes, and nothing else (`diff src/HavenEscrow.sol src/HavenEscrowV2.sol` shows them):

- Two immutables set in the constructor: `receipts` (zero address refused; `EscrowFactoryV2` passes the address it was deployed with and refuses an address with no code) and `receivedSplitBps` (a new `Terms` field, refused above 10000 with `BadSplit`).
- One milestone field, `receivedAt`.
- One function, `acknowledge(m, conversationId, counter, parts)`: status must be `Delivered` or `Disputed` and `receivedAt` zero; `keccak256(abi.encode(address(this), m, parts))` must equal the stored commitment; `IDeliveryReceipts(receipts).receipt(conversationId, counter, commitment, client)` must return a non-zero `recordedAt`. It has the `lock` modifier, takes no recipient, and changes no timing.
- `resolveTimeout` pays `receivedSplitBps` when `receivedAt != 0`, otherwise `defaultSplitBps`. `deliver`, `release`, `autoRelease`, `dispute`, `refund`, `resolve`, `cancel`, and `sweep` are unchanged.

The new external call is a `view` (`STATICCALL`) to the fixed `DeliveryReceipts`, so it cannot change state or re-enter. `npm run audit:check` holds the V2 files to the same 12 checks: none of the cited names in `src/` or in either shipped ABI, no owner or admin, no `unchecked`, one low-level call per escrow (`_pay`, return value checked), and no other external call except the token `balanceOf` read and the `DeliveryReceipts.receipt` read. Tests: `test/HavenEscrowV2.t.sol`, `test/HavenEscrowV2.fuzz.t.sol`, and `test/HavenEscrowV2.invariant.t.sol`, run against `test/courier/DeliveryReceipts.sol`, a copy of Courier's contract.
