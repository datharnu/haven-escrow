// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {HavenEscrowV2} from "../src/HavenEscrowV2.sol";
import {Actors} from "./Actors.sol";
import {FixtureV2} from "./FixtureV2.sol";

contract HavenEscrowV2FuzzTest is FixtureV2 {
    /// @dev Any stored receipt starts the clock only if it is the client's, over this commitment, at the given id.
    function testFuzz_onlyTheClientsReceiptOverTheCommitment(
        uint8 who,
        bool rightHash,
        uint256 counter,
        uint256 askCounter,
        bytes32 otherHash
    ) public {
        address[5] memory signers = [Actors.CLIENT, Actors.FREELANCER, Actors.A0, Actors.A2, STRANGER];
        address signer = signers[who % 5];
        HavenEscrowV2 escrow = _v2(1);
        _fundV2(escrow);
        bytes32[5] memory parts = _parts("file");
        bytes32 c = _deliverParts(escrow, 0, parts);
        if (otherHash == bytes32(0) || otherHash == c) otherHash = keccak256(abi.encode(otherHash));
        _record(signer, signer, counter, rightHash ? c : otherHash);

        bool expected = signer == Actors.CLIENT && rightHash && askCounter == counter;
        if (!expected) vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.NoReceipt.selector, 0));
        escrow.acknowledge(0, CONVERSATION, askCounter, parts);
        assertEq(escrow.milestone(0).receivedAt != 0, expected);
    }

    /// @dev No five hashes other than the committed ones open the commitment.
    function testFuzz_partsMustOpenTheCommitment(bytes32[5] memory guess, uint8 flip) public {
        HavenEscrowV2 escrow = _v2(1);
        _fundV2(escrow);
        bytes32[5] memory parts = _parts("file");
        _clientReceipt(0, _deliverParts(escrow, 0, parts));
        guess[flip % 5] = keccak256(abi.encode(guess[flip % 5], "not the committed word"));
        vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.CommitmentMismatch.selector, 0));
        escrow.acknowledge(0, CONVERSATION, 0, guess);
    }

    /// @dev A silent panel pays `receivedSplitBps` if the client's receipt was recorded before `resolveTimeout`,
    /// otherwise `defaultSplitBps`, at any amount and any pair of splits fixed at creation.
    function testFuzz_silentPanelSplit(uint128 amount, uint16 defaultBps, uint16 receivedBps, bool withReceipt, bool clientDisputes)
        public
    {
        amount = uint128(bound(amount, 1, type(uint128).max));
        defaultBps = uint16(bound(defaultBps, 0, 10000));
        receivedBps = uint16(bound(receivedBps, 0, 10000));
        HavenEscrowV2.Terms memory t = _v2Terms(_one(amount, uint64(block.timestamp + 7 days)));
        t.defaultSplitBps = defaultBps;
        t.receivedSplitBps = receivedBps;
        HavenEscrowV2 escrow = new HavenEscrowV2(t, address(receipts));
        _fundV2(escrow);
        bytes32[5] memory parts = _parts("file");
        bytes32 c = _deliverParts(escrow, 0, parts);
        _clientReceipt(0, c);
        _disputeV2(escrow, 0, clientDisputes);
        if (withReceipt) escrow.acknowledge(0, CONVERSATION, 0, parts);
        vm.warp(block.timestamp + 3 days + 1);
        escrow.resolveTimeout(0);
        uint256 bps = withReceipt ? receivedBps : defaultBps;
        uint256 toFreelancer = uint256(amount) * bps / 10000;
        assertEq(token.balanceOf(Actors.FREELANCER), toFreelancer);
        assertEq(token.balanceOf(Actors.CLIENT), uint256(amount) - toFreelancer);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    /// @dev With or without a receipt, the review runs from `deliver`, exactly as in HavenEscrow.
    function testFuzz_reviewRunsFromDelivery(uint64 receiptAfter, uint64 later, bool withReceipt) public {
        uint256 ackAt = bound(receiptAfter, 0, 3 days);
        uint256 wait = bound(later, 0, 10 days);
        HavenEscrowV2 escrow = _v2(1_000_000);
        _fundV2(escrow);
        bytes32[5] memory parts = _parts("file");
        bytes32 c = _deliverParts(escrow, 0, parts);
        uint256 at = escrow.milestone(0).deliveredAt + 3 days;
        vm.warp(block.timestamp + ackAt);
        if (withReceipt) {
            _clientReceipt(0, c);
            escrow.acknowledge(0, CONVERSATION, 0, parts);
        }
        vm.warp(block.timestamp + wait);
        if (block.timestamp <= at) {
            vm.expectRevert(abi.encodeWithSelector(HavenEscrowV2.TooEarly.selector, block.timestamp, at));
            escrow.autoRelease(0);
        } else {
            escrow.autoRelease(0);
            assertEq(token.balanceOf(Actors.FREELANCER), 1_000_000);
        }
    }
}
