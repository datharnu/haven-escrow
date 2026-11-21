# Haven Escrow

**Funds leave only to the client or the freelancer named when the escrow was created. Every release needs a fresh ML-DSA-87 signature, or a timeout those two parties already accepted.**

Track: Post-Quantum dApp, [Build Before Q-Day](https://build.qorechain.io/). Repository: https://github.com/datharnu/haven-escrow. Licence: Apache-2.0.

Network `qorechain-diana`, EVM chain id 9800. The contracts are on testnet. They are not on mainnet. The fUSD in them is a test token and has no value.

The site in this repository replays the four scenes. It does not send a transaction. The public copy is https://havenesc.vercel.app. There is no film yet. A juror can also re-check the hashes without our keys. Both paths are below.

## Judge it without our keys

1. Read the one rule in the first line, then the four rows in [What was measured](#what-was-measured).
2. Open [docs/AUDIT.md](docs/AUDIT.md). Both dashboard reports are in [docs/audit/](docs/audit/). The score on those PDFs is the auditor's number. The [FAQ](https://build.qorechain.io/faq) says that number is not added into the jury score. The write-up says what we did with each finding.
3. Clone the repo and re-check every recorded hash:

```bash
git clone --recurse-submodules https://github.com/datharnu/haven-escrow
cd haven-escrow
npm ci
npm run evidence
```

`npm run evidence` reads `deployments/*.json` and checks each hash on `qorechain-diana` through `@qorechain/mcp`. It needs no key. On 20 November 2026, after the four scenes, that command printed 68 passed and 0 failed. Re-run it. A later failure means a recorded hash no longer matches the chain.

`forge test` and `npm run test:ts` need no chain and no key. They use a mock of the precompiles. A passing test is not a testnet receipt.

## Check a signature in the browser

On `/record`, **Verify this step** reads that transaction from `https://evm-testnet.qore.host`. **Verify all** reads every step. The page rebuilds the ML-DSA-87 message the contract builds, reads the signer's key from `pqcKeyStatus`, and checks the 4627-byte signature with `@qorechain/pqc`. It reads `Released` or `Resolved` and the fUSD `Transfer` logs, and compares the recipient with `client()` and `freelancer()` on the contract. A refused call is replayed at the previous block, because the receipt carries no revert bytes. The EVM receipt decides success or revert. The page does not send a transaction and it does not hold a key. A network failure says "Could not reach the testnet" and is never a pass.

What this check does not prove, as of 21 November 2026:

- The two steps with no hash were refused before broadcast. There is nothing on chain to read.
- `autoRelease` has no signature. The page can show the receipt. It cannot show a signature that was not made.
- The scene 2 cancel reverts `WrongStatus` before the signature is read, so the page does not judge that signature.
- It does not call `resolveTimeout`. That call is not in the record.
- It does not check the bytecode against the source. `forge test` and [docs/AUDIT.md](docs/AUDIT.md) are that check.
- It covers the recorded transactions only.

`@qorechain/pqc` 0.2.3 verifies in JavaScript. The page does not add `wasm-unsafe-eval`. The offline test replays a recorded RPC reply, so CI does not call the testnet. `HAVEN_LIVE_VERIFY=1 npm run smoke` is the browser run against the testnet.

## On the web

The site is the Next.js app in `apps/web`. It has no environment variables and it holds no key. Vercel builds it with the project's root directory set to `apps/web`. The install is `npm ci` and the build is `npm run build`. Leave both as the framework defaults. Do not set a root `vercel.json`. The security headers in `apps/web/next.config.ts` are the ones the production server sends, including `connect-src` for `https://evm-testnet.qore.host` only.

The public copy is https://havenesc.vercel.app. Opened on 21 November 2026. **Verify all** on `/record` finished at 390px and at 1440px. The two-arbiter step read both ML-DSA-87 keys, verified both signatures, and matched `Resolved` 700000 to the freelancer and 300000 to the client. Horizontal overflow was 0. No step said "Could not reach the testnet".

## What was measured

All four scenes ran on 20 November 2026. Escrow A is `0xE22ff1Cd5d4B9a496C68FeD4946f2cE1dd8954Bd`. Escrow B is `0xffd1a9375Ab108Ebe0E439574b5e1D7aA050121A`. Amounts are fUSD base units. 1,000,000 is 1 fUSD.

| What was measured | Result | Where |
| --- | --- | --- |
| Client releases milestone 0 after delivery | 1,000,000 fUSD to the freelancer named at creation | `0x2ef9eac1ad5f785e5ac8f984445b8a19977a01e6482ee1032d176cd4bbf1898a` |
| Same classical key, inside a window the real client opened | Junk signature refused `SignatureInvalid`. Replayed milestone-0 signature refused `SignatureInvalid`. Escrow balance unchanged at 1,000,000 | `0x23d8d74315ded0ce5aa1cd19c820ffecfaa164bf1bd3ca32f08b2be81699fd9b`, `0xed3dcf05267a9ecddb4316fb615c5509e3f3e5df879f00d9e3320be389fd75d9` |
| One arbiter, then two | One signature refused `TooFew`. Two of three signed 7000 bps. Freelancer received 700,000. Client received 300,000 | `0x4c3a8a79bb9bc95b0f29a7c2401917f160200f01df994478f36fb384785f5c42`, `0xd1fd4cac9a1565ee665df65d9d5f239e98ec72ec8fc9d25df7ce8099f079a448` |
| Review of 120 seconds on escrow B | `autoRelease` before the review refused `TooEarly`. After the chain timestamp passed it, 1,000,000 went to the freelancer. No new signature | `0xd06ae211608d06ce12fa1810d21e946ce667067794569772e4c9ab7174507d87`, `0xf542a066e48d104fabcde058661775ccb3d3c9c6b538d7b52d97f1bb991cd558` |

> **The contract is the guard.** A relayer can submit a signed call. The call still pays only the client or the freelancer, and only for the milestone and the amount inside the signature.

| What has been observed | Where the boundary is |
| --- | --- |
| A stolen secp256k1 key could not release or open a window | The rehearsal used the client's own classical key, inside a window that account had opened. It is not a stolen third-party key, and it is not a quantum break. The chain refused the signatures |
| A relayer submitted a delivery and was not the signer | Spike submitted the freelancer's `deliver` for milestone 1. Spike's address is not the client, the freelancer, or an arbiter |
| Two arbiters chose 70% to the freelancer | They could have signed any split from 0 to 10000. The chain does not stop two arbiters who agree |
| One share of the file key was not enough to open the file | Refused in the scene-3 script before any transaction. Two shares were enough. The tooling opens them. The chain does not know the file |
| The review timeout paid the freelancer | Escrow B's review was 120 seconds so the scene could wait. Escrow A's review is 1 day. A real job should use a long review. `resolveTimeout` was not called on testnet |

## What the track asks for

The category requirements are the ones published on the [Prizes](https://build.qorechain.io/prizes) page: a scoped EVM window, `pqcVerify`, a two-stage QCAI audit, and Foundry or Hardhat tests. The jury's point weights are not published. This table is a map, not a score.

| Requirement | Where it holds | Limit |
| --- | --- | --- |
| Scoped EVM window | Create, fund, deliver, release, dispute, resolve, and the rehearsal each ran inside a window aimed at one contract. The factory deploy itself used an unscoped window, because a scoped window cannot create a contract from an EOA. Creating an escrow from the factory, inside a window aimed only at the factory, succeeded | The window is opened by the account's ML-DSA-87 key. The contract does not open windows |
| `pqcVerify` | `deliver`, `release`, `dispute`, and `cancel` go through `PqAuth.authorize`. `resolve` goes through `PqQuorum`. Both call `0x…0a01`. The constructor calls `pqcKeyStatus` at `0x…0a02` for all five parties | HavenEscrow does not inline the precompile. The call sits in [haven-pq-kit](https://github.com/datharnu/haven-pq-kit) v0.1.0, which this repo vendors. The automatic checker looks for the address in runtime code. The factory's runtime code embeds the escrow initcode, which contains both addresses |
| Two-stage QCAI audit | [docs/audit/stage-1-2026-11-21.pdf](docs/audit/stage-1-2026-11-21.pdf) and [docs/audit/stage-2-2026-11-21.pdf](docs/audit/stage-2-2026-11-21.pdf), Ethereum (EVM/Solidity), same source. Mapped in [docs/AUDIT.md](docs/AUDIT.md) | Both PDFs score 35/100. Every finding names a function that is not in the source. The contract was not changed to chase the score. Quantum readiness is "Not scored" on this setting, which the FAQ says is expected |
| Foundry tests | `forge test` runs `test/HavenEscrow.t.sol`, `test/HavenEscrow.fuzz.t.sol`, `test/HavenEscrow.invariant.t.sol`, `test/EscrowFactory.t.sol`, and `test/Vectors.t.sol` | The mock signatures are keccak MACs of length 4627. They are not ML-DSA. Live signatures are only in the scene scripts |
| Public repo, README, Apache-2.0 | This file and [LICENSE](LICENSE) | The featured image is [docs/featured.png](docs/featured.png), 1200×630. The film has not been recorded. The shot list is [docs/DEMO.md](docs/DEMO.md). The rules also ask for the film on the project page |
| Original work during the fest | Written in November 2026. The payment rule is the same shape as [Meter](https://github.com/datharnu/Meter): a stored line, and no other recipient. The contracts were written for QoreChain | Kits are credited in [Credits](#credits), including the authorization interface |

## Contents

1. [The problem](#the-problem)
2. [The rule](#the-rule)
3. [How a milestone moves](#how-a-milestone-moves)
4. [What this does not claim](#what-this-does-not-claim)
5. [Addresses](#addresses)
6. [Evidence](#evidence)
7. [The audit](#the-audit)
8. [Decisions](#decisions)
9. [Stack](#stack)
10. [Getting started](#getting-started)
11. [Repo map](#repo-map)
12. [What works today](#what-works-today)
13. [Credits](#credits)

## The problem

A client funds a job in stages. The freelancer wants to be paid when a stage is delivered. The client wants the money back if it is not. On an ordinary chain, the key that can send the transaction can also change who is paid. After a classical key is stolen, or after a quantum computer can forge secp256k1, that person is the new recipient.

Haven is the job, not a general vault. Two people are named at creation. The file they are arguing about is encrypted. Two of three arbiters can settle the argument, and the same two can open the file. One cannot.

No client is using this. The runs below are testnet.

## The rule

> **The recipient is one of the two addresses stored at creation. The signature is ML-DSA-87, fresh, over this chain, this escrow, this signer, this action, this nonce, this deadline, and this milestone.**

- **No function takes a recipient.** `release`, `autoRelease`, `refund`, `resolve`, `resolveTimeout`, `cancel`, and `sweep` pay `client` or `freelancer`. Both are immutable.
- **The sender is not the signer.** `msg.sender` is ignored on `deliver`, `release`, `dispute`, `cancel`, and `resolve`. Spike submitted a delivery. The freelancer's signature is what the contract checked.
- **A timeout is a term, not a new decision.** `autoRelease` pays the freelancer after the review, with no new signature. `resolveTimeout` applies `defaultSplitBps`, which was stored at creation. The demo uses 5000. Any rounding remainder goes to the client.
- **The file is not on chain.** The chain stores a commitment. The ciphertext and the sealed envelopes are in `deployments/deliverables/`. Those files contain no file key and no Shamir share in the clear.

The longer list of refusals is [docs/disputes.md](docs/disputes.md). The attacker list is [THREAT_MODEL.md](THREAT_MODEL.md).

## How a milestone moves

```text
Unfunded --> Funded --> Delivered --> Released
                 |          |
                 |          +--> Disputed --> Resolved
                 |
                 +--> Refunded
Unfunded --> Cancelled
Funded   --> Cancelled
```

Released, Resolved, Refunded, and Cancelled are final. Time is the chain's block timestamp. At the exact boundary, the earlier action still works. One second later, it does not.

`cancel` of a Delivered milestone reverts `WrongStatus` before it looks at the signature. That is why the rehearsal's cancel is `WrongStatus` and not `SignatureInvalid`. The check order was left as it is. A Delivered milestone is already past cancel.

`fund` marks milestones in order, up to the token balance. It cannot choose a payee. `sweep` sends a surplus of the same token to the client, and only when nothing is still `Unfunded`.

## What this does not claim

| Claim we do not make | What is true instead |
| --- | --- |
| Two arbiters cannot cheat | They can sign any split, and together they can read the file. The chain does not stop them |
| A dispute proves the work was bad | A dispute stops `autoRelease`. The split is whatever two arbiters sign, or 5000 bps if they never sign |
| The QCAI score is a jury score | Both PDFs say 35/100. The FAQ says jurors read the PDF next to the explanation. [docs/AUDIT.md](docs/AUDIT.md) is that explanation |
| The tests are live ML-DSA | Foundry has no precompiles. `npm run evidence` is the live check |
| Mainnet | `pqcVerify` and `pqcKeyStatus` are on diana. The docs say they are not on mainnet yet |
| A website a juror can click | `apps/web` replays the four scenes and checks the recorded signatures in the browser. `npm run web` serves it at http://localhost:3020. It is not deployed. It sends no transaction |
| The pool bought the fUSD | Pool 2 quoted 178,034 base units for 6 QOR, under the 3.1 fUSD the scenes needed. No swap was sent. The client account claimed the faucet, and `MsgConvertCoin` moved 2 fUSD to escrow A and 1 fUSD to escrow B |
| `resolveTimeout` has a testnet receipt | The function is in the contract and in the Foundry tests. Scene 3 settled before the arbiter timeout |

## Addresses

| What | Address |
| --- | --- |
| EscrowFactory | `0xf30bfc219987E60e849D5cF9e7351b7380eEc09B` |
| Escrow A, two milestones | `0xE22ff1Cd5d4B9a496C68FeD4946f2cE1dd8954Bd` |
| Escrow B, one milestone, 120-second review | `0xffd1a9375Ab108Ebe0E439574b5e1D7aA050121A` |
| fUSD, 6 decimals | `0x97143B771D34ddb9130b807b135Ae675A5a963CA` |
| Client | `qor1hygl6sluskpxj373uyggfev5lzuage4l69zv9q` / `0xB911fD43FC85826947d1E11084e594f8b9D466bf` |
| Freelancer | `qor1f5x5jggqyg8e05rlaf5xztlwwrlsxamy9j2pxw` / `0x4D0D492100220F97d07fEa68612fee70ff037764` |
| Arbiter 1 | `qor12kfhuvhykw7k9fyukaexldjw07d2m9zuu9un4v` / `0x55937e32E4B3Bd62a49CB7726fB64E7f9AAd945C` |
| Arbiter 2 | `qor1qranaxl35r95mue9qyqqffvhytcvdgjg5agc9e` / `0x00fb3E9Bf1A0cb4DF325010004a59722f0c6a248` |
| Arbiter 3 | `qor1lq0x9xwwcnsv79hat5q56ycg8hhvvyr9ymya83` / `0xf81E6299CeC4E0Cf16Fd5D014D13083DeEc61065` |
| Spike, deployer and relayer, not a party | `qor143f0ghn8slqguwez73087dvq8lqnuuukqdu9fl` / `0xaC52f45E6787c08E3B22f45e7f35803Fc13e7396` |
| SpikeTarget, the precompile spike, not the product | `0xe11fe2bb1ad13ab116e0d362b218ef1b2330b1a7` |
| Precompiles | `pqcVerify` `0x0000000000000000000000000000000000000a01`, `pqcKeyStatus` `0x0000000000000000000000000000000000000a02` |

The arbiters are stored in ascending address order: arbiter 2, arbiter 1, arbiter 3. `resolve` requires the same order. The freelancer has no ML-KEM key. The file is not sealed to the freelancer. The client and the three arbiters published ML-KEM-1024 keys. Public cards are in `cards/`.

Explorer links for the native transactions use https://explore.qore.network. The `0x` hashes above are EVM transaction hashes stored in `deployments/`. `npm run evidence` is the check that they landed.

## Evidence

The scene scripts refuse to run again once their report has `ok: true`. Do not re-send them. Re-read them.

### Deploy and fund

| Step | Hash | Note |
| --- | --- | --- |
| Deploy EscrowFactory | `0x3a8fed59201dac842c9c05cae11d72d59d27c8da108964f5206f58b975cac309` | Unscoped window. Gas used 2,624,556. Fee 295,263 uqor. The budget for that window was 354,316, under the 5,000,000 cap |
| Create escrow A | `0x9b7288add82823a392fc667819f33a54ff348b8e0df37bfeeef7468c642fab80` | Same scoped window as B, target the factory only |
| Create escrow B | `0xf4ac289cd80be0c2ac48818b39fddb4eb1118c9ae9bbc805e9111064b99badc2` | Review 120 seconds. Everything else matches A |
| Convert faucet fUSD | `9270876CBEF1759C772B7DA3E77C3D5915F6FF6178A68435D5AFFB067C59FBFF` | 2,000,000 base units to A, 1,000,000 to B. No pool swap |
| Fund A, then B | `0x3030d499ae0f75dd9d22d5aacb1a0dce8540f4c01b92f952a12c7bb7a942cb16`, `0xcdc73b477528d302b38c30830c8e4a35235f174d08eb0b09c195a72481be3929` | One window, targets A and B |

Escrow A: amounts 1,000,000 and 1,000,000, review 86,400 seconds, arbiter timeout 259,200 seconds, `defaultSplitBps` 5000. Escrow B: one milestone of 1,000,000, review 120 seconds, the same timeout and split.

### Scene 1, a normal release

The freelancer delivered milestone 0. The client released it. The freelancer's fUSD balance rose by 1,000,000. Spike then submitted the freelancer's delivery of milestone 1. Spike did not sign it.

| Step | Hash |
| --- | --- |
| Deliver A milestone 0 | `0xd161906d3089aa0590d8bf031852abf611c103f8ccd6d30403e95a192971d9be` |
| Release A milestone 0 | `0x2ef9eac1ad5f785e5ac8f984445b8a19977a01e6482ee1032d176cd4bbf1898a` |
| Spike submits deliver A milestone 1 | `0xfaaf878f74237747f26e6994bd45db51ac457f74b0709ca313e15c98fde4a978` |

The ciphertext is in `deployments/deliverables/`. The file key is not.

### Scene 2, the classical key

No window: the node refused the release before broadcast. Text is in `deployments/scene-2-rehearse.json` under `noWindow`. A classical `MsgOpenEVMWindow` was refused with code 20, `hybrid PQC signature required`. It was not accepted, and no window was closed because none opened.

Inside a window the client had opened, the same classical key was used as the attacker:

| Attempt | Hash | Error |
| --- | --- | --- |
| `release(1)` with a junk signature | `0x23d8d74315ded0ce5aa1cd19c820ffecfaa164bf1bd3ca32f08b2be81699fd9b` | `SignatureInvalid` |
| `release(1)` with the milestone-0 signature | `0xed3dcf05267a9ecddb4316fb615c5509e3f3e5df879f00d9e3320be389fd75d9` | `SignatureInvalid` |
| `cancel(1)` with junk signatures | `0x17fc1668ac8125d0cf5e05fee09875d4fc4578de656baba7ca3673cea86f3b8b` | `WrongStatus` |

A call to a made-up `release(uint256,address)` was an `eth_call` only. It reverted. It was not sent. The escrow's fUSD balance was 1,000,000 before and after. That 1,000,000 was milestone 1, still held. Milestone 0 had already been paid.

### Scene 3, a dispute

The client disputed milestone 1. One arbiter share was refused locally. Two shares opened the same plaintext hash. A `resolve` signed only by arbiter 1 reverted `TooFew`. Arbiter 3 then submitted `resolve(1, 7000)` signed by arbiter 1 and arbiter 2.

| Step | Hash |
| --- | --- |
| Dispute | `0x7d1d63d40abce0ae8007f7277d262f146958e124a6b86ba173ad48510aa6f463` |
| One arbiter | `0x4c3a8a79bb9bc95b0f29a7c2401917f160200f01df994478f36fb384785f5c42` |
| Two arbiters, 7000 bps | `0xd1fd4cac9a1565ee665df65d9d5f239e98ec72ec8fc9d25df7ce8099f079a448` |

Against the balances taken immediately before that resolve: freelancer plus 700,000, client plus 300,000.

### Scene 4, the review timeout

| Step | Hash | Result |
| --- | --- | --- |
| Deliver B | `0x40735fcf9943cd77ff5bd24ab4541ef8f6f92b47107d0fb9e58b803825c8d37f` | Delivered |
| `autoRelease` during the 120 seconds | `0xd06ae211608d06ce12fa1810d21e946ce667067794569772e4c9ab7174507d87` | `TooEarly` |
| `autoRelease` after the chain timestamp passed the review | `0xf542a066e48d104fabcde058661775ccb3d3c9c6b538d7b52d97f1bb991cd558` | 1,000,000 to the freelancer |

The wait was real. The script does not warp time. Equal to `deliveredAt + 120` is still `TooEarly`.

### The precompile spike

`SpikeTarget` at `0xe11fe2bb1ad13ab116e0d362b218ef1b2330b1a7` is not an escrow. Its constructor calls `pqcKeyStatus`. Its `ping` calls `pqcVerify`. Deployment `0xac057fd48140b66e250f248bb0e4035820d8679e1629bdfd42f964cd333ee358`. A replay of that ping reverted `SignatureInvalid` at `0xd5634f54f8673f85fc30db6be66571e283c8e0c247ffaf3d293cfb87551830ac`. A contract created from inside a scoped window succeeded at `0xa0021315f5db9a2fd875749e20412914563fbadc681ab3da3deada90716dc2e0`. The notes are in [docs/spikes.md](docs/spikes.md).

## The audit

Both runs used Ethereum (EVM/Solidity) on the same `HavenEscrow.sol`. Quantum readiness is not scored. That is the setting the FAQ tells Solidity projects to use.

| Stage | File | Generated | Score | Risk on the PDF |
| --- | --- | --- | --- | --- |
| 1 | [docs/audit/stage-1-2026-11-21.pdf](docs/audit/stage-1-2026-11-21.pdf) | 21 November 2026, 09:04 | 35/100 | CRITICAL |
| 2 | [docs/audit/stage-2-2026-11-21.pdf](docs/audit/stage-2-2026-11-21.pdf) | 21 November 2026, 09:22 | 35/100 | HIGH |

Stage 1 names `withdraw`, admin functions, and batch processing. Stage 2 names `withdraw`, `setFee`, `calculateFee`, `deposit`, and `getBalances`. None of those functions are in `src/`. Each row in [docs/AUDIT.md](docs/AUDIT.md) says why, and names the test or the code that covers the real behaviour. The source was not edited between the two runs. The score did not move. Adding those functions to raise the percentage would invent the bug the report imagines, and a `withdraw(address)` would break the rule.

The project-page field "How it's made" should point at `docs/AUDIT.md`.

## Decisions

| Decision | Why | Date |
| --- | --- | --- |
| 5000 bps if the arbiters stay silent | A full refund or a full payment would reward the side that benefits from a silent panel. The remainder of the rounding goes to the client | 20 November 2026 |
| Status is checked before the signature | A Delivered milestone cannot be cancelled. The rehearsal records `WrongStatus`. Reordering the checks to chase `SignatureInvalid` was rejected | 20 November 2026 |
| No clone factory | HavenEscrow is 7,876 bytes and the factory is 11,922, both under the 24,576 limit. `create` uses `new` | Measured at build |
| The relayer has no authority | Spike deploys, funds new accounts, and submits. Spike is not a party and is not an arbiter | Kept through the scenes |
| No pool swap under 6 QOR | The quote was 178,034 base units. The scenes needed 3,100,000. The faucet claim was converted instead | 20 November 2026 |
| Demo review of 120 seconds, product review of 1 day | The short review is so a juror can see `TooEarly` and then the release. A real escrow should use a long review, on the order of 14 days | 20 November 2026 |

## Stack

Solidity 0.8.28, Foundry, optimizer 200 runs, `via_ir`. Fuzz 256 runs. Invariant 64 runs, depth 40. TypeScript on Node 22. viem 2.47.6. `@qorechain/sdk` 0.14.0, `pqc` 0.2.3, `qoreseal` 0.1.0, `qoresign` 0.1.0, `mcp` 0.1.1, `evm` 0.14.0. haven-pq-kit v0.1.0. AES-256-GCM from `@noble/ciphers`. Shamir 2-of-3 from `shamir-secret-sharing` 0.0.4.

The native fee in the scripts is 180,000 uqor and the gas limit is 1,200,000. Those numbers were not lowered. Window budgets: deploy 5,000,000 uqor, a contract call 2,000,000, a resolve 3,000,000. The largest fee in the scenes was the factory deploy, 295,263 uqor.

## Getting started

Node 22 and Foundry.

```bash
git clone --recurse-submodules https://github.com/datharnu/haven-escrow
cd haven-escrow
npm ci
forge test
npm run test:ts
npm run typecheck
npm run evidence
npm run web               # http://localhost:3020, replay only, no wallet
```

The site's own checks:

```bash
cd apps/web
npm ci
npm run typecheck
npm run test:unit         # vectors, and the recorded RPC reply, offline
npm run smoke             # Playwright, production build, at 390 and 1440
```

`npm run deploy`, `npm run fund-client`, `npm run scene:1`, `npm run rehearse`, `npm run scene:3`, and `npm run scene:4` send transactions. Each one throws if its report already has `ok: true`. They read keys from `~/.haven/<name>.env`, mode 0600, which is not in the repository.

`npm run vectors` writes `vectors/escrow.json`. `test/Vectors.t.sol` reads it. `npm run cbom:check` fails if a contract reaches ML-DSA other than through the two precompiles, or if it uses `ecrecover`. It also refuses the fixture in `scripts/fixtures/ecrecover/`, which exists so the check can prove it still catches a classical signature. `npm run cbom` writes `cbom.json` and includes the client account. That file is not committed.

## Repo map

| Path | What it is |
| --- | --- |
| `src/HavenEscrow.sol` | The escrow. Immutable parties. One token. At most 8 milestones |
| `src/EscrowFactory.sol` | `create` deploys one escrow. No clones |
| `src/EscrowArgs.sol` | The creation struct |
| `src/ts/escrow.ts` | Sign a delivery, a release, a dispute, a cancel, a resolve |
| `src/ts/deliverable.ts` | Seal the file to the client. Split the file key 2-of-3 for the arbiters |
| `src/spike/SpikeTarget.sol` | The precompile spike. Not a party to any escrow |
| `test/` | Foundry unit, fuzz, invariant, factory, and byte vectors |
| `test/ts/` | Vitest for the TypeScript signer and the deliverable |
| `apps/web` | The replay and the practice deal. `/` is the rule. `/record` walks the four scenes. `/practice` makes browser identities |
| `scripts/cbom.ts` | QoreScan inventory, plus the precompile and `ecrecover` check |
| `scripts/` | Deploy and the four scenes. They stop once the report is `ok` |
| `deployments/` | The hashes. `npm run evidence` reads these |
| `deployments/deliverables/` | Ciphertext and sealed envelopes. No file key |
| `cards/` | Public ML-KEM cards for the client and the three arbiters |
| `docs/AUDIT.md` | Each audit finding, and what we did with it |
| `docs/disputes.md` | States, deadlines, and the refusal names |
| `docs/qcai.md` | Why the audit is the dashboard, and the FAQ lines we relied on |
| `docs/spikes.md` | The four spike results |
| `THREAT_MODEL.md` | Who the rule stops, and who it does not |
| `vectors/escrow.json` | The signed-message bytes the Solidity test checks |

## What works today

On testnet, as recorded on 20 November 2026:

- A factory and two escrows, funded in fUSD.
- A delivery, a client release, and a relayer submitting someone else's signature.
- A classical key refused, including with no window and with a classical open.
- A dispute, a one-arbiter refusal, and a two-arbiter split paid to the two named parties.
- An early timeout refused, then a timeout release after a real wait.
- An evidence check of the recorded hashes.
- A practice path on testnet, recorded in `deployments/practice.json`. Escrow `0xb0d8Da3B7979120E6877016810D39a792a3Bdf90`. Create, fund, the receipt, and deliver are classical. The zero-signature release reverted. The classical open has no hash. Milestone 0 status is 2 and the escrow holds 100000 fUSD base units. Courier did not carry the file. HavenEscrow does not read DeliveryReceipts.
- Two audit PDFs and the finding map.
- `npm run cbom:check` passed locally on 21 November 2026. It caught the `ecrecover` fixture.
- A GitHub Actions workflow at `.github/workflows/test.yml`. The contract and cryptography job went green on 21 November 2026 (run 44886746463). That run did not include the web smoke job, which is in the workflow now.

Not in the repo yet, and not claimed:

- A bytecode comparison inside the No third name panel. The panel lists the state-changing functions and reads the recorded fUSD transfers. It does not check the bytecode against the source. The Foundry tests and docs/AUDIT.md do.
- The sealed file is on `/record` for scenes 1 and 3. The page recomputes the commitment from the published ciphertext and the three envelopes. It does not open the file, and it does not show a share or the file key. Escrow B's manifest is checked by the unit test and is not on the timeout scene.
- A film. The shot list is [docs/DEMO.md](docs/DEMO.md). The featured image is [docs/featured.png](docs/featured.png). The film itself has not been recorded.
- A testnet call to `resolveTimeout`. The silent-panel path is in Foundry. The live dispute was settled by two arbiters first. The practice page does not call it.
- Source verification on the explorer. The explorer has none. The compiler settings are in `foundry.toml`.

## Credits

Written during the fest, November 2026. It builds on:

- **Haven family:** none yet. Steward and Courier use haven-pq-kit. Neither calls this escrow, and this escrow does not call them. [docs/kits.md](docs/kits.md) is the map. [AI_USAGE.md](AI_USAGE.md) says what a person decided.
- **QoreChain kits:** `@qorechain/sdk`, `@qorechain/pqc`, `@qorechain/qoreseal`, `@qorechain/qoresign`, `@qorechain/mcp`, `@qorechain/qorescan`, `@qorechain/evm`, `@qorechain/wallet-adapter`, and `@qorechain/qorex-types`. The last two add the testnet to MetaMask and let QoreX send test QOR. They do not sign a release.
- **haven-pq-kit v0.1.0:** https://github.com/datharnu/haven-pq-kit. `PqAuth` and `PqQuorum` are the signature checks. The submodule is pinned to commit `9fe7ac289f512e39bce6a2d5e31baeb98195519c`. Their interface follows the public design of [qore-pq-kit](https://github.com/Adityaakr/qore-pq-kit) by Adityaakr, Apache-2.0. The implementation was written for Haven.
- **Meter:** the earlier rule that a stored payment line has one recipient. The idea was kept. The contracts were written for this chain.
- **Other libraries:** viem, `@cosmjs/stargate`, `@noble/ciphers`, `@noble/hashes`, `shamir-secret-sharing`, forge-std, Vitest, tsx, and TypeScript.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
