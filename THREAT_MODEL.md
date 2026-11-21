# Threat model

The scenes below ran on qorechain-diana on 20 November 2026. The hashes are in `deployments/`. `npm run evidence` re-checks them. This file is not a substitute for that command.

## What is protected

The client and the freelancer are fixed when the escrow is created. A payment can go only to one of those two. Every release, delivery, dispute, cancellation and arbiter ruling needs a fresh ML-DSA-87 signature over the chain, the escrow, the signer, the action, the nonce, the deadline and the milestone arguments. A review timeout can release to the freelancer without a new signature, and an arbiter timeout can apply the split both parties accepted at creation. The file itself is not stored on chain. The client can open it. Any two arbiters can open it together. One arbiter cannot.

## Who it protects against

A thief who holds only a party's secp256k1 key. That key cannot open an EVM window, and it cannot produce the ML-DSA-87 signature the contract checks.

A relayer. The relayer can submit a signed call, and can refuse to submit one. The relayer cannot change the milestone, the amount, the split, or the recipient.

A single arbiter. One arbiter is short of the 2-of-3 threshold, and one sealed share is not enough to read the file.

A client who disputes in bad faith. The dispute stops automatic release. The split is then whatever two arbiters sign, or the default split if they never sign. Protection here goes only as far as the arbiters are honest.

## Not protected

Two colluding arbiters. They can sign any split they like, and together they can read the file. The chain does not stop them.

A freelancer and a client who both sign a cancellation. That is the parties changing their own deal.

Metadata. Amounts, deadlines, parties and the commitment are public.

A lost file, a lost file key, or a lost arbiter share. The chain cannot reconstruct them.

## What the testnet showed

- **Scene 1.** The client released milestone 0 of escrow A. 1,000,000 fUSD base units went to the freelancer. Spike then submitted the freelancer's delivery of milestone 1. The contract accepted the freelancer's signature. Spike is not a party. Hash `0xfaaf878f74237747f26e6994bd45db51ac457f74b0709ca313e15c98fde4a978`.
- **Scene 2.** With no open window, the client's classical release was refused before broadcast. A classical `MsgOpenEVMWindow` was refused, code 20, hybrid signature required. Inside a window the client had opened, a junk signature and a replayed signature both reverted `SignatureInvalid`. `cancel` of a Delivered milestone reverted `WrongStatus`, because status is checked before the signature. The escrow balance did not change.
- **Scene 3.** One arbiter's `resolve` reverted `TooFew`. Two arbiters signed 7000 bps. The freelancer received 700,000 and the client received 300,000. One sealed share was refused before a transaction. Two shares opened the file. That open is local. It is not a chain receipt.
- **Scene 4.** `autoRelease` during escrow B's 120-second review reverted `TooEarly`. After the chain timestamp passed the review, the same call paid the freelancer 1,000,000 with no new signature.

`resolveTimeout` was not called on testnet. The Foundry tests cover the silent-panel split. The live dispute was settled by two arbiters before that timeout.

The dashboard audit ran twice on 21 November 2026. Both reports are in `docs/audit/`. The mapping is `docs/AUDIT.md`. The PDFs name functions that are not in `HavenEscrow.sol`. That write-up is the response. It is not a claim that an external auditor reviewed the threat model.
