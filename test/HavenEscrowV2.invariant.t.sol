// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {PqAuth} from "haven-pq-kit/PqAuth.sol";
import {PqQuorum} from "haven-pq-kit/PqQuorum.sol";
import {PqTestKeys} from "haven-pq-kit-test/PqTestKeys.sol";
import {HavenEscrowV2} from "../src/HavenEscrowV2.sol";
import {EscrowArgs} from "../src/EscrowArgs.sol";
import {DeliveryReceipts} from "./courier/DeliveryReceipts.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {Actors} from "./Actors.sol";
import {FixtureV2} from "./FixtureV2.sol";

contract HandlerV2 is Test {
    uint256 internal constant COUNT = 3;
    bytes32 internal constant CONVERSATION = keccak256("haven-escrow.receipt-gate.test");

    HavenEscrowV2 public immutable escrow;
    MockERC20 public immutable token;
    DeliveryReceipts public immutable receipts;
    address public immutable stranger;

    uint256 public ghostDeposited;
    uint256 public badAutoRelease;
    uint256 public badTimeoutSplit;
    uint256 public refundAfterDelivery;
    mapping(uint256 => uint256) public payouts;
    mapping(uint256 => uint256) public paid;
    mapping(uint256 => bool) public everDelivered;
    mapping(uint256 => uint256) public ackCounter;
    uint256 public nextCounter;
    uint256 public acked;
    mapping(uint256 => uint8) internal deliveredFile;
    mapping(uint256 => uint256) internal lastCounter;
    mapping(uint256 => uint256) internal clientCounter;

    constructor(HavenEscrowV2 escrow_, MockERC20 token_, DeliveryReceipts receipts_, address stranger_) {
        escrow = escrow_;
        token = token_;
        receipts = receipts_;
        stranger = stranger_;
    }

    function fund(uint128 amount) external {
        amount = uint128(bound(amount, 0, 5000));
        if (amount != 0) {
            token.mint(address(escrow), amount);
            ghostDeposited += amount;
        }
        try escrow.fund() {} catch {}
    }

    /// @dev A structured commitment over one of three files, or a raw word.
    function deliver(uint256 m, uint8 file, bool structured, bytes32 raw) external {
        m %= COUNT;
        bytes32 commitment = structured ? keccak256(abi.encode(address(escrow), m, parts(file))) : raw;
        if (commitment == bytes32(0)) commitment = bytes32(uint256(1));
        uint256 deadline = block.timestamp + 1 hours;
        (, uint256 nonce,) = escrow.nonces();
        bytes memory sig = _signed(Actors.FREELANCER, EscrowArgs.DELIVER, EscrowArgs.deliverArgs(m, commitment), nonce, deadline);
        try escrow.deliver(m, commitment, deadline, sig) {
            everDelivered[m] = true;
            deliveredFile[m] = file;
        } catch {}
    }

    /// @dev Someone stores a real receipt: the client, the freelancer, or a stranger, over this milestone's
    /// commitment, over the bare ciphertext hash, or over another milestone's commitment.
    function recordReceipt(uint256 m, uint8 who, uint8 what) external {
        m = _aim(m);
        address signer = who % 4 < 2 ? Actors.CLIENT : who % 4 == 2 ? Actors.FREELANCER : stranger;
        bytes32 committed = escrow.milestone(m).commitment;
        bytes32 hash;
        if (what % 4 < 2) hash = committed;
        else if (what % 4 == 2) hash = parts(what)[0];
        else hash = escrow.milestone((m + 1) % COUNT).commitment;
        if (hash == bytes32(0)) hash = keccak256("empty");
        uint256 counter = nextCounter++;
        lastCounter[m] = counter;
        if (signer == Actors.CLIENT && hash == committed) clientCounter[m] = counter;
        bytes memory sig = PqTestKeys.sign(signer, receipts.signingMessage(CONVERSATION, counter, hash, signer));
        receipts.record(CONVERSATION, counter, hash, signer, sig);
    }

    /// @dev Half the time it uses the last receipt stored for `m` and the file delivered there, so successes happen.
    function acknowledge(uint256 m, uint256 counter, uint8 file, bool aimed) external {
        m = aimed ? _aim(m) : m % COUNT;
        counter = nextCounter == 0 ? 0 : bound(counter, 0, nextCounter - 1);
        if (aimed) {
            counter = lastCounter[m];
            file = deliveredFile[m];
        }
        try escrow.acknowledge(m, CONVERSATION, counter, parts(file)) {
            ackCounter[m] = counter;
            acked += 1;
        } catch {}
    }

    function release(uint256 m) external {
        m %= COUNT;
        uint256 deadline = block.timestamp + 1 hours;
        (uint256 nonce,,) = escrow.nonces();
        uint256 amount = escrow.milestone(m).amount;
        bytes memory sig = _signed(Actors.CLIENT, EscrowArgs.RELEASE, EscrowArgs.releaseArgs(m, amount), nonce, deadline);
        try escrow.release(m, deadline, sig) {
            _paid(m, amount);
        } catch {}
    }

    /// @dev Exactly V1's rule: only after deliveredAt + reviewPeriod, receipt or not.
    function autoRelease(uint256 m) external {
        m %= COUNT;
        uint64 deliveredAt = escrow.milestone(m).deliveredAt;
        uint256 amount = escrow.milestone(m).amount;
        try escrow.autoRelease(m) {
            _paid(m, amount);
            if (block.timestamp <= uint256(deliveredAt) + escrow.reviewPeriod()) badAutoRelease += 1;
        } catch {}
    }

    function refund(uint256 m) external {
        m %= COUNT;
        uint256 amount = escrow.milestone(m).amount;
        try escrow.refund(m) {
            _paid(m, amount);
            if (everDelivered[m]) refundAfterDelivery += 1;
        } catch {}
    }

    function dispute(uint256 m, bool byClient) external {
        m = _first(m, HavenEscrowV2.Status.Delivered);
        uint256 deadline = block.timestamp + 1 hours;
        address signer = byClient ? Actors.CLIENT : Actors.FREELANCER;
        (uint256 clientNonce, uint256 freelancerNonce,) = escrow.nonces();
        bytes memory sig = _signed(
            signer, EscrowArgs.DISPUTE, EscrowArgs.disputeArgs(m, byClient), byClient ? clientNonce : freelancerNonce, deadline
        );
        try escrow.dispute(m, byClient, deadline, sig) {} catch {}
    }

    function resolve(uint256 m, uint16 bps) external {
        m %= COUNT;
        bps = uint16(bound(bps, 0, 10000));
        uint256 deadline = block.timestamp + 1 hours;
        uint256 amount = escrow.milestone(m).amount;
        (,, uint256 nonce) = escrow.nonces();
        bytes32 action = PqQuorum.quorumAction(EscrowArgs.RESOLVE);
        bytes32 args = EscrowArgs.resolveArgs(m, bps);
        address[] memory who = new address[](2);
        bytes[] memory sigs = new bytes[](2);
        who[0] = Actors.A0;
        who[1] = Actors.A1;
        sigs[0] = _signed(Actors.A0, action, args, nonce, deadline);
        sigs[1] = _signed(Actors.A1, action, args, nonce, deadline);
        try escrow.resolve(m, bps, deadline, who, sigs) {
            _paid(m, amount);
        } catch {}
    }

    /// @dev A silent panel pays receivedSplitBps with the receipt on record, defaultSplitBps without.
    /// @dev `freelancerFirst`: the freelancer records the client's last receipt on the escrow just before calling.
    function resolveTimeout(uint256 m, bool freelancerFirst) external {
        m = _first(m, HavenEscrowV2.Status.Disputed);
        if (freelancerFirst) {
            try escrow.acknowledge(m, CONVERSATION, clientCounter[m], parts(deliveredFile[m])) {
                ackCounter[m] = clientCounter[m];
                acked += 1;
            } catch {}
        }
        uint256 amount = escrow.milestone(m).amount;
        bool received = escrow.milestone(m).receivedAt != 0;
        uint256 before = escrow.paidToFreelancer();
        try escrow.resolveTimeout(m) {
            _paid(m, amount);
            uint256 bps = received ? escrow.receivedSplitBps() : escrow.defaultSplitBps();
            if (escrow.paidToFreelancer() - before != amount * bps / 10000) badTimeoutSplit += 1;
        } catch {}
    }

    function warp(uint64 delta) external {
        vm.warp(block.timestamp + bound(delta, 0, 4 days));
    }

    function parts(uint8 file) public pure returns (bytes32[5] memory out) {
        for (uint256 i = 0; i < 5; i++) out[i] = keccak256(abi.encode("file", file % 3, i));
    }

    /// @dev Prefers a milestone that is Delivered or Disputed, so receipts and acknowledgements land on live milestones.
    function _aim(uint256 m) internal view returns (uint256) {
        for (uint256 i = 0; i < COUNT; i++) {
            uint256 j = (m % COUNT + i) % COUNT;
            HavenEscrowV2.Status status = escrow.milestone(j).status;
            if (status == HavenEscrowV2.Status.Delivered || status == HavenEscrowV2.Status.Disputed) return j;
        }
        return m % COUNT;
    }

    /// @dev The first milestone at `status`, starting from `m`; otherwise `m`.
    function _first(uint256 m, HavenEscrowV2.Status status) internal view returns (uint256) {
        for (uint256 i = 0; i < COUNT; i++) {
            uint256 j = (m % COUNT + i) % COUNT;
            if (escrow.milestone(j).status == status) return j;
        }
        return m % COUNT;
    }

    function _paid(uint256 m, uint256 amount) internal {
        payouts[m] += 1;
        paid[m] += amount;
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
}

contract HavenEscrowV2InvariantTest is FixtureV2 {
    HandlerV2 internal handler;
    HavenEscrowV2 internal escrow;

    function setUp() public override {
        super.setUp();
        uint128[] memory amounts = new uint128[](3);
        uint64[] memory deadlines = new uint64[](3);
        amounts[0] = 100;
        amounts[1] = 250;
        amounts[2] = 400;
        for (uint256 i = 0; i < 3; i++) deadlines[i] = uint64(block.timestamp + 20 days);
        escrow = new HavenEscrowV2(_v2Terms(_terms(amounts, deadlines)), address(receipts));
        handler = new HandlerV2(escrow, token, receipts, STRANGER);
        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](11);
        selectors[0] = HandlerV2.fund.selector;
        selectors[1] = HandlerV2.deliver.selector;
        selectors[2] = HandlerV2.recordReceipt.selector;
        selectors[3] = HandlerV2.acknowledge.selector;
        selectors[4] = HandlerV2.release.selector;
        selectors[5] = HandlerV2.autoRelease.selector;
        selectors[6] = HandlerV2.refund.selector;
        selectors[7] = HandlerV2.dispute.selector;
        selectors[8] = HandlerV2.resolve.selector;
        selectors[9] = HandlerV2.resolveTimeout.selector;
        selectors[10] = HandlerV2.warp.selector;
        targetSelector(StdInvariant.FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_v2FundsOnlyReachParties() public view {
        uint256 n = token.transferCount();
        for (uint256 i = 0; i < n; i++) {
            (address from, address to, uint256 amount) = token.transfers(i);
            if (from == address(escrow) && amount != 0) assertTrue(to == Actors.CLIENT || to == Actors.FREELANCER);
        }
    }

    function invariant_v2Conservation() public view {
        assertEq(
            handler.ghostDeposited(), token.balanceOf(address(escrow)) + escrow.paidToClient() + escrow.paidToFreelancer()
        );
    }

    function invariant_v2NoDoublePayment() public view {
        for (uint256 i = 0; i < 3; i++) {
            assertLe(handler.payouts(i), 1);
            if (handler.payouts(i) == 1) assertEq(handler.paid(i), escrow.milestone(i).amount);
        }
    }

    /// @dev A started clock always points at a stored receipt from the client over that milestone's commitment.
    function invariant_receivedMeansClientReceipt() public view {
        for (uint256 i = 0; i < 3; i++) {
            HavenEscrowV2.Milestone memory ms = escrow.milestone(i);
            if (ms.receivedAt == 0) continue;
            (, uint256 recordedAt) = receipts.receipt(
                keccak256("haven-escrow.receipt-gate.test"), handler.ackCounter(i), ms.commitment, Actors.CLIENT
            );
            assertGt(recordedAt, 0);
            assertEq(keccak256(abi.encode(address(escrow), i, handler.parts(0))) == ms.commitment
                || keccak256(abi.encode(address(escrow), i, handler.parts(1))) == ms.commitment
                || keccak256(abi.encode(address(escrow), i, handler.parts(2))) == ms.commitment, true);
        }
    }

    function invariant_autoReleaseOnlyAfterReview() public view {
        assertEq(handler.badAutoRelease(), 0);
    }

    function invariant_silentPanelSplitFollowsReceipt() public view {
        assertEq(handler.badTimeoutSplit(), 0);
    }

    function invariant_noRefundAfterDelivery() public view {
        assertEq(handler.refundAfterDelivery(), 0);
    }
}
