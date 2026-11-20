// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {PqAuth} from "haven-pq-kit/PqAuth.sol";
import {PqQuorum} from "haven-pq-kit/PqQuorum.sol";
import {PqTestKeys} from "haven-pq-kit-test/PqTestKeys.sol";
import {HavenEscrow} from "../src/HavenEscrow.sol";
import {EscrowArgs} from "../src/EscrowArgs.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {Actors} from "./Actors.sol";
import {Fixture} from "./Fixture.sol";

contract Handler is Test {
    uint256 internal constant COUNT = 3;

    HavenEscrow public immutable escrow;
    MockERC20 public immutable token;

    uint256 public ghostDeposited;
    mapping(uint256 => uint256) public payouts;
    mapping(uint256 => uint256) public paid;
    mapping(uint256 => bool) public validClientSig;
    mapping(uint256 => bool) public autoAfter;
    mapping(uint256 => bool) public terminalSeen;
    mapping(uint256 => uint8) public terminalStatus;

    constructor(HavenEscrow escrow_, MockERC20 token_) {
        escrow = escrow_;
        token = token_;
    }

    function fund(uint128 amount) external {
        amount = uint128(bound(amount, 0, 5000));
        if (amount != 0) {
            token.mint(address(escrow), amount);
            ghostDeposited += amount;
        }
        try escrow.fund() {} catch {}
    }

    function deliver(uint256 m, bool valid, uint256 ttl, bytes32 commitment) external {
        m %= COUNT;
        if (valid && commitment == bytes32(0)) commitment = bytes32(uint256(1));
        uint256 deadline = _authDeadline(valid, ttl);
        (, uint256 nonce,) = escrow.nonces();
        bytes memory sig = valid
            ? _signed(Actors.FREELANCER, EscrowArgs.DELIVER, EscrowArgs.deliverArgs(m, commitment), nonce, deadline)
            : _junk();
        try escrow.deliver(m, commitment, deadline, sig) {} catch {}
    }

    function release(uint256 m, bool valid, uint256 ttl) external {
        m %= COUNT;
        uint256 deadline = _authDeadline(valid, ttl);
        (uint256 nonce,,) = escrow.nonces();
        uint256 amount = escrow.milestone(m).amount;
        bytes memory sig = valid
            ? _signed(Actors.CLIENT, EscrowArgs.RELEASE, EscrowArgs.releaseArgs(m, amount), nonce, deadline)
            : _junk();
        try escrow.release(m, deadline, sig) {
            _paid(m, amount);
            if (valid) validClientSig[m] = true;
        } catch {}
    }

    function autoRelease(uint256 m) external {
        m %= COUNT;
        uint64 deliveredAt = escrow.milestone(m).deliveredAt;
        uint256 amount = escrow.milestone(m).amount;
        try escrow.autoRelease(m) {
            _paid(m, amount);
            if (block.timestamp > uint256(deliveredAt) + escrow.reviewPeriod()) autoAfter[m] = true;
        } catch {}
    }

    function refund(uint256 m) external {
        m %= COUNT;
        uint256 amount = escrow.milestone(m).amount;
        try escrow.refund(m) {
            _paid(m, amount);
        } catch {}
    }

    function dispute(uint256 m, bool byClient, bool valid, uint256 ttl) external {
        m %= COUNT;
        uint256 deadline = _authDeadline(valid, ttl);
        uint256 nonce;
        address signer;
        if (byClient) {
            (nonce,,) = escrow.nonces();
            signer = Actors.CLIENT;
        } else {
            (, nonce,) = escrow.nonces();
            signer = Actors.FREELANCER;
        }
        bytes memory sig = valid
            ? _signed(signer, EscrowArgs.DISPUTE, EscrowArgs.disputeArgs(m, byClient), nonce, deadline)
            : _junk();
        try escrow.dispute(m, byClient, deadline, sig) {} catch {}
    }

    function resolve(uint256 m, uint16 bps, bool valid, uint256 ttl) external {
        m %= COUNT;
        bps = uint16(bound(bps, 0, valid ? 10000 : 20000));
        uint256 deadline = _authDeadline(valid, ttl);
        uint256 amount = escrow.milestone(m).amount;
        (address[] memory who, bytes[] memory sigs) = valid ? _pair(m, bps, deadline) : _junkPair();
        try escrow.resolve(m, bps, deadline, who, sigs) {
            _paid(m, amount);
        } catch {}
    }

    function resolveTimeout(uint256 m) external {
        m %= COUNT;
        uint256 amount = escrow.milestone(m).amount;
        try escrow.resolveTimeout(m) {
            _paid(m, amount);
        } catch {}
    }

    function cancel(uint256 m, bool valid, uint256 ttl) external {
        m %= COUNT;
        HavenEscrow.Status before = escrow.milestone(m).status;
        uint256 amount = escrow.milestone(m).amount;
        uint256 deadline = _authDeadline(valid, ttl);
        (uint256 clientNonce, uint256 freelancerNonce,) = escrow.nonces();
        bytes32 args = EscrowArgs.cancelArgs(m);
        bytes memory clientSig = valid
            ? _signed(Actors.CLIENT, EscrowArgs.CANCEL, args, clientNonce, deadline)
            : _junk();
        bytes memory freelancerSig = valid
            ? _signed(Actors.FREELANCER, EscrowArgs.CANCEL, args, freelancerNonce, deadline)
            : _junk();
        try escrow.cancel(m, deadline, clientSig, freelancerSig) {
            if (before == HavenEscrow.Status.Funded) _paid(m, amount);
            else _terminal(m);
        } catch {}
    }

    function sweep() external {
        try escrow.sweep() {} catch {}
    }

    function warp(uint64 delta) external {
        vm.warp(block.timestamp + bound(delta, 0, 120 days));
    }

    function _paid(uint256 m, uint256 amount) internal {
        payouts[m] += 1;
        paid[m] += amount;
        _terminal(m);
    }

    function _terminal(uint256 m) internal {
        HavenEscrow.Status status = escrow.milestone(m).status;
        if (
            status == HavenEscrow.Status.Released || status == HavenEscrow.Status.Resolved
                || status == HavenEscrow.Status.Refunded || status == HavenEscrow.Status.Cancelled
        ) {
            if (!terminalSeen[m]) {
                terminalSeen[m] = true;
                terminalStatus[m] = uint8(status);
            }
        }
    }

    function _authDeadline(bool valid, uint256 ttl) internal view returns (uint256) {
        if (valid) return block.timestamp + bound(ttl, 1, 1 days);
        uint256 roll = bound(ttl, 0, 2);
        if (roll == 0) return block.timestamp == 0 ? 0 : block.timestamp - 1;
        if (roll == 1) return block.timestamp + 2 days;
        return block.timestamp + 1 hours;
    }

    function _signed(address signer, bytes32 action, bytes32 argsHash, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        return PqTestKeys.sign(
            signer, PqAuth.encodeMessage(block.chainid, address(escrow), signer, action, nonce, deadline, argsHash)
        );
    }

    function _pair(uint256 m, uint16 bps, uint256 deadline)
        internal
        view
        returns (address[] memory who, bytes[] memory sigs)
    {
        (,, uint256 nonce) = escrow.nonces();
        bytes32 action = PqQuorum.quorumAction(EscrowArgs.RESOLVE);
        bytes32 args = EscrowArgs.resolveArgs(m, bps);
        who = new address[](2);
        sigs = new bytes[](2);
        who[0] = Actors.A0;
        who[1] = Actors.A1;
        sigs[0] = _signed(Actors.A0, action, args, nonce, deadline);
        sigs[1] = _signed(Actors.A1, action, args, nonce, deadline);
    }

    function _junkPair() internal pure returns (address[] memory who, bytes[] memory sigs) {
        who = new address[](2);
        sigs = new bytes[](2);
        who[0] = Actors.A0;
        who[1] = Actors.A1;
        sigs[0] = _junk();
        sigs[1] = _junk();
    }

    function _junk() internal pure returns (bytes memory sig) {
        sig = new bytes(PqAuth.SIG_LEN);
    }
}

contract HavenEscrowInvariantTest is Fixture {
    Handler internal handler;
    HavenEscrow internal escrow;

    function setUp() public override {
        super.setUp();
        uint128[] memory amounts = new uint128[](3);
        uint64[] memory deadlines = new uint64[](3);
        amounts[0] = 100;
        amounts[1] = 250;
        amounts[2] = 400;
        deadlines[0] = uint64(block.timestamp + 20 days);
        deadlines[1] = deadlines[0];
        deadlines[2] = deadlines[0];
        escrow = new HavenEscrow(_terms(amounts, deadlines));
        handler = new Handler(escrow, token);
        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](11);
        selectors[0] = Handler.fund.selector;
        selectors[1] = Handler.deliver.selector;
        selectors[2] = Handler.release.selector;
        selectors[3] = Handler.autoRelease.selector;
        selectors[4] = Handler.refund.selector;
        selectors[5] = Handler.dispute.selector;
        selectors[6] = Handler.resolve.selector;
        selectors[7] = Handler.resolveTimeout.selector;
        selectors[8] = Handler.cancel.selector;
        selectors[9] = Handler.sweep.selector;
        selectors[10] = Handler.warp.selector;
        targetSelector(StdInvariant.FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_fundsOnlyReachParties() public view {
        uint256 n = token.transferCount();
        for (uint256 i = 0; i < n; i++) {
            (address from, address paid, uint256 amount) = token.transfers(i);
            if (from == address(escrow) && amount != 0) {
                assertTrue(paid == Actors.CLIENT || paid == Actors.FREELANCER);
            }
        }
    }

    function invariant_conservation() public view {
        assertEq(handler.ghostDeposited(), token.balanceOf(address(escrow)) + escrow.paidToClient() + escrow.paidToFreelancer());
    }

    function invariant_noDoublePayment() public view {
        uint256 n = escrow.milestoneCount();
        for (uint256 i = 0; i < n; i++) {
            assertLe(handler.payouts(i), 1);
            if (handler.payouts(i) == 1) assertEq(handler.paid(i), escrow.milestone(i).amount);
        }
    }

    function invariant_heldCovered() public view {
        assertGe(token.balanceOf(address(escrow)), escrow.held());
    }

    function invariant_releaseNeedsPqOrTimeout() public view {
        uint256 n = escrow.milestoneCount();
        for (uint256 i = 0; i < n; i++) {
            if (escrow.milestone(i).status == HavenEscrow.Status.Released) {
                assertTrue(handler.validClientSig(i) || handler.autoAfter(i));
            }
        }
    }

    function invariant_terminalIsFinal() public view {
        uint256 n = escrow.milestoneCount();
        for (uint256 i = 0; i < n; i++) {
            if (handler.terminalSeen(i)) {
                assertEq(uint8(escrow.milestone(i).status), handler.terminalStatus(i));
            }
        }
    }
}
