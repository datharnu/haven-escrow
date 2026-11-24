// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {HavenEscrow} from "../src/HavenEscrow.sol";
import {HavenEscrowV2} from "../src/HavenEscrowV2.sol";
import {HostileToken} from "./mocks/HostileToken.sol";
import {Actors} from "./Actors.sol";
import {FixtureV2} from "./FixtureV2.sol";

/// @notice QCAI regression tests: a token that returns false or reverts makes a payout revert `TransferFailed`,
/// and a token that calls back during a payout hits `Reentrancy`. HavenEscrowV2 first, then the same for V1.
contract HostileTokenTest is FixtureV2 {
    HostileToken internal bad;

    function setUp() public override {
        super.setUp();
        bad = new HostileToken();
    }

    function _v2Bad(uint256 n) internal returns (HavenEscrowV2 escrow) {
        uint128[] memory amounts = new uint128[](n);
        uint64[] memory deadlines = new uint64[](n);
        for (uint256 i = 0; i < n; i++) {
            amounts[i] = 1_000;
            deadlines[i] = uint64(block.timestamp + 7 days);
        }
        HavenEscrowV2.Terms memory t = _v2Terms(_terms(amounts, deadlines));
        t.token = address(bad);
        escrow = new HavenEscrowV2(t, address(receipts));
        bad.mint(address(escrow), 1_000 * n);
        escrow.fund();
        for (uint256 i = 0; i < n; i++) _deliverParts(escrow, i, _parts(string(abi.encode(i))));
        vm.warp(block.timestamp + 3 days + 1);
    }

    function _v1Bad(uint256 n) internal returns (HavenEscrow escrow) {
        uint128[] memory amounts = new uint128[](n);
        uint64[] memory deadlines = new uint64[](n);
        for (uint256 i = 0; i < n; i++) {
            amounts[i] = 1_000;
            deadlines[i] = uint64(block.timestamp + 7 days);
        }
        HavenEscrow.Terms memory t = _terms(amounts, deadlines);
        t.token = address(bad);
        escrow = new HavenEscrow(t);
        bad.mint(address(escrow), 1_000 * n);
        escrow.fund();
        for (uint256 i = 0; i < n; i++) _deliver(escrow, i, keccak256(abi.encode(i)));
        vm.warp(block.timestamp + 3 days + 1);
    }

    // ---------------------------------------------------------------- HavenEscrowV2

    function test_v2_pay_revertsTransferFailed_whenTokenReturnsFalse() public {
        HavenEscrowV2 escrow = _v2Bad(1);
        bad.setMode(HostileToken.Mode.ReturnFalse);
        vm.expectRevert(HavenEscrowV2.TransferFailed.selector);
        escrow.autoRelease(0);
        assertEq(uint8(escrow.milestone(0).status), uint8(HavenEscrowV2.Status.Delivered));
        assertEq(escrow.paidToFreelancer(), 0);
    }

    function test_v2_pay_revertsTransferFailed_whenTokenReverts() public {
        HavenEscrowV2 escrow = _v2Bad(1);
        bad.setMode(HostileToken.Mode.Revert);
        vm.expectRevert(HavenEscrowV2.TransferFailed.selector);
        escrow.autoRelease(0);
        assertEq(bad.balanceOf(address(escrow)), 1_000);
    }

    /// @dev The receipt-split payout goes through the same checked `_pay`.
    function test_v2_resolveTimeout_revertsTransferFailed_whenTokenReturnsFalse() public {
        uint128[] memory amounts = new uint128[](1);
        uint64[] memory deadlines = new uint64[](1);
        amounts[0] = 1_000;
        deadlines[0] = uint64(block.timestamp + 7 days);
        HavenEscrowV2.Terms memory t = _v2Terms(_terms(amounts, deadlines));
        t.token = address(bad);
        HavenEscrowV2 escrow = new HavenEscrowV2(t, address(receipts));
        bad.mint(address(escrow), 1_000);
        escrow.fund();
        bytes32[5] memory parts = _parts("file");
        _clientReceipt(0, _deliverParts(escrow, 0, parts));
        _disputeV2(escrow, 0, true);
        escrow.acknowledge(0, CONVERSATION, 0, parts);
        vm.warp(block.timestamp + 3 days + 1);
        bad.setMode(HostileToken.Mode.ReturnFalse);
        vm.expectRevert(HavenEscrowV2.TransferFailed.selector);
        escrow.resolveTimeout(0);
        bad.setMode(HostileToken.Mode.Normal);
        escrow.resolveTimeout(0);
        assertEq(bad.balanceOf(Actors.FREELANCER), 1_000);
    }

    function test_v2_pay_acceptsTokenWithNoReturnData() public {
        HavenEscrowV2 escrow = _v2Bad(1);
        bad.setMode(HostileToken.Mode.NoReturnData);
        escrow.autoRelease(0);
        assertEq(bad.balanceOf(Actors.FREELANCER), 1_000);
    }

    function test_v2_reentrantToken_cannotPayTwice() public {
        HavenEscrowV2 escrow = _v2Bad(2);
        bad.setReenter(address(escrow), abi.encodeCall(HavenEscrowV2.autoRelease, (1)));
        escrow.autoRelease(0);
        assertTrue(bad.reentered());
        assertFalse(bad.reenterOk());
        assertEq(bytes4(bad.reenterResult()), HavenEscrowV2.Reentrancy.selector);
        assertEq(bad.balanceOf(Actors.FREELANCER), 1_000);
        assertEq(uint8(escrow.milestone(1).status), uint8(HavenEscrowV2.Status.Delivered));
        escrow.autoRelease(1); // the same call outside the callback works
        assertEq(bad.balanceOf(Actors.FREELANCER), 2_000);
    }

    function test_v2_reentrantToken_lockRunsBeforeAnyOtherCheck() public {
        HavenEscrowV2 escrow = _v2Bad(2);
        bad.setReenter(address(escrow), abi.encodeCall(HavenEscrowV2.resolveTimeout, (1)));
        escrow.autoRelease(0);
        assertEq(bytes4(bad.reenterResult()), HavenEscrowV2.Reentrancy.selector);
    }

    // ---------------------------------------------------------------- HavenEscrow (V1), same checks

    function test_v1_pay_revertsTransferFailed_whenTokenReturnsFalse() public {
        HavenEscrow escrow = _v1Bad(1);
        bad.setMode(HostileToken.Mode.ReturnFalse);
        vm.expectRevert(HavenEscrow.TransferFailed.selector);
        escrow.autoRelease(0);
    }

    function test_v1_pay_revertsTransferFailed_whenTokenReverts() public {
        HavenEscrow escrow = _v1Bad(1);
        bad.setMode(HostileToken.Mode.Revert);
        vm.expectRevert(HavenEscrow.TransferFailed.selector);
        escrow.autoRelease(0);
    }

    function test_v1_reentrantToken_cannotPayTwice() public {
        HavenEscrow escrow = _v1Bad(2);
        bad.setReenter(address(escrow), abi.encodeCall(HavenEscrow.autoRelease, (1)));
        escrow.autoRelease(0);
        assertEq(bytes4(bad.reenterResult()), HavenEscrow.Reentrancy.selector);
        assertEq(bad.balanceOf(Actors.FREELANCER), 1_000);
        assertEq(uint8(escrow.milestone(1).status), uint8(HavenEscrow.Status.Delivered));
    }
}
