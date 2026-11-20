# Threat model

Draft. Phase 6 adds what the testnet scenes actually proved.

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

The dashboard QCAI audit has not been run. This draft is not that audit.
