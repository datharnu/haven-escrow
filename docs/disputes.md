# Disputes

## Who the parties are

An escrow has a client, a freelancer, and three arbiters. Two of the three arbiters can decide a dispute. Each of the five accounts has a registered ML-DSA-87 key at the moment the escrow is created. The client and the freelancer are fixed in the contract. No function takes a recipient address.

## Milestone states

```text
Unfunded --> Funded --> Delivered --> Released
                 |          |
                 |          +--> Disputed --> Resolved
                 |
                 +--> Refunded
Unfunded --> Cancelled
Funded   --> Cancelled
```

Released, Resolved, Refunded and Cancelled are final.

## Timing

Time is the chain's block timestamp.

- deliver is allowed while `now <= deadline` and the milestone is Funded.
- refund is allowed when `now > deadline` and the milestone is still Funded.
- dispute is allowed while `now <= deliveredAt + reviewPeriod` and the milestone is Delivered.
- autoRelease is allowed when `now > deliveredAt + reviewPeriod` and the milestone is Delivered.
- resolveTimeout is allowed when `now > disputedAt + arbiterTimeout` and the milestone is Disputed.

The second of the boundary belongs to the earlier action. At `deadline`, deliver still works and refund does not. One second later, refund works and deliver does not. The same rule applies to `deliveredAt + reviewPeriod` and `disputedAt + arbiterTimeout`.

## How a dispute is decided

Either the client or the freelancer can dispute, with their own fresh ML-DSA-87 signature, during the review period. Two of the three arbiters then sign one split, in basis points, at the shared arbiter nonce. The freelancer receives `amount * splitBps / 10000`, rounded down. The client receives the remainder. `splitBps` cannot be above 10000.

## If the arbiters never decide

Approved 20 November 2026: half each.

If the arbiters do not sign a split, then after `arbiterTimeout` anyone can apply `defaultSplitBps`. That number is a term both parties accepted when the escrow was created. The demo uses 5000, so each party receives half, with any rounding remainder going to the client. A full refund or a full payment would reward the side that benefits from a silent panel.

## Sealed deliverables

The file is encrypted with a random 32-byte file key using AES-256-GCM. That file key is sealed with QoreSeal to the client's ML-KEM-1024 key. The same file key is split 2-of-3 with Shamir, and each share is sealed to one arbiter. The chain stores only a commitment to the ciphertext and the sealed envelopes.

No single arbiter can read the file. Any two arbiters together can read it at any time. The chain does not stop them. The arbiter tooling opens shares only after the dispute is on chain. The client can read the file as soon as it is delivered.

## What the chain refuses

Creation refuses `ZeroAddress`, `SameParty`, `PartyIsArbiter`, `BadMilestoneCount`, `EscrowLengthMismatch`, `ZeroAmount`, `BadDeadline`, `BadPeriod`, `BadSplit`, and `BadArbiterCount`. Arbiters who are not strictly ascending get the kit's `Unsorted`. A party whose ML-DSA-87 key is missing, the wrong algorithm, or without proof of possession gets `KeyNotRegistered`, `WrongAlgorithm`, `PossessionNotProven`, or `BadKeyLength`.

`fund` refuses `NothingToFund`. `sweep` refuses `NothingToSweep`, and `WrongStatus` while any milestone is still `Unfunded`. A bad milestone index is `NoSuchMilestone`. A milestone in the wrong state is `WrongStatus`. Acting before a boundary is `TooEarly`. Acting after a boundary is `TooLate`. A zero commitment is `ZeroCommitment`. A split above 10000 is `BadSplit`. A reentrant call is `Reentrancy`.

Authorisation refuses the kit errors `NotInitialised`, `SignatureInvalid`, `Expired`, `DeadlineTooFar`, `BadMaxTtl`, and `BadSignatureLength`. A quorum that is too small, repeated, unsorted, or includes a non-member refuses `TooFew`, `Unsorted`, `LengthMismatch`, or `NotMember`.

A transfer that does not return success, or true, refuses `TransferFailed`.

No function can name a new recipient. A stolen secp256k1 key does not satisfy any of these signatures.
