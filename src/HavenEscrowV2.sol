// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {PqAuth} from "haven-pq-kit/PqAuth.sol";
import {PqQuorum} from "haven-pq-kit/PqQuorum.sol";
import {EscrowArgs} from "./EscrowArgs.sol";
import {IDeliveryReceipts} from "./IDeliveryReceipts.sol";

/// @notice Milestone escrow. A payment can reach only the client or the freelancer named here.
/// @dev HavenEscrow plus one piece of evidence: the client's own delivery receipt. `acknowledge` records that
/// Courier's `DeliveryReceipts` holds a receipt the client's ML-DSA-87 key signed over a milestone's commitment.
/// If the arbiters stay silent after a dispute, `resolveTimeout` then pays `receivedSplitBps` instead of
/// `defaultSplitBps`. Delivery, review, release, dispute, refund, cancel, and the arbiters' `resolve` are as in V1.
contract HavenEscrowV2 {
    using PqAuth for PqAuth.Signer;
    using PqQuorum for PqQuorum.Set;

    enum Status {
        Unfunded,
        Funded,
        Delivered,
        Released,
        Disputed,
        Resolved,
        Refunded,
        Cancelled
    }

    struct Milestone {
        uint128 amount;
        uint64 deadline;
        uint64 deliveredAt;
        /// @dev When `acknowledge` recorded the client's receipt. 0 if it never did.
        uint64 receivedAt;
        uint64 disputedAt;
        Status status;
        bytes32 commitment;
    }

    struct Terms {
        address client;
        address freelancer;
        address token;
        address[] arbiters;
        uint64 reviewPeriod;
        uint64 arbiterTimeout;
        uint16 defaultSplitBps;
        uint16 receivedSplitBps;
        uint128[] amounts;
        uint64[] deadlines;
    }

    uint256 internal constant MAX_TTL = 1 days;
    uint256 internal constant MAX_MILESTONES = 8;

    address public immutable client;
    address public immutable freelancer;
    address public immutable token;
    uint64 public immutable reviewPeriod;
    uint64 public immutable arbiterTimeout;
    uint16 public immutable defaultSplitBps;
    /// @notice Freelancer share `resolveTimeout` applies when the client's receipt is on record.
    uint16 public immutable receivedSplitBps;
    /// @notice Courier's `DeliveryReceipts`. Fixed at creation. The escrow only reads it.
    address public immutable receipts;

    Milestone[] internal milestones_;
    PqAuth.Signer internal clientAuth;
    PqAuth.Signer internal freelancerAuth;
    PqQuorum.Set internal arbiterSet;

    uint256 public totalFunded;
    uint256 public paidToClient;
    uint256 public paidToFreelancer;
    uint256 private entered;

    error ZeroAddress();
    error SameParty();
    error PartyIsArbiter(address who);
    error BadMilestoneCount(uint256 count);
    error EscrowLengthMismatch();
    error ZeroAmount(uint256 m);
    error BadDeadline(uint256 m);
    error BadPeriod();
    error BadSplit(uint16 splitBps);
    error BadArbiterCount(uint256 count);
    error NothingToFund();
    error NothingToSweep();
    error NoSuchMilestone(uint256 m);
    error WrongStatus(uint256 m, Status status);
    error TooEarly(uint256 now, uint256 at);
    error TooLate(uint256 now, uint256 at);
    error ZeroCommitment();
    error TransferFailed();
    error Reentrancy();
    error CommitmentMismatch(uint256 m);
    error NoReceipt(uint256 m);
    error AlreadyReceived(uint256 m);

    event Funded(uint256 m, uint256 amount);
    event Delivered(uint256 m, bytes32 commitment);
    event Received(uint256 m, bytes32 conversationId, uint256 counter, uint256 recordedAt);
    event Released(uint256 m, uint256 amount, bool automatic);
    event Refunded(uint256 m, uint256 amount);
    event Disputed(uint256 m, bool byClient);
    event Resolved(uint256 m, uint256 toFreelancer, uint256 toClient, bool byTimeout);
    event Cancelled(uint256 m, uint256 refunded);
    event Swept(uint256 amount);

    modifier lock() {
        if (entered != 0) revert Reentrancy();
        entered = 1;
        _;
        entered = 0;
    }

    constructor(Terms memory t, address receipts_) {
        if (t.client == address(0) || t.freelancer == address(0) || t.token == address(0)) revert ZeroAddress();
        if (receipts_ == address(0)) revert ZeroAddress();
        if (t.client == t.freelancer) revert SameParty();
        if (t.arbiters.length != 3) revert BadArbiterCount(t.arbiters.length);
        for (uint256 i = 0; i < 3; i++) {
            if (t.arbiters[i] == t.client || t.arbiters[i] == t.freelancer) revert PartyIsArbiter(t.arbiters[i]);
        }
        if (t.amounts.length != t.deadlines.length) revert EscrowLengthMismatch();
        if (t.amounts.length == 0 || t.amounts.length > MAX_MILESTONES) revert BadMilestoneCount(t.amounts.length);
        for (uint256 i = 0; i < t.amounts.length; i++) {
            if (t.amounts[i] == 0) revert ZeroAmount(i);
            if (t.deadlines[i] <= block.timestamp) revert BadDeadline(i);
            milestones_.push(
                Milestone({
                    amount: t.amounts[i],
                    deadline: t.deadlines[i],
                    deliveredAt: 0,
                    receivedAt: 0,
                    disputedAt: 0,
                    status: Status.Unfunded,
                    commitment: bytes32(0)
                })
            );
        }
        if (t.reviewPeriod < 60 || t.reviewPeriod > 90 days || t.arbiterTimeout < 60 || t.arbiterTimeout > 90 days) {
            revert BadPeriod();
        }
        if (t.defaultSplitBps > 10000) revert BadSplit(t.defaultSplitBps);
        if (t.receivedSplitBps > 10000) revert BadSplit(t.receivedSplitBps);

        client = t.client;
        freelancer = t.freelancer;
        token = t.token;
        reviewPeriod = t.reviewPeriod;
        arbiterTimeout = t.arbiterTimeout;
        defaultSplitBps = t.defaultSplitBps;
        receivedSplitBps = t.receivedSplitBps;
        receipts = receipts_;
        clientAuth.init(t.client);
        freelancerAuth.init(t.freelancer);
        arbiterSet.init(t.arbiters, 2);
    }

    function fund() external lock {
        uint256 free = IERC20(token).balanceOf(address(this)) - held();
        bool changed = false;
        uint256 n = milestones_.length;
        for (uint256 i = 0; i < n; i++) {
            Milestone storage ms = milestones_[i];
            if (ms.status != Status.Unfunded) continue;
            if (free < ms.amount) break;
            free -= ms.amount;
            ms.status = Status.Funded;
            totalFunded += ms.amount;
            changed = true;
            emit Funded(i, ms.amount);
        }
        if (!changed) revert NothingToFund();
    }

    function deliver(uint256 m, bytes32 commitment, uint256 deadline, bytes calldata sig) external lock {
        Milestone storage ms = _at(m);
        if (ms.status != Status.Funded) revert WrongStatus(m, ms.status);
        if (block.timestamp > ms.deadline) revert TooLate(block.timestamp, ms.deadline);
        if (commitment == bytes32(0)) revert ZeroCommitment();
        freelancerAuth.authorize(EscrowArgs.DELIVER, EscrowArgs.deliverArgs(m, commitment), deadline, MAX_TTL, sig);
        ms.status = Status.Delivered;
        ms.deliveredAt = uint64(block.timestamp);
        ms.commitment = commitment;
        emit Delivered(m, commitment);
    }

    /// @notice Records that the client's own device receipted this milestone's file. Changes no timing.
    /// @dev Anyone may call it, while the milestone is Delivered or Disputed; `msg.sender` chooses nothing.
    /// 1. `parts` must open the stored commitment as `keccak256(abi.encode(address(this), m, parts))`, the
    ///    `commitmentOf` layout: ciphertext, client envelope, three arbiter envelopes. A commitment made for
    ///    another escrow or another milestone cannot pass.
    /// 2. `DeliveryReceipts` must hold a receipt whose hash is that commitment and whose recipient is the
    ///    stored `client`. `DeliveryReceipts.record` stored it only after `pqcVerify` accepted the client's
    ///    registered ML-DSA-87 key. A receipt signed by anyone else is stored under that signer's address.
    function acknowledge(uint256 m, bytes32 conversationId, uint256 counter, bytes32[5] calldata parts)
        external
        lock
    {
        Milestone storage ms = _at(m);
        if (ms.status != Status.Delivered && ms.status != Status.Disputed) revert WrongStatus(m, ms.status);
        if (ms.receivedAt != 0) revert AlreadyReceived(m);
        bytes32 commitment = ms.commitment;
        if (keccak256(abi.encode(address(this), m, parts)) != commitment) revert CommitmentMismatch(m);
        (, uint256 recordedAt) = IDeliveryReceipts(receipts).receipt(conversationId, counter, commitment, client);
        if (recordedAt == 0) revert NoReceipt(m);
        ms.receivedAt = uint64(block.timestamp);
        emit Received(m, conversationId, counter, recordedAt);
    }

    function release(uint256 m, uint256 deadline, bytes calldata sig) external lock {
        Milestone storage ms = _at(m);
        if (ms.status != Status.Delivered) revert WrongStatus(m, ms.status);
        uint256 amount = ms.amount;
        clientAuth.authorize(EscrowArgs.RELEASE, EscrowArgs.releaseArgs(m, amount), deadline, MAX_TTL, sig);
        ms.status = Status.Released;
        emit Released(m, amount, false);
        _pay(true, amount);
    }

    function autoRelease(uint256 m) external lock {
        Milestone storage ms = _at(m);
        if (ms.status != Status.Delivered) revert WrongStatus(m, ms.status);
        uint256 at = uint256(ms.deliveredAt) + reviewPeriod;
        if (block.timestamp <= at) revert TooEarly(block.timestamp, at);
        uint256 amount = ms.amount;
        ms.status = Status.Released;
        emit Released(m, amount, true);
        _pay(true, amount);
    }

    function refund(uint256 m) external lock {
        Milestone storage ms = _at(m);
        if (ms.status != Status.Funded) revert WrongStatus(m, ms.status);
        if (block.timestamp <= ms.deadline) revert TooEarly(block.timestamp, ms.deadline);
        uint256 amount = ms.amount;
        ms.status = Status.Refunded;
        emit Refunded(m, amount);
        _pay(false, amount);
    }

    function dispute(uint256 m, bool byClient, uint256 deadline, bytes calldata sig) external lock {
        Milestone storage ms = _at(m);
        if (ms.status != Status.Delivered) revert WrongStatus(m, ms.status);
        uint256 at = uint256(ms.deliveredAt) + reviewPeriod;
        if (block.timestamp > at) revert TooLate(block.timestamp, at);
        PqAuth.Signer storage signer = byClient ? clientAuth : freelancerAuth;
        signer.authorize(EscrowArgs.DISPUTE, EscrowArgs.disputeArgs(m, byClient), deadline, MAX_TTL, sig);
        ms.status = Status.Disputed;
        ms.disputedAt = uint64(block.timestamp);
        emit Disputed(m, byClient);
    }

    function resolve(
        uint256 m,
        uint16 splitBps,
        uint256 deadline,
        address[] calldata who,
        bytes[] calldata sigs
    ) external lock {
        Milestone storage ms = _at(m);
        if (ms.status != Status.Disputed) revert WrongStatus(m, ms.status);
        if (splitBps > 10000) revert BadSplit(splitBps);
        arbiterSet.authorizeQuorum(
            EscrowArgs.RESOLVE, EscrowArgs.resolveArgs(m, splitBps), deadline, MAX_TTL, who, sigs
        );
        _settle(ms, m, splitBps, false);
    }

    function resolveTimeout(uint256 m) external lock {
        Milestone storage ms = _at(m);
        if (ms.status != Status.Disputed) revert WrongStatus(m, ms.status);
        uint256 at = uint256(ms.disputedAt) + arbiterTimeout;
        if (block.timestamp <= at) revert TooEarly(block.timestamp, at);
        _settle(ms, m, ms.receivedAt != 0 ? receivedSplitBps : defaultSplitBps, true);
    }

    function cancel(uint256 m, uint256 deadline, bytes calldata clientSig, bytes calldata freelancerSig) external lock {
        Milestone storage ms = _at(m);
        if (ms.status != Status.Unfunded && ms.status != Status.Funded) revert WrongStatus(m, ms.status);
        bytes32 args = EscrowArgs.cancelArgs(m);
        clientAuth.authorize(EscrowArgs.CANCEL, args, deadline, MAX_TTL, clientSig);
        freelancerAuth.authorize(EscrowArgs.CANCEL, args, deadline, MAX_TTL, freelancerSig);
        uint256 refunded = ms.status == Status.Funded ? ms.amount : 0;
        ms.status = Status.Cancelled;
        emit Cancelled(m, refunded);
        if (refunded != 0) _pay(false, refunded);
    }

    function sweep() external lock {
        uint256 n = milestones_.length;
        for (uint256 i = 0; i < n; i++) {
            if (milestones_[i].status == Status.Unfunded) revert WrongStatus(i, Status.Unfunded);
        }
        uint256 surplus = IERC20(token).balanceOf(address(this)) - held();
        if (surplus == 0) revert NothingToSweep();
        emit Swept(surplus);
        _pay(false, surplus);
    }

    function milestoneCount() external view returns (uint256) {
        return milestones_.length;
    }

    function milestone(uint256 m) external view returns (Milestone memory) {
        return _at(m);
    }

    function nonces() external view returns (uint256 clientNonce, uint256 freelancerNonce, uint256 arbiterNonce) {
        return (clientAuth.nonce, freelancerAuth.nonce, arbiterSet.nonce);
    }

    function arbiters() external view returns (address[] memory) {
        return arbiterSet.members;
    }

    function held() public view returns (uint256 sum) {
        uint256 n = milestones_.length;
        for (uint256 i = 0; i < n; i++) {
            Status status = milestones_[i].status;
            if (status == Status.Funded || status == Status.Delivered || status == Status.Disputed) {
                sum += milestones_[i].amount;
            }
        }
    }

    function _settle(Milestone storage ms, uint256 m, uint16 splitBps, bool byTimeout) internal {
        uint256 amount = ms.amount;
        uint256 freelancerShare = amount * splitBps / 10000;
        uint256 clientShare = amount - freelancerShare;
        ms.status = Status.Resolved;
        emit Resolved(m, freelancerShare, clientShare, byTimeout);
        if (freelancerShare != 0) _pay(true, freelancerShare);
        if (clientShare != 0) _pay(false, clientShare);
    }

    /// @dev The only low-level call in this file. `toFreelancer` picks one of the two named parties.
    function _pay(bool toFreelancer, uint256 amount) internal {
        if (toFreelancer) paidToFreelancer += amount;
        else paidToClient += amount;
        (bool ok, bytes memory ret) = token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, toFreelancer ? freelancer : client, amount)
        );
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }

    function _at(uint256 m) internal view returns (Milestone storage ms) {
        if (m >= milestones_.length) revert NoSuchMilestone(m);
        return milestones_[m];
    }
}
