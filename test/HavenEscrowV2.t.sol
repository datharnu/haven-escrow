// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {PqAuth} from "haven-pq-kit/PqAuth.sol";
import {PqTestKeys} from "haven-pq-kit-test/PqTestKeys.sol";
import {HavenEscrow} from "../src/HavenEscrow.sol";
import {HavenEscrowV2} from "../src/HavenEscrowV2.sol";
import {EscrowFactoryV2} from "../src/EscrowFactoryV2.sol";
import {Actors} from "./Actors.sol";
import {FixtureV2} from "./FixtureV2.sol";

contract HavenEscrowV2Test is FixtureV2 {
    uint256 internal constant REVIEW = 3 days;

    // ---------------------------------------------------------------- creation

    function test_create_refusesZeroReceipts() public {
        HavenEscrowV2.Terms memory t = _v2Terms(_one(1, uint64(block.timestamp + 1 days)));
        vm.expectRevert(HavenEscrowV2.ZeroAddress.selector);
        new HavenEscrowV2(t, address(0));
    }

    function test_create_keepsV1Checks() public {
        HavenEscrowV2.Terms memory t = _v2Terms(_one(1, uint64(block.timestamp + 1 days)));
        t.arbiters[2] = Actors.CLIENT;
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.PartyIsArbiter.selector, Actors.CLIENT));
        new HavenEscrowV2(t, address(receipts));
    }

    function test_create_refusesReceivedSplitAbove10000() public {
        HavenEscrowV2.Terms memory t = _v2Terms(_one(1, uint64(block.timestamp + 1 days)));
        t.receivedSplitBps = 10001;
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.BadSplit.selector, uint16(10001)));
        new HavenEscrowV2(t, address(receipts));
    }

    function test_factory_refusesReceiptsWithoutCode() public {
        vm.expectRevert(abi.encodeWithSelector(EscrowFactoryV2.NoReceiptsCode.selector, address(0xBEEF)));
        new EscrowFactoryV2(address(0xBEEF));
    }

    function test_factory_pinsReceiptsAndRecordsTerms() public {
        EscrowFactoryV2 factory = new EscrowFactoryV2(address(receipts));
        HavenEscrowV2.Terms memory t = _v2Terms(_one(1_000_000, uint64(block.timestamp + 7 days)));
        bytes32 termsHash = keccak256(abi.encode(t));
        vm.recordLogs();
        vm.prank(address(0xDEAD));
        address escrow = factory.create(t);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertTrue(factory.isEscrow(escrow));
        assertEq(factory.receipts(), address(receipts));
        assertEq(HavenEscrowV2(escrow).receipts(), address(receipts));
        assertEq(HavenEscrowV2(escrow).client(), Actors.CLIENT);
        assertEq(HavenEscrowV2(escrow).receivedSplitBps(), 10000);
        assertEq(HavenEscrowV2(escrow).defaultSplitBps(), 5000);
        assertEq(logs.length, 1);
        assertEq(logs[0].topics[0], EscrowFactoryV2.EscrowCreated.selector);
        assertEq(abi.decode(logs[0].data, (bytes32)), termsHash);
    }

    // ---------------------------------------------------------------- the gate

    /// @dev With no receipt, V2 times exactly like V1: the review runs from `deliver`.
    function test_timing_matchesV1WithoutReceipt() public {
        HavenEscrowV2 escrow = _v2Many(2, 1_000_000);
        _fundV2(escrow);
        _deliverParts(escrow, 0, _parts("a"));
        _deliverParts(escrow, 1, _parts("b"));
        uint256 at = escrow.milestone(0).deliveredAt + REVIEW;
        vm.warp(at);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.TooEarly.selector, at, at));
        escrow.autoRelease(0);
        _disputeV2(escrow, 1, true);
        vm.warp(at + 1);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.TooLate.selector, at + 1, at));
        escrow.dispute(0, true, block.timestamp + 1 hours, _junk());
        escrow.autoRelease(0);
        assertEq(token.balanceOf(Actors.FREELANCER), 1_000_000);
        assertEq(escrow.milestone(0).receivedAt, 0);
    }

    /// @dev Recording the receipt during review changes no timing.
    function test_acknowledge_duringReview_changesNoTiming() public {
        HavenEscrowV2 escrow = _v2(1_000_000);
        _fundV2(escrow);
        bytes32[5] memory parts = _parts("file");
        bytes32 c = _deliverParts(escrow, 0, parts);
        uint256 at = escrow.milestone(0).deliveredAt + REVIEW;
        vm.warp(block.timestamp + 1 days);
        _clientReceipt(0, c);
        (, uint256 recordedAt) = receipts.receipt(CONVERSATION, 0, c, Actors.CLIENT);
        vm.expectEmit(address(escrow));
        emit HavenEscrowV2.Received(0, CONVERSATION, 0, recordedAt);
        vm.prank(address(0xBAD)); // a relayer with no role
        escrow.acknowledge(0, CONVERSATION, 0, parts);
        assertGt(escrow.milestone(0).receivedAt, 0);
        vm.warp(at);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.TooEarly.selector, at, at));
        escrow.autoRelease(0);
        vm.warp(at + 1);
        escrow.autoRelease(0);
        assertEq(token.balanceOf(Actors.FREELANCER), 1_000_000);
    }

    /// @dev The stalling client: disputes at once, never releases. The receipt turns the silent-panel split into 100%.
    function test_resolveTimeout_paysReceivedSplitWhenReceiptRecordedAfterDispute() public {
        HavenEscrowV2 escrow = _v2(1_000_000);
        _fundV2(escrow);
        bytes32[5] memory parts = _parts("file");
        bytes32 c = _deliverParts(escrow, 0, parts);
        _clientReceipt(0, c);
        _disputeV2(escrow, 0, true);
        vm.warp(block.timestamp + 2 days);
        escrow.acknowledge(0, CONVERSATION, 0, parts);
        uint256 at = escrow.milestone(0).disputedAt + 3 days;
        vm.warp(at);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.TooEarly.selector, at, at));
        escrow.resolveTimeout(0);
        vm.warp(at + 1);
        escrow.resolveTimeout(0);
        assertEq(token.balanceOf(Actors.FREELANCER), 1_000_000);
        assertEq(token.balanceOf(Actors.CLIENT), 0);
        assertEq(uint8(_status(escrow, 0)), uint8(HavenEscrowV2.Status.Resolved));
    }

    function test_resolveTimeout_paysDefaultSplitWithoutReceipt() public {
        HavenEscrowV2 escrow = _v2(1_000_000);
        _fundV2(escrow);
        bytes32[5] memory parts = _parts("file");
        bytes32 c = _deliverParts(escrow, 0, parts);
        _clientReceipt(1, keccak256("another hash")); // a receipt over something else does not count
        _record(STRANGER, STRANGER, 0, c); // nor does one by another key
        _disputeV2(escrow, 0, true);
        vm.warp(block.timestamp + 3 days + 1);
        escrow.resolveTimeout(0);
        assertEq(token.balanceOf(Actors.FREELANCER), 500_000);
        assertEq(token.balanceOf(Actors.CLIENT), 500_000);
    }

    /// @dev Freelancer's own dispute works the same way.
    function test_resolveTimeout_receivedSplitAfterFreelancerDispute() public {
        HavenEscrowV2 escrow = _v2(7);
        _fundV2(escrow);
        bytes32[5] memory parts = _parts("file");
        _clientReceipt(0, _deliverParts(escrow, 0, parts));
        escrow.acknowledge(0, CONVERSATION, 0, parts);
        _disputeV2(escrow, 0, false);
        vm.warp(block.timestamp + 3 days + 1);
        escrow.resolveTimeout(0);
        assertEq(token.balanceOf(Actors.FREELANCER), 7);
    }

    /// @dev The receipt is evidence for the arbiters, not a rule for them: two can still sign any split.
    function test_resolve_unaffectedByReceipt() public {
        HavenEscrowV2 escrow = _v2(1_000_000);
        _fundV2(escrow);
        bytes32[5] memory parts = _parts("file");
        _clientReceipt(0, _deliverParts(escrow, 0, parts));
        _disputeV2(escrow, 0, true);
        escrow.acknowledge(0, CONVERSATION, 0, parts);
        _resolveV2(escrow, 0, 3000);
        assertEq(token.balanceOf(Actors.FREELANCER), 300_000);
        assertEq(token.balanceOf(Actors.CLIENT), 700_000);
    }

    /// @dev Once resolved, a receipt can no longer be recorded, so it cannot change a split after the fact.
    /// Anyone may call `resolveTimeout`, so the receipt has to be recorded before it is.
    function test_acknowledge_tooLateAfterResolution() public {
        HavenEscrowV2 escrow = _v2(1_000_000);
        _fundV2(escrow);
        bytes32[5] memory parts = _parts("file");
        _clientReceipt(0, _deliverParts(escrow, 0, parts));
        _disputeV2(escrow, 0, true);
        vm.warp(block.timestamp + 3 days + 1);
        escrow.resolveTimeout(0);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.WrongStatus.selector, 0, HavenEscrowV2.Status.Resolved));
        escrow.acknowledge(0, CONVERSATION, 0, parts);
        assertEq(token.balanceOf(Actors.FREELANCER), 500_000);
    }

    function test_acknowledge_needsDeliveredOrDisputed() public {
        HavenEscrowV2 escrow = _v2(1);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.WrongStatus.selector, 0, HavenEscrowV2.Status.Unfunded));
        escrow.acknowledge(0, CONVERSATION, 0, _parts("file"));
        _fundV2(escrow);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.WrongStatus.selector, 0, HavenEscrowV2.Status.Funded));
        escrow.acknowledge(0, CONVERSATION, 0, _parts("file"));
        bytes32[5] memory parts = _parts("file");
        bytes32 c = _deliverParts(escrow, 0, parts);
        _clientReceipt(0, c);
        _releaseV2(escrow, 0);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.WrongStatus.selector, 0, HavenEscrowV2.Status.Released));
        escrow.acknowledge(0, CONVERSATION, 0, parts);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.NoSuchMilestone.selector, 1));
        escrow.acknowledge(1, CONVERSATION, 0, parts);
    }

    /// @dev The binding refusals hold while Disputed too.
    function test_acknowledge_refusalsWhileDisputed() public {
        HavenEscrowV2 escrow = _v2(1);
        _fundV2(escrow);
        bytes32[5] memory parts = _parts("file");
        bytes32 c = _deliverParts(escrow, 0, parts);
        _disputeV2(escrow, 0, true);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.NoReceipt.selector, 0));
        escrow.acknowledge(0, CONVERSATION, 0, parts);
        _record(STRANGER, STRANGER, 0, c);
        _clientReceipt(1, parts[0]);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.NoReceipt.selector, 0));
        escrow.acknowledge(0, CONVERSATION, 0, parts);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.NoReceipt.selector, 0));
        escrow.acknowledge(0, CONVERSATION, 1, parts);
        bytes32[5] memory wrong = parts;
        wrong[0] = keccak256("other ciphertext");
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.CommitmentMismatch.selector, 0));
        escrow.acknowledge(0, CONVERSATION, 0, wrong);
    }

    function test_acknowledge_refusesMissingReceipt() public {
        HavenEscrowV2 escrow = _v2(1);
        _fundV2(escrow);
        bytes32[5] memory parts = _parts("file");
        _deliverParts(escrow, 0, parts);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.NoReceipt.selector, 0));
        escrow.acknowledge(0, CONVERSATION, 0, parts);
    }

    /// @dev Courier's usual receipt is over keccak256(ciphertext). That is not the commitment, so it does not count.
    function test_acknowledge_refusesWrongHash() public {
        HavenEscrowV2 escrow = _v2(1);
        _fundV2(escrow);
        bytes32[5] memory parts = _parts("file");
        _deliverParts(escrow, 0, parts);
        _clientReceipt(0, parts[0]);
        _clientReceipt(1, keccak256("something else"));
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.NoReceipt.selector, 0));
        escrow.acknowledge(0, CONVERSATION, 0, parts);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.NoReceipt.selector, 0));
        escrow.acknowledge(0, CONVERSATION, 1, parts);
    }

    function test_acknowledge_refusesReceiptFromAnotherSigner() public {
        HavenEscrowV2 escrow = _v2(1);
        _fundV2(escrow);
        bytes32[5] memory parts = _parts("file");
        bytes32 c = _deliverParts(escrow, 0, parts);
        // Real receipts for the right hash, each signed by its own recipient. None is the client.
        _record(STRANGER, STRANGER, 0, c);
        _record(Actors.FREELANCER, Actors.FREELANCER, 0, c);
        _record(Actors.A0, Actors.A0, 0, c);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.NoReceipt.selector, 0));
        escrow.acknowledge(0, CONVERSATION, 0, parts);
    }

    /// @dev Naming the client while signing with another key never reaches the escrow: Courier refuses to store it.
    function test_receipts_refuseOtherKeyNamingClient() public {
        bytes32 c = keccak256("c");
        bytes memory message = receipts.signingMessage(CONVERSATION, 0, c, Actors.CLIENT);
        bytes memory forged = PqTestKeys.sign(STRANGER, message);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        receipts.record(CONVERSATION, 0, c, Actors.CLIENT, forged);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        receipts.record(CONVERSATION, 0, c, Actors.CLIENT, PqTestKeys.sign(Actors.FREELANCER, message));
    }

    function test_acknowledge_refusesWrongConversationOrCounter() public {
        HavenEscrowV2 escrow = _v2(1);
        _fundV2(escrow);
        bytes32[5] memory parts = _parts("file");
        bytes32 c = _deliverParts(escrow, 0, parts);
        _clientReceipt(7, c);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.NoReceipt.selector, 0));
        escrow.acknowledge(0, CONVERSATION, 0, parts);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.NoReceipt.selector, 0));
        escrow.acknowledge(0, keccak256("other"), 7, parts);
        escrow.acknowledge(0, CONVERSATION, 7, parts);
    }

    function test_acknowledge_refusesPartsThatDoNotOpenTheCommitment() public {
        HavenEscrowV2 escrow = _v2(1);
        _fundV2(escrow);
        bytes32[5] memory parts = _parts("file");
        bytes32 c = _deliverParts(escrow, 0, parts);
        _clientReceipt(0, c);
        bytes32[5] memory wrong = parts;
        wrong[4] = keccak256("swapped arbiter envelope");
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.CommitmentMismatch.selector, 0));
        escrow.acknowledge(0, CONVERSATION, 0, wrong);
    }

    /// @dev A commitment that is not keccak256(this, m, parts) can never be acknowledged. Only a dispute moves it.
    function test_acknowledge_refusesAnUnstructuredCommitment() public {
        HavenEscrowV2 escrow = _v2(1);
        _fundV2(escrow);
        bytes32 raw = keccak256("raw");
        _deliverV2(escrow, 0, raw);
        _clientReceipt(0, raw);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.CommitmentMismatch.selector, 0));
        escrow.acknowledge(0, CONVERSATION, 0, _parts("file"));
    }

    function test_acknowledge_refusesReceiptForAnotherEscrow() public {
        HavenEscrowV2 first = _v2(1);
        HavenEscrowV2 second = _v2(1);
        _fundV2(first);
        _fundV2(second);
        bytes32[5] memory parts = _parts("file");
        bytes32 c1 = _deliverParts(first, 0, parts);
        _clientReceipt(0, c1);
        first.acknowledge(0, CONVERSATION, 0, parts);

        // The freelancer signs the first escrow's commitment on the second escrow and replays the receipt.
        _deliverV2(second, 0, c1);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.CommitmentMismatch.selector, 0));
        second.acknowledge(0, CONVERSATION, 0, parts);
        // The same file committed properly to the second escrow has a different hash, which the client never receipted.
        HavenEscrowV2 third = _v2(1);
        _fundV2(third);
        _deliverParts(third, 0, parts);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.NoReceipt.selector, 0));
        third.acknowledge(0, CONVERSATION, 0, parts);
    }

    function test_acknowledge_refusesReplayAcrossMilestones() public {
        HavenEscrowV2 escrow = _v2Many(2, 1);
        _fundV2(escrow);
        bytes32[5] memory parts = _parts("file");
        bytes32 c0 = _deliverParts(escrow, 0, parts);
        _clientReceipt(0, c0);
        escrow.acknowledge(0, CONVERSATION, 0, parts);

        _deliverV2(escrow, 1, c0);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.CommitmentMismatch.selector, 1));
        escrow.acknowledge(1, CONVERSATION, 0, parts);
        assertEq(escrow.milestone(1).receivedAt, 0);
    }

    function test_acknowledge_sameFileOnMilestoneOneNeedsItsOwnReceipt() public {
        HavenEscrowV2 escrow = _v2Many(2, 1);
        _fundV2(escrow);
        bytes32[5] memory parts = _parts("file");
        bytes32 c0 = _deliverParts(escrow, 0, parts);
        bytes32 c1 = _deliverParts(escrow, 1, parts);
        assertTrue(c0 != c1);
        _clientReceipt(0, c0);
        escrow.acknowledge(0, CONVERSATION, 0, parts);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.NoReceipt.selector, 1));
        escrow.acknowledge(1, CONVERSATION, 0, parts);
        _clientReceipt(1, c1);
        escrow.acknowledge(1, CONVERSATION, 1, parts);
    }

    function test_acknowledge_onlyOnce() public {
        HavenEscrowV2 escrow = _v2(1);
        _fundV2(escrow);
        bytes32[5] memory parts = _parts("file");
        bytes32 c = _deliverParts(escrow, 0, parts);
        _clientReceipt(0, c);
        _clientReceipt(1, c);
        escrow.acknowledge(0, CONVERSATION, 0, parts);
        uint64 first = escrow.milestone(0).receivedAt;
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.AlreadyReceived.selector, 0));
        escrow.acknowledge(0, CONVERSATION, 1, parts);
        assertEq(escrow.milestone(0).receivedAt, first);
    }

    // ---------------------------------------------------------------- the rest is unchanged

    function test_release_byClientNeedsNoReceipt() public {
        HavenEscrowV2 escrow = _v2(1_000_000);
        _fundV2(escrow);
        _deliverParts(escrow, 0, _parts("file"));
        _releaseV2(escrow, 0);
        assertEq(token.balanceOf(Actors.FREELANCER), 1_000_000);
    }

    /// @dev Once the freelancer has delivered, the client cannot take a refund, receipt or no receipt.
    function test_refund_impossibleAfterDelivery() public {
        HavenEscrowV2 escrow = _v2Many(2, 1);
        _fundV2(escrow);
        _deliverParts(escrow, 0, _parts("file"));
        uint256 deadline = escrow.milestone(0).deadline;
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.WrongStatus.selector, 0, HavenEscrowV2.Status.Delivered));
        escrow.refund(0);
        escrow.refund(1);
        assertEq(token.balanceOf(Actors.CLIENT), 1);
    }

    function test_cancelAndSweep_unchanged() public {
        HavenEscrowV2 escrow = _v2Many(2, 10);
        _fundV2(escrow);
        _cancelV2(escrow, 1);
        token.mint(address(escrow), 3);
        escrow.sweep();
        assertEq(token.balanceOf(Actors.CLIENT), 13);
        assertEq(escrow.held(), 10);
    }

    function test_classicalKey_cannotReleaseOrDispute() public {
        HavenEscrowV2 escrow = _v2(1);
        _fundV2(escrow);
        _deliverParts(escrow, 0, _parts("file"));
        vm.startPrank(Actors.CLIENT);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        escrow.release(0, block.timestamp + 1 hours, _junk());
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        escrow.dispute(0, true, block.timestamp + 1 hours, _junk());
        vm.stopPrank();
        assertEq(token.balanceOf(address(escrow)), 1);
    }

    /// @dev The V1 escrow keeps its own rule: the review still runs from `deliveredAt`, with no receipt.
    function test_v1_stillAutoReleasesFromDelivery() public {
        HavenEscrow v1 = _escrow(1_000_000);
        _fundAll(v1);
        _deliver(v1, 0, keccak256("file"));
        vm.warp(block.timestamp + REVIEW + 1);
        v1.autoRelease(0);
        assertEq(token.balanceOf(Actors.FREELANCER), 1_000_000);
    }
}
