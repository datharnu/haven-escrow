// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {PqQuorum} from "haven-pq-kit/PqQuorum.sol";
import {PqTestKeys} from "haven-pq-kit-test/PqTestKeys.sol";
import {HavenEscrow} from "../src/HavenEscrow.sol";
import {HavenEscrowV2} from "../src/HavenEscrowV2.sol";
import {EscrowArgs} from "../src/EscrowArgs.sol";
import {DeliveryReceipts} from "./courier/DeliveryReceipts.sol";
import {Actors} from "./Actors.sol";
import {Fixture} from "./Fixture.sol";

/// @notice Fixture plus Courier's real `DeliveryReceipts` code over the same mock precompiles.
abstract contract FixtureV2 is Fixture {
    /// @dev A registered ML-DSA-87 account that is not a party or an arbiter. Plays Courier's Carol.
    address internal constant STRANGER = address(0x5EE);
    bytes32 internal constant CONVERSATION = keccak256("haven-escrow.receipt-gate.test");

    DeliveryReceipts internal receipts;

    function setUp() public virtual override {
        super.setUp();
        _register(STRANGER);
        receipts = new DeliveryReceipts();
    }

    /// @dev V1 terms plus `receivedSplitBps = 10000`: a silent panel pays the freelancer in full once the receipt is on record.
    function _v2Terms(HavenEscrow.Terms memory t) internal pure returns (HavenEscrowV2.Terms memory) {
        return HavenEscrowV2.Terms({
            client: t.client,
            freelancer: t.freelancer,
            token: t.token,
            arbiters: t.arbiters,
            reviewPeriod: t.reviewPeriod,
            arbiterTimeout: t.arbiterTimeout,
            defaultSplitBps: t.defaultSplitBps,
            receivedSplitBps: 10000,
            amounts: t.amounts,
            deadlines: t.deadlines
        });
    }

    function _v2(uint128 amount) internal returns (HavenEscrowV2) {
        return new HavenEscrowV2(_v2Terms(_one(amount, uint64(block.timestamp + 7 days))), address(receipts));
    }

    function _v2Many(uint256 n, uint128 amount) internal returns (HavenEscrowV2) {
        uint128[] memory amounts = new uint128[](n);
        uint64[] memory deadlines = new uint64[](n);
        for (uint256 i = 0; i < n; i++) {
            amounts[i] = amount;
            deadlines[i] = uint64(block.timestamp + 7 days);
        }
        return new HavenEscrowV2(_v2Terms(_terms(amounts, deadlines)), address(receipts));
    }

    function _fundV2(HavenEscrowV2 escrow) internal {
        uint256 sum;
        uint256 n = escrow.milestoneCount();
        for (uint256 i = 0; i < n; i++) sum += escrow.milestone(i).amount;
        token.mint(address(escrow), sum);
        escrow.fund();
    }

    /// @dev The five hashes `commitmentOf` binds: ciphertext, client envelope, three arbiter envelopes.
    function _parts(string memory tag) internal pure returns (bytes32[5] memory parts) {
        for (uint256 i = 0; i < 5; i++) parts[i] = keccak256(abi.encode(tag, i));
    }

    function _commitment(address escrow, uint256 m, bytes32[5] memory parts) internal pure returns (bytes32) {
        return keccak256(abi.encode(escrow, m, parts));
    }

    /// @dev `signer` signs Courier's receipt message naming `recipient`, and anyone submits it.
    function _record(address signer, address recipient, uint256 counter, bytes32 hash) internal {
        bytes memory message = receipts.signingMessage(CONVERSATION, counter, hash, recipient);
        receipts.record(CONVERSATION, counter, hash, recipient, PqTestKeys.sign(signer, message));
    }

    function _clientReceipt(uint256 counter, bytes32 hash) internal {
        _record(Actors.CLIENT, Actors.CLIENT, counter, hash);
    }

    function _deliverV2(HavenEscrowV2 escrow, uint256 m, bytes32 commitment) internal {
        (, uint256 nonce,) = escrow.nonces();
        uint256 deadline = _authDeadline();
        escrow.deliver(
            m,
            commitment,
            deadline,
            _sign(address(escrow), Actors.FREELANCER, EscrowArgs.DELIVER, EscrowArgs.deliverArgs(m, commitment), nonce, deadline)
        );
    }

    /// @dev Delivers the commitment of `parts` for (escrow, m) and returns it.
    function _deliverParts(HavenEscrowV2 escrow, uint256 m, bytes32[5] memory parts) internal returns (bytes32 c) {
        c = _commitment(address(escrow), m, parts);
        _deliverV2(escrow, m, c);
    }

    function _releaseV2(HavenEscrowV2 escrow, uint256 m) internal {
        (uint256 nonce,,) = escrow.nonces();
        uint256 deadline = _authDeadline();
        uint256 amount = escrow.milestone(m).amount;
        escrow.release(
            m,
            deadline,
            _sign(address(escrow), Actors.CLIENT, EscrowArgs.RELEASE, EscrowArgs.releaseArgs(m, amount), nonce, deadline)
        );
    }

    function _disputeV2(HavenEscrowV2 escrow, uint256 m, bool byClient) internal {
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

    function _resolveV2(HavenEscrowV2 escrow, uint256 m, uint16 bps) internal {
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

    function _cancelV2(HavenEscrowV2 escrow, uint256 m) internal {
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

    function _status(HavenEscrowV2 escrow, uint256 m) internal view returns (HavenEscrowV2.Status) {
        return escrow.milestone(m).status;
    }
}
