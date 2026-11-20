// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {PqTestBase} from "haven-pq-kit-test/PqTestBase.sol";
import {PqAuth} from "haven-pq-kit/PqAuth.sol";
import {PqQuorum} from "haven-pq-kit/PqQuorum.sol";
import {PqTestKeys} from "haven-pq-kit-test/PqTestKeys.sol";
import {HavenEscrow} from "../src/HavenEscrow.sol";
import {EscrowArgs} from "../src/EscrowArgs.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {Actors} from "./Actors.sol";

abstract contract Fixture is PqTestBase {
    MockERC20 internal token;

    function setUp() public virtual override {
        super.setUp();
        _register(Actors.CLIENT);
        _register(Actors.FREELANCER);
        _register(Actors.A0);
        _register(Actors.A1);
        _register(Actors.A2);
        token = new MockERC20();
    }

    function _terms(uint128[] memory amounts, uint64[] memory deadlines)
        internal
        view
        returns (HavenEscrow.Terms memory t)
    {
        address[] memory arbiters = new address[](3);
        arbiters[0] = Actors.A0;
        arbiters[1] = Actors.A1;
        arbiters[2] = Actors.A2;
        t = HavenEscrow.Terms({
            client: Actors.CLIENT,
            freelancer: Actors.FREELANCER,
            token: address(token),
            arbiters: arbiters,
            reviewPeriod: 3 days,
            arbiterTimeout: 3 days,
            defaultSplitBps: 5000,
            amounts: amounts,
            deadlines: deadlines
        });
    }

    function _one(uint128 amount, uint64 deadline) internal view returns (HavenEscrow.Terms memory) {
        uint128[] memory amounts = new uint128[](1);
        uint64[] memory deadlines = new uint64[](1);
        amounts[0] = amount;
        deadlines[0] = deadline;
        return _terms(amounts, deadlines);
    }

    function _escrow(uint128 amount) internal returns (HavenEscrow) {
        return new HavenEscrow(_one(amount, uint64(block.timestamp + 7 days)));
    }

    function _fundAll(HavenEscrow escrow) internal {
        uint256 sum;
        uint256 n = escrow.milestoneCount();
        for (uint256 i = 0; i < n; i++) sum += escrow.milestone(i).amount;
        token.mint(address(escrow), sum);
        escrow.fund();
    }

    function _sign(
        address escrow,
        address signer,
        bytes32 action,
        bytes32 argsHash,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory) {
        return PqTestKeys.sign(
            signer, PqAuth.encodeMessage(block.chainid, escrow, signer, action, nonce, deadline, argsHash)
        );
    }

    function _authDeadline() internal view returns (uint256) {
        return block.timestamp + 1 hours;
    }

    function _junk() internal pure returns (bytes memory sig) {
        sig = new bytes(PqAuth.SIG_LEN);
    }

    function _deliver(HavenEscrow escrow, uint256 m, bytes32 commitment) internal {
        (, uint256 nonce,) = escrow.nonces();
        uint256 deadline = _authDeadline();
        escrow.deliver(
            m,
            commitment,
            deadline,
            _sign(address(escrow), Actors.FREELANCER, EscrowArgs.DELIVER, EscrowArgs.deliverArgs(m, commitment), nonce, deadline)
        );
    }

    function _release(HavenEscrow escrow, uint256 m) internal {
        (uint256 nonce,,) = escrow.nonces();
        uint256 deadline = _authDeadline();
        uint256 amount = escrow.milestone(m).amount;
        escrow.release(
            m,
            deadline,
            _sign(address(escrow), Actors.CLIENT, EscrowArgs.RELEASE, EscrowArgs.releaseArgs(m, amount), nonce, deadline)
        );
    }

    function _dispute(HavenEscrow escrow, uint256 m, bool byClient) internal {
        uint256 nonce;
        address signer;
        if (byClient) {
            (nonce,,) = escrow.nonces();
            signer = Actors.CLIENT;
        } else {
            (, nonce,) = escrow.nonces();
            signer = Actors.FREELANCER;
        }
        uint256 deadline = _authDeadline();
        escrow.dispute(
            m,
            byClient,
            deadline,
            _sign(address(escrow), signer, EscrowArgs.DISPUTE, EscrowArgs.disputeArgs(m, byClient), nonce, deadline)
        );
    }

    function _resolve(HavenEscrow escrow, uint256 m, uint16 bps) internal {
        (,, uint256 nonce) = escrow.nonces();
        uint256 deadline = _authDeadline();
        bytes32 args = EscrowArgs.resolveArgs(m, bps);
        bytes32 action = PqQuorum.quorumAction(EscrowArgs.RESOLVE);
        address[] memory who = new address[](2);
        bytes[] memory sigs = new bytes[](2);
        who[0] = Actors.A0;
        who[1] = Actors.A1;
        sigs[0] = _sign(address(escrow), Actors.A0, action, args, nonce, deadline);
        sigs[1] = _sign(address(escrow), Actors.A1, action, args, nonce, deadline);
        escrow.resolve(m, bps, deadline, who, sigs);
    }

    function _cancel(HavenEscrow escrow, uint256 m) internal {
        (uint256 clientNonce, uint256 freelancerNonce,) = escrow.nonces();
        uint256 deadline = _authDeadline();
        bytes32 args = EscrowArgs.cancelArgs(m);
        escrow.cancel(
            m,
            deadline,
            _sign(address(escrow), Actors.CLIENT, EscrowArgs.CANCEL, args, clientNonce, deadline),
            _sign(address(escrow), Actors.FREELANCER, EscrowArgs.CANCEL, args, freelancerNonce, deadline)
        );
    }
}
