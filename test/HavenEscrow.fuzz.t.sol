// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {HavenEscrow} from "../src/HavenEscrow.sol";
import {Actors} from "./Actors.sol";
import {Fixture} from "./Fixture.sol";

contract HavenEscrowFuzzTest is Fixture {
    function testFuzz_resolveSplit(uint128 amount, uint16 bps) public {
        amount = uint128(bound(amount, 1, type(uint128).max));
        bps = uint16(bound(bps, 0, 10000));
        HavenEscrow escrow = _escrow(amount);
        _fundAll(escrow);
        _deliver(escrow, 0, keccak256("file"));
        _dispute(escrow, 0, true);
        _resolve(escrow, 0, bps);
        uint256 freelancerShare = uint256(amount) * bps / 10000;
        uint256 clientShare = uint256(amount) - freelancerShare;
        assertEq(escrow.paidToFreelancer(), freelancerShare);
        assertEq(escrow.paidToClient(), clientShare);
        assertEq(freelancerShare + clientShare, amount);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testFuzz_amounts(uint128[3] memory amounts) public {
        uint128[] memory values = new uint128[](3);
        uint64[] memory deadlines = new uint64[](3);
        uint256 sum;
        for (uint256 i = 0; i < 3; i++) {
            values[i] = uint128(bound(amounts[i], 1, type(uint128).max));
            deadlines[i] = uint64(block.timestamp + 7 days);
            sum += values[i];
        }
        HavenEscrow escrow = new HavenEscrow(_terms(values, deadlines));
        _fundAll(escrow);
        for (uint256 i = 0; i < 3; i++) {
            _deliver(escrow, i, keccak256(abi.encode("file", i)));
            _release(escrow, i);
        }
        assertEq(escrow.paidToFreelancer(), sum);
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(token.balanceOf(Actors.FREELANCER), sum);
    }

    function testFuzz_timing(uint64 warp) public {
        uint256 past = bound(warp, 1, 30 days);
        uint64 deadline = uint64(block.timestamp + 7 days);
        HavenEscrow onTime = new HavenEscrow(_one(1_000_000, deadline));
        HavenEscrow late = new HavenEscrow(_one(1_000_000, deadline));
        HavenEscrow afterReview = new HavenEscrow(_one(1_000_000, deadline));
        _fundAll(onTime);
        _fundAll(late);
        _fundAll(afterReview);

        vm.warp(deadline);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrow.TooEarly.selector, uint256(deadline), uint256(deadline)));
        late.refund(0);
        _deliver(onTime, 0, keccak256("on-time"));
        _deliver(afterReview, 0, keccak256("review"));

        vm.warp(uint256(deadline) + past);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrow.TooLate.selector, block.timestamp, uint256(deadline)));
        late.deliver(0, keccak256("too-late"), block.timestamp + 1 hours, _junk());
        late.refund(0);
        assertEq(late.paidToClient(), 1_000_000);

        uint256 reviewEnd = uint256(deadline) + 3 days;
        vm.warp(reviewEnd);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrow.TooEarly.selector, reviewEnd, reviewEnd));
        onTime.autoRelease(0);
        _dispute(onTime, 0, true);
        assertEq(uint8(onTime.milestone(0).status), uint8(HavenEscrow.Status.Disputed));

        vm.warp(reviewEnd + past);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrow.TooLate.selector, block.timestamp, reviewEnd));
        afterReview.dispute(0, true, block.timestamp + 1 hours, _junk());
        afterReview.autoRelease(0);
        assertEq(afterReview.paidToFreelancer(), 1_000_000);

        uint256 timeoutEnd = reviewEnd + 3 days;
        vm.warp(timeoutEnd);
        vm.expectRevert(abi.encodeWithSelector(HavenEscrow.TooEarly.selector, timeoutEnd, timeoutEnd));
        onTime.resolveTimeout(0);
        vm.warp(timeoutEnd + past);
        onTime.resolveTimeout(0);
        assertEq(onTime.paidToFreelancer(), 500_000);
        assertEq(onTime.paidToClient(), 500_000);
    }
}
