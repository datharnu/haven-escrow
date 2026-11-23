# Project page text (build.qorechain.io)

Paste-ready text for the Haven Escrow project page. Every address and hash below is copied from `README.md` and `deployments/*.json`; `npm run evidence` re-checks them on `qorechain-diana`.

## Name

Haven Escrow

## Tagline

Pay a freelancer in milestones without a stolen key being able to redirect the money.

## About

Haven Escrow is a milestone escrow for freelancers in Nigeria and across Africa who are paid by clients abroad. Today that money usually waits on someone else: a platform that can hold a payout or freeze the account, a card payment the client can charge back after delivery, a cross-border transfer that can take days. Haven Escrow holds each milestone in a contract on QoreChain with no owner, admin, or upgrade key; after delivery the client cannot refund alone, and a release is one transaction to the address fixed at creation. It does not convert tokens to naira or any other currency.

The rules: funds can only ever reach the two names fixed at creation: no function accepts a recipient address. `msg.sender` carries no authority, so a stolen secp256k1 key or a rogue relayer cannot release or redirect anything. Delivery, release, dispute, and cancel each need a fresh ML-DSA-87 signature checked on chain by `pqcVerify`. Disputes settle by a 2-of-3 arbiter ML-DSA-87 quorum at any basis-point split, with a pre-agreed split if the arbiters stay silent. A review timeout pays the freelancer if the client goes silent. In `HavenEscrowV2`, the client can't pretend they never got the work: their own ML-DSA-87 receipt on chain turns a stalling dispute into a full payout to the freelancer if the arbiters stay silent. The receipt is signed by the client's device, stored on Courier's `DeliveryReceipts` (which checks it with `pqcVerify`), and recorded on the escrow by anyone; it proves the client's device signed for the sealed file, not that the work is good, and two arbiters can still sign any split. The deliverable is encrypted, its key sealed with ML-KEM-1024 and Shamir-split 2-of-3 across the arbiters; only a hash is on chain. On Diana testnet, five classical-key attacks moved 0 fUSD. 102 Foundry tests, including fuzz and invariants (41 of them for `HavenEscrowV2`). On Escrow D, a client who had receipted the file and then disputed and went silent saw the silent-panel timeout pay the freelancer 100%.

## Links

- Demo: https://havenesc.vercel.app
- Replay and live signature check (no wallet): https://havenesc.vercel.app/record
- Repository: https://github.com/datharnu/haven-escrow (Apache-2.0)
- Video: not recorded yet. Add the link here once it exists.

## Contract addresses (`qorechain-diana`, EVM chain ID 9800)

| Contract | Address |
| --- | --- |
| `EscrowFactory` | `0xf30bfc219987E60e849D5cF9e7351b7380eEc09B` |
| Escrow A (two milestones, 1-day review) | `0xE22ff1Cd5d4B9a496C68FeD4946f2cE1dd8954Bd` |
| Escrow B (one milestone, 120-second review) | `0xffd1a9375Ab108Ebe0E439574b5e1D7aA050121A` |
| Escrow C (60-second arbiter timeout) | `0xB4410fcC2348212e22c10c1ed302f17225F6F49b` |
| Courier-carry escrow | `0x14312980702C0e2c9b85f3478ba9396e59054706` |
| `DeliveryReceipts` | `0x06b52afc4a151b0efa260e2adcdf2d477632cb56` |
| `EscrowFactoryV2` (delivery receipt gate) | `0x9b6b91f20C6Fbb198d2c84000a7d5854c1F72856` |
| Escrow D (`HavenEscrowV2`) | `0x5f355a9fefc20D13FA99588a70Aa0de635C669da` |
| fUSD (test ERC-20, 6 decimals) | `0x97143B771D34ddb9130b807b135Ae675A5a963CA` |
| PQC precompiles | `pqcVerify` `0x0000000000000000000000000000000000000a01`, `pqcKeyStatus` `0x0000000000000000000000000000000000000a02` |

## Key transactions

| What happened | Transaction |
| --- | --- |
| Client's ML-DSA-87 release paid 1.000000 fUSD to the named freelancer (Escrow A, milestone 0) | [`0x2ef9eac1…1898a`](https://explore.qore.network/tx/0x2ef9eac1ad5f785e5ac8f984445b8a19977a01e6482ee1032d176cd4bbf1898a) |
| Client's classical key sent a junk signature inside an open window: reverted `SignatureInvalid`, 0 fUSD moved | [`0x23d8d743…9fd9b`](https://explore.qore.network/tx/0x23d8d74315ded0ce5aa1cd19c820ffecfaa164bf1bd3ca32f08b2be81699fd9b) |
| Two of three arbiters signed a 70/30 split: 0.700000 fUSD to freelancer, 0.300000 fUSD to client | [`0xd1fd4cac…9a448`](https://explore.qore.network/tx/0xd1fd4cac9a1565ee665df65d9d5f239e98ec72ec8fc9d25df7ce8099f079a448) |
| `autoRelease` after the 120-second review paid 1.000000 fUSD with no new signature (Escrow B) | [`0xf542a066…1cd558`](https://explore.qore.network/tx/0xf542a066e48d104fabcde058661775ccb3d3c9c6b538d7b52d97f1bb991cd558) |
| Silent arbiters: `resolveTimeout` applied the 5000 bps split agreed at creation (Escrow C) | [`0xfab97156…c78e6`](https://explore.qore.network/tx/0xfab97156407bc608077a8c2187f5159a094084e105834b91bdb9188ec34c78e6) |
| A receipt naming the client but signed by Courier's Carol: refused `SignatureInvalid` by `DeliveryReceipts` | [`0xf5339018…b97962`](https://explore.qore.network/tx/0xf5339018b71e1fb29d60d660fc47dea32eed5d90d81dd570031055342cb97962) |
| `acknowledge` with Carol's own receipt for the same file: refused `NoReceipt`, Escrow D | [`0x455743ae…ae6e89`](https://explore.qore.network/tx/0x455743ae0c08b4adb932fb80c6013d057fe1d9e32726e30419ea1ff9b5ae6e89) |
| `acknowledge` recorded the client's own receipt after the client disputed, Escrow D | [`0xd797ce77…d1ffce`](https://explore.qore.network/tx/0xd797ce77247c9236583cdee24fc09402cb609118dd6c51a9b7395d10c0d1ffce) |
| Silent panel: `resolveTimeout` paid the freelancer 100,000 fUSD base units and the client 0 (`receivedSplitBps` 10000), Escrow D | [`0xd9c87de7…074d93`](https://explore.qore.network/tx/0xd9c87de7ebc5c70a6b9d298b0f4b889d63f4b292182fc001963803fec5074d93) |

The explorer root `https://explore.qore.network` is the one the README documents. The `/tx/<hash>` path answered HTTP 200 on 23 November 2026, but the page renders in the browser; if a hash does not show, paste it into the explorer search, or open `/record` and click **Verify all**.

## How it's made (audit line)

Two-stage QCAI audit (Ethereum EVM/Solidity setting) in `docs/audit/`, mapped in `docs/AUDIT.md`: both score 35/100, and all 12 findings are false positives (8 name functions that don't exist in `src/`, e.g. `withdraw`, `setFee`); `npm run audit:check` re-checks all 12 against the source.
