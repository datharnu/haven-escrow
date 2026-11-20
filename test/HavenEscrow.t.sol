// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {PqAuth} from "haven-pq-kit/PqAuth.sol";
import {PqQuorum} from "haven-pq-kit/PqQuorum.sol";
import {PqTestKeys} from "haven-pq-kit-test/PqTestKeys.sol";
import {HavenEscrow} from "../src/HavenEscrow.sol";
import {EscrowArgs} from "../src/EscrowArgs.sol";
import {Actors} from "./Actors.sol";
import {Fixture} from "./Fixture.sol";

contract HavenEscrowTest is Fixture {
    function test_create_refusesUnregisteredClient() public {
        HavenEscrow.Terms memory t = _one(1, _future());
        t.client = address(0xC999);
        vm.expectRevert(abi.encodeWithSelector(PqAuth.KeyNotRegistered.selector, address(0xC999)));
        new HavenEscrow(t);
    }

    function test_create_refusesUnregisteredFreelancer() public {
        HavenEscrow.Terms memory t = _one(1, _future());
        t.freelancer = address(0xF999);
        vm.expectRevert(abi.encodeWithSelector(PqAuth.KeyNotRegistered.selector, address(0xF999)));
        new HavenEscrow(t);
    }

    function test_create_refusesUnregisteredArbiter() public {
        HavenEscrow.Terms memory t = _one(1, _future());
        t.arbiters[2] = address(0xA004);
        vm.expectRevert(abi.encodeWithSelector(PqAuth.KeyNotRegistered.selector, address(0xA004)));
        new HavenEscrow(t);
    }

    function test_create_refusesSameParty() public {
        HavenEscrow.Terms memory t = _one(1, _future());
        t.freelancer = t.client;
        vm.expectRevert(HavenEscrow.SameParty.selector);
        new HavenEscrow(t);
    }

    function test_create_refusesPartyAsArbiter() public {
        HavenEscrow.Terms memory t = _one(1, _future());
        t.arbiters[2] = Actors.CLIENT;
        vm.expectRevert(abi.encodeWithSelector(HavenEscrow.PartyIsArbiter.selector, Actors.CLIENT));
        new HavenEscrow(t);
    }

    function test_create_refusesUnsortedArbiters() public {
        HavenEscrow.Terms memory t = _one(1, _future());
        t.arbiters[0] = Actors.A1;
        t.arbiters[1] = Actors.A0;
        vm.expectRevert(abi.encodeWithSelector(PqQuorum.Unsorted.selector, Actors.A1, Actors.A0));
        new HavenEscrow(t);
    }

    function test_create_refusesZeroMilestones() public {
        vm.expectRevert(abi.encodeWithSelector(HavenEscrow.BadMilestoneCount.selector, 0));
        new HavenEscrow(_terms(new uint128[](0), new uint64[](0)));
    }

    function test_create_refusesNineMilestones() public {
        uint128[] memory amounts = new uint128[](9);
        uint64[] memory deadlines = new uint64[](9);
        for (uint256 i = 0; i < 9; i++) {
            amounts[i] = 1;
            deadlines[i] = _future();
        }
        vm.expectRevert(abi.encodeWithSelector(HavenEscrow.BadMilestoneCount.selector, 9));
        new HavenEscrow(_terms(amounts, deadlines));
    }

    function test_create_refusesZeroAmount() public {
        vm.expectRevert(abi.encodeWithSelector(HavenEscrow.ZeroAmount.selector, 0));
        new HavenEscrow(_one(0, _future()));
    }

    function test_create_refusesPastDeadline() public {
        vm.expectRevert(abi.encodeWithSelector(HavenEscrow.BadDeadline.selector, 0));
        new HavenEscrow(_one(1, uint64(block.timestamp)));
    }

    function test_create_refusesShortReview() public {
        HavenEscrow.Terms memory t = _one(1, _future());
        t.reviewPeriod = 59;
        vm.expectRevert(HavenEscrow.BadPeriod.selector);
        new HavenEscrow(t);
    }

    function test_create_refusesSplitOver10000() public {
        HavenEscrow.Terms memory t = _one(1, _future());
        t.defaultSplitBps = 10001;
        vm.expectRevert(abi.encodeWithSelector(HavenEscrow.BadSplit.selector, uint16(10001)));
        new HavenEscrow(t);
    }

    function test_fund_fundsInOrder_andStopsAtFirstThatDoesNotFit() public {
        uint128[] memory amounts = new uint128[](3);
        amounts[0] = 100;
        amounts[1] = 200;
        amounts[2] = 50;
        uint64[] memory deadlines = new uint64[](3);
        deadlines[0] = _future();
        deadlines[1] = _future();
        deadlines[2] = _future();
        HavenEscrow escrow = new HavenEscrow(_terms(amounts, deadlines));
        token.mint(address(escrow), 250);
        escrow.fund();
        assertEq(uint8(escrow.milestone(0).status), uint8(HavenEscrow.Status.Funded));
        assertEq(uint8(escrow.milestone(1).status), uint8(HavenEscrow.Status.Unfunded));
        assertEq(uint8(escrow.milestone(2).status), uint8(HavenEscrow.Status.Unfunded));
        assertEq(escrow.totalFunded(), 100);
        assertEq(escrow.held(), 100);
    }

    function test_fund_refusesWhenNothingNew() public {
        HavenEscrow escrow = _escrow(100);
        token.mint(address(escrow), 40);
        vm.expectRevert(HavenEscrow.NothingToFund.selector);
        escrow.fund();
    }

    function test_deliver_happy() public {
        HavenEscrow escrow = _escrow(1_000_000);
        _fundAll(escrow);
        bytes32 commitment = keccak256("deliverable");
        vm.expectEmit(false, false, false, true, address(escrow));
        emit HavenEscrow.Delivered(0, commitment);
        _deliver(escrow, 0, commitment);
        HavenEscrow.Milestone memory ms = escrow.milestone(0);
        assertEq(uint8(ms.status), uint8(HavenEscrow.Status.Delivered));
        assertEq(ms.commitment, commitment);
        assertEq(ms.deliveredAt, block.timestamp);
    }

    function test_deliver_refusesAfterDeadline() public {
        HavenEscrow escrow = _escrow(1_000_000);
        _fundAll(escrow);
        uint256 deadline = escrow.milestone(0).deadline;
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrow.TooLate.selector, deadline + 1, deadline));
        escrow.deliver(0, keccak256("late"), block.timestamp + 1 hours, _junk());
    }

    function test_deliver_refusesClientSignature() public {
        HavenEscrow escrow = _escrow(1_000_000);
        _fundAll(escrow);
        bytes32 commitment = keccak256("deliverable");
        (, uint256 nonce,) = escrow.nonces();
        uint256 deadline = _authDeadline();
        bytes memory message = PqAuth.encodeMessage(
            block.chainid,
            address(escrow),
            Actors.FREELANCER,
            EscrowArgs.DELIVER,
            nonce,
            deadline,
            EscrowArgs.deliverArgs(0, commitment)
        );
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        escrow.deliver(0, commitment, deadline, PqTestKeys.sign(Actors.CLIENT, message));
    }

    function test_release_happy_paysFreelancerOnly() public {
        HavenEscrow escrow = _fundedDelivered();
        _release(escrow, 0);
        assertEq(uint8(escrow.milestone(0).status), uint8(HavenEscrow.Status.Released));
        assertEq(escrow.paidToFreelancer(), 1_000_000);
        assertEq(escrow.paidToClient(), 0);
        assertEq(token.balanceOf(Actors.FREELANCER), 1_000_000);
        assertEq(token.balanceOf(Actors.CLIENT), 0);
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(token.transferCount(), 1);
        (address from, address paid, uint256 amount) = token.transfers(0);
        assertEq(from, address(escrow));
        assertEq(paid, Actors.FREELANCER);
        assertEq(amount, 1_000_000);
    }

    function test_release_refusesFreelancerSignature() public {
        HavenEscrow escrow = _fundedDelivered();
        (uint256 nonce,,) = escrow.nonces();
        uint256 deadline = _authDeadline();
        bytes memory message = PqAuth.encodeMessage(
            block.chainid,
            address(escrow),
            Actors.CLIENT,
            EscrowArgs.RELEASE,
            nonce,
            deadline,
            EscrowArgs.releaseArgs(0, 1_000_000)
        );
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        escrow.release(0, deadline, PqTestKeys.sign(Actors.FREELANCER, message));
    }

    function test_release_refusesReplay() public {
        HavenEscrow escrow = _fundedDelivered();
        (uint256 nonce,,) = escrow.nonces();
        uint256 deadline = _authDeadline();
        bytes memory sig = _sign(
            address(escrow), Actors.CLIENT, EscrowArgs.RELEASE, EscrowArgs.releaseArgs(0, 1_000_000), nonce, deadline
        );
        escrow.release(0, deadline, sig);
        vm.expectRevert(
            abi.encodeWithSelector(HavenEscrow.WrongStatus.selector, 0, HavenEscrow.Status.Released)
        );
        escrow.release(0, deadline, sig);
    }

    function test_release_refusesSignatureForOtherMilestone() public {
        uint128[] memory amounts = new uint128[](2);
        amounts[0] = 100;
        amounts[1] = 200;
        uint64[] memory deadlines = new uint64[](2);
        deadlines[0] = _future();
        deadlines[1] = _future();
        HavenEscrow escrow = new HavenEscrow(_terms(amounts, deadlines));
        _fundAll(escrow);
        _deliver(escrow, 0, keccak256("a"));
        _deliver(escrow, 1, keccak256("b"));
        (uint256 nonce,,) = escrow.nonces();
        uint256 deadline = _authDeadline();
        bytes memory sig =
            _sign(address(escrow), Actors.CLIENT, EscrowArgs.RELEASE, EscrowArgs.releaseArgs(0, 100), nonce, deadline);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        escrow.release(1, deadline, sig);
    }

    function test_release_refusesSignatureForOtherEscrow() public {
        HavenEscrow first = _fundedDelivered();
        HavenEscrow second = _fundedDelivered();
        (uint256 nonce,,) = first.nonces();
        uint256 deadline = _authDeadline();
        bytes memory sig = _sign(
            address(first), Actors.CLIENT, EscrowArgs.RELEASE, EscrowArgs.releaseArgs(0, 1_000_000), nonce, deadline
        );
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        second.release(0, deadline, sig);
    }

    function test_release_refusesExpired() public {
        HavenEscrow escrow = _fundedDelivered();
        uint256 deadline = block.timestamp - 1;
        vm.expectRevert(abi.encodeWithSelector(PqAuth.Expired.selector, deadline));
        escrow.release(0, deadline, _junk());
    }

    function test_release_refusesDeadlineTooFar() public {
        HavenEscrow escrow = _fundedDelivered();
        uint256 deadline = block.timestamp + 1 days + 1;
        vm.expectRevert(abi.encodeWithSelector(PqAuth.DeadlineTooFar.selector, deadline, 1 days));
        escrow.release(0, deadline, _junk());
    }

    function test_release_refusesWrongStatus() public {
        HavenEscrow escrow = _escrow(1_000_000);
        _fundAll(escrow);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrow.WrongStatus.selector, 0, HavenEscrow.Status.Funded));
        escrow.release(0, _authDeadline(), _junk());
    }

    function test_autoRelease_refusesAtBoundary_allowsOneSecondLater() public {
        HavenEscrow escrow = _fundedDelivered();
        uint256 at = uint256(escrow.milestone(0).deliveredAt) + escrow.reviewPeriod();
        vm.warp(at);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrow.TooEarly.selector, at, at));
        escrow.autoRelease(0);
        vm.warp(at + 1);
        escrow.autoRelease(0);
        assertEq(uint8(escrow.milestone(0).status), uint8(HavenEscrow.Status.Released));
        assertEq(token.balanceOf(Actors.FREELANCER), 1_000_000);
    }

    function test_refund_refusesBeforeDeadline_paysClientAfter() public {
        HavenEscrow escrow = _escrow(1_000_000);
        _fundAll(escrow);
        uint256 deadline = escrow.milestone(0).deadline;
        vm.warp(deadline);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrow.TooEarly.selector, deadline, deadline));
        escrow.refund(0);
        vm.warp(deadline + 1);
        escrow.refund(0);
        assertEq(uint8(escrow.milestone(0).status), uint8(HavenEscrow.Status.Refunded));
        assertEq(token.balanceOf(Actors.CLIENT), 1_000_000);
        assertEq(token.balanceOf(Actors.FREELANCER), 0);
    }

    function test_refund_refusesDeliveredMilestone() public {
        HavenEscrow escrow = _fundedDelivered();
        vm.expectRevert(abi.encodeWithSelector(HavenEscrow.WrongStatus.selector, 0, HavenEscrow.Status.Delivered));
        escrow.refund(0);
    }

    function test_dispute_byClient() public {
        HavenEscrow escrow = _fundedDelivered();
        _dispute(escrow, 0, true);
        HavenEscrow.Milestone memory ms = escrow.milestone(0);
        assertEq(uint8(ms.status), uint8(HavenEscrow.Status.Disputed));
        assertEq(ms.disputedAt, block.timestamp);
    }

    function test_dispute_byFreelancer() public {
        HavenEscrow escrow = _fundedDelivered();
        _dispute(escrow, 0, false);
        assertEq(uint8(escrow.milestone(0).status), uint8(HavenEscrow.Status.Disputed));
    }

    function test_dispute_refusesAfterReview() public {
        HavenEscrow escrow = _fundedDelivered();
        uint256 at = uint256(escrow.milestone(0).deliveredAt) + escrow.reviewPeriod();
        vm.warp(at + 1);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrow.TooLate.selector, at + 1, at));
        escrow.dispute(0, true, block.timestamp + 1 hours, _junk());
    }

    function test_dispute_refusesWrongPartySig() public {
        HavenEscrow escrow = _fundedDelivered();
        (uint256 nonce,,) = escrow.nonces();
        uint256 deadline = _authDeadline();
        bytes memory message = PqAuth.encodeMessage(
            block.chainid,
            address(escrow),
            Actors.CLIENT,
            EscrowArgs.DISPUTE,
            nonce,
            deadline,
            EscrowArgs.disputeArgs(0, true)
        );
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        escrow.dispute(0, true, deadline, PqTestKeys.sign(Actors.FREELANCER, message));
    }

    function test_resolve_70_30() public {
        HavenEscrow escrow = _disputed();
        _resolve(escrow, 0, 7000);
        assertEq(uint8(escrow.milestone(0).status), uint8(HavenEscrow.Status.Resolved));
        assertEq(escrow.paidToFreelancer(), 700_000);
        assertEq(escrow.paidToClient(), 300_000);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_resolve_refusesOneArbiter() public {
        HavenEscrow escrow = _disputed();
        address[] memory who = new address[](1);
        bytes[] memory sigs = new bytes[](1);
        who[0] = Actors.A0;
        sigs[0] = _junk();
        vm.expectRevert(abi.encodeWithSelector(PqQuorum.TooFew.selector, 1, 2));
        escrow.resolve(0, 7000, _authDeadline(), who, sigs);
    }

    function test_resolve_refusesSameArbiterTwice() public {
        HavenEscrow escrow = _disputed();
        (,, uint256 nonce) = escrow.nonces();
        uint256 deadline = _authDeadline();
        bytes32 action = PqQuorum.quorumAction(EscrowArgs.RESOLVE);
        bytes32 args = EscrowArgs.resolveArgs(0, 7000);
        address[] memory who = new address[](2);
        bytes[] memory sigs = new bytes[](2);
        who[0] = Actors.A0;
        who[1] = Actors.A0;
        sigs[0] = _sign(address(escrow), Actors.A0, action, args, nonce, deadline);
        sigs[1] = _junk();
        vm.expectRevert(abi.encodeWithSelector(PqQuorum.Unsorted.selector, Actors.A0, Actors.A0));
        escrow.resolve(0, 7000, deadline, who, sigs);
    }

    function test_resolve_refusesNonMember() public {
        HavenEscrow escrow = _disputed();
        address outsider = address(0xD44);
        address[] memory who = new address[](2);
        bytes[] memory sigs = new bytes[](2);
        who[0] = outsider;
        who[1] = Actors.A0;
        sigs[0] = _junk();
        sigs[1] = _junk();
        vm.expectRevert(abi.encodeWithSelector(PqQuorum.NotMember.selector, outsider));
        escrow.resolve(0, 7000, _authDeadline(), who, sigs);
    }

    function test_resolve_refusesSplitOver10000() public {
        HavenEscrow escrow = _disputed();
        address[] memory who = new address[](2);
        bytes[] memory sigs = new bytes[](2);
        who[0] = Actors.A0;
        who[1] = Actors.A1;
        vm.expectRevert(abi.encodeWithSelector(HavenEscrow.BadSplit.selector, uint16(10001)));
        escrow.resolve(0, 10001, _authDeadline(), who, sigs);
    }

    function test_resolve_refusesShareFromOtherMilestone() public {
        uint128[] memory amounts = new uint128[](2);
        amounts[0] = 1000;
        amounts[1] = 1000;
        uint64[] memory deadlines = new uint64[](2);
        deadlines[0] = _future();
        deadlines[1] = _future();
        HavenEscrow escrow = new HavenEscrow(_terms(amounts, deadlines));
        _fundAll(escrow);
        _deliver(escrow, 0, keccak256("a"));
        _deliver(escrow, 1, keccak256("b"));
        _dispute(escrow, 0, true);
        _dispute(escrow, 1, true);
        (,, uint256 nonce) = escrow.nonces();
        uint256 deadline = _authDeadline();
        bytes32 action = PqQuorum.quorumAction(EscrowArgs.RESOLVE);
        bytes32 args = EscrowArgs.resolveArgs(0, 7000);
        address[] memory who = new address[](2);
        bytes[] memory sigs = new bytes[](2);
        who[0] = Actors.A0;
        who[1] = Actors.A1;
        sigs[0] = _sign(address(escrow), Actors.A0, action, args, nonce, deadline);
        sigs[1] = _sign(address(escrow), Actors.A1, action, args, nonce, deadline);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        escrow.resolve(1, 7000, deadline, who, sigs);
    }

    function test_resolveTimeout_appliesDefaultSplit() public {
        HavenEscrow escrow = _disputed();
        uint256 at = uint256(escrow.milestone(0).disputedAt) + escrow.arbiterTimeout();
        vm.warp(at + 1);
        escrow.resolveTimeout(0);
        assertEq(uint8(escrow.milestone(0).status), uint8(HavenEscrow.Status.Resolved));
        assertEq(escrow.paidToFreelancer(), 500_000);
        assertEq(escrow.paidToClient(), 500_000);
    }

    function test_resolveTimeout_refusesEarly() public {
        HavenEscrow escrow = _disputed();
        uint256 at = uint256(escrow.milestone(0).disputedAt) + escrow.arbiterTimeout();
        vm.warp(at);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrow.TooEarly.selector, at, at));
        escrow.resolveTimeout(0);
    }

    function test_cancel_needsBoth() public {
        HavenEscrow escrow = _escrow(1_000_000);
        (uint256 clientNonce,,) = escrow.nonces();
        uint256 deadline = _authDeadline();
        bytes32 args = EscrowArgs.cancelArgs(0);
        bytes memory clientSig = _sign(address(escrow), Actors.CLIENT, EscrowArgs.CANCEL, args, clientNonce, deadline);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        escrow.cancel(0, deadline, clientSig, _junk());
        assertEq(uint8(escrow.milestone(0).status), uint8(HavenEscrow.Status.Unfunded));
        _cancel(escrow, 0);
        assertEq(uint8(escrow.milestone(0).status), uint8(HavenEscrow.Status.Cancelled));
    }

    function test_cancel_returnsFundedToClient() public {
        HavenEscrow escrow = _escrow(1_000_000);
        _fundAll(escrow);
        _cancel(escrow, 0);
        assertEq(uint8(escrow.milestone(0).status), uint8(HavenEscrow.Status.Cancelled));
        assertEq(token.balanceOf(Actors.CLIENT), 1_000_000);
        assertEq(escrow.paidToClient(), 1_000_000);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_cancel_refusesDelivered() public {
        HavenEscrow escrow = _fundedDelivered();
        vm.expectRevert(abi.encodeWithSelector(HavenEscrow.WrongStatus.selector, 0, HavenEscrow.Status.Delivered));
        escrow.cancel(0, _authDeadline(), _junk(), _junk());
    }

    function test_sweep_paysSurplusToClient() public {
        HavenEscrow escrow = _escrow(1_000_000);
        _fundAll(escrow);
        token.mint(address(escrow), 25);
        escrow.sweep();
        assertEq(token.balanceOf(Actors.CLIENT), 25);
        assertEq(token.balanceOf(address(escrow)), 1_000_000);
        assertEq(escrow.held(), 1_000_000);
        vm.expectRevert(HavenEscrow.NothingToSweep.selector);
        escrow.sweep();
    }

    function test_sweep_refusesWhileUnfunded() public {
        HavenEscrow escrow = _escrow(1_000_000);
        token.mint(address(escrow), 25);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrow.WrongStatus.selector, 0, HavenEscrow.Status.Unfunded));
        escrow.sweep();
    }

    function test_stolenClassicalKey_client_canDoNothing() public {
        _stolen(Actors.CLIENT);
    }

    function test_stolenClassicalKey_freelancer_canDoNothing() public {
        _stolen(Actors.FREELANCER);
    }

    function test_stolenClassicalKey_arbiter0_canDoNothing() public {
        _stolen(Actors.A0);
    }

    function test_stolenClassicalKey_arbiter1_canDoNothing() public {
        _stolen(Actors.A1);
    }

    function test_stolenClassicalKey_arbiter2_canDoNothing() public {
        _stolen(Actors.A2);
    }

    function _future() private view returns (uint64) {
        return uint64(block.timestamp + 7 days);
    }

    function _fundedDelivered() private returns (HavenEscrow escrow) {
        escrow = _escrow(1_000_000);
        _fundAll(escrow);
        _deliver(escrow, 0, keccak256("deliverable"));
    }

    function _disputed() private returns (HavenEscrow escrow) {
        escrow = _fundedDelivered();
        _dispute(escrow, 0, true);
    }

    function _stolen(address party) private {
        HavenEscrow escrow = _escrow(1_000_000);
        uint256 deadline = _authDeadline();
        bytes memory junk = _junk();
        address[] memory who = new address[](2);
        bytes[] memory sigs = new bytes[](2);
        who[0] = Actors.A0;
        who[1] = Actors.A1;
        sigs[0] = junk;
        sigs[1] = junk;

        vm.expectRevert();
        vm.prank(party);
        escrow.fund();
        vm.expectRevert();
        vm.prank(party);
        escrow.deliver(0, keccak256("x"), deadline, junk);
        vm.expectRevert();
        vm.prank(party);
        escrow.release(0, deadline, junk);
        vm.expectRevert();
        vm.prank(party);
        escrow.autoRelease(0);
        vm.expectRevert();
        vm.prank(party);
        escrow.refund(0);
        vm.expectRevert();
        vm.prank(party);
        escrow.dispute(0, true, deadline, junk);
        vm.expectRevert();
        vm.prank(party);
        escrow.resolve(0, 5000, deadline, who, sigs);
        vm.expectRevert();
        vm.prank(party);
        escrow.resolveTimeout(0);
        vm.expectRevert();
        vm.prank(party);
        escrow.cancel(0, deadline, junk, junk);
        vm.expectRevert();
        vm.prank(party);
        escrow.sweep();

        assertEq(token.transferCount(), 0);
        assertEq(uint8(escrow.milestone(0).status), uint8(HavenEscrow.Status.Unfunded));
        assertEq(escrow.paidToClient(), 0);
        assertEq(escrow.paidToFreelancer(), 0);
    }
}
