// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PqAuth} from "haven-pq-kit/PqAuth.sol";
import {PqQuorum} from "haven-pq-kit/PqQuorum.sol";
import {EscrowArgs} from "../src/EscrowArgs.sol";

contract VectorsTest is Test {
    function test_vectorsMatchEscrowArgs() public view {
        string memory json = vm.readFile("vectors/escrow.json");
        bytes32 commitment = keccak256("haven-escrow.vectors.commitment");
        address escrow = address(0x3333333333333333333333333333333333333333);
        address client = address(0x1111111111111111111111111111111111111111);
        address freelancer = address(0x2222222222222222222222222222222222222222);

        assertEq(vm.parseJsonUint(json, ".chainId"), 9800);
        assertEq(vm.parseJsonUint(json, ".m"), 1);
        assertEq(vm.parseJsonUint(json, ".amount"), 1_000_000);
        assertEq(vm.parseJsonUint(json, ".splitBps"), 7000);
        assertEq(vm.parseJsonUint(json, ".nonce"), 4);
        assertEq(vm.parseJsonUint(json, ".deadline"), 1_700_003_600);
        assertEq(vm.parseJsonAddress(json, ".escrow"), escrow);
        assertEq(vm.parseJsonAddress(json, ".client"), client);
        assertEq(vm.parseJsonAddress(json, ".freelancer"), freelancer);
        assertEq(vm.parseJsonBytes32(json, ".commitment"), commitment);

        assertEq(vm.parseJsonBytes32(json, ".actions.deliver"), EscrowArgs.DELIVER);
        assertEq(vm.parseJsonBytes32(json, ".actions.release"), EscrowArgs.RELEASE);
        assertEq(vm.parseJsonBytes32(json, ".actions.dispute"), EscrowArgs.DISPUTE);
        assertEq(vm.parseJsonBytes32(json, ".actions.cancel"), EscrowArgs.CANCEL);
        assertEq(vm.parseJsonBytes32(json, ".actions.resolve"), EscrowArgs.RESOLVE);

        assertEq(vm.parseJsonBytes32(json, ".args.deliver"), EscrowArgs.deliverArgs(1, commitment));
        assertEq(vm.parseJsonBytes32(json, ".args.release"), EscrowArgs.releaseArgs(1, 1_000_000));
        assertEq(vm.parseJsonBytes32(json, ".args.disputeByClient"), EscrowArgs.disputeArgs(1, true));
        assertEq(vm.parseJsonBytes32(json, ".args.disputeByFreelancer"), EscrowArgs.disputeArgs(1, false));
        assertEq(vm.parseJsonBytes32(json, ".args.cancel"), EscrowArgs.cancelArgs(1));
        assertEq(vm.parseJsonBytes32(json, ".args.resolve"), EscrowArgs.resolveArgs(1, 7000));
        assertEq(vm.parseJsonBytes32(json, ".quorumAction"), PqQuorum.quorumAction(EscrowArgs.RESOLVE));

        uint256 nonce = 4;
        uint256 deadline = 1_700_003_600;
        assertEq(
            vm.parseJsonBytes(json, ".messages.deliver"),
            PqAuth.encodeMessage(9800, escrow, freelancer, EscrowArgs.DELIVER, nonce, deadline, EscrowArgs.deliverArgs(1, commitment))
        );
        assertEq(
            vm.parseJsonBytes(json, ".messages.release"),
            PqAuth.encodeMessage(9800, escrow, client, EscrowArgs.RELEASE, nonce, deadline, EscrowArgs.releaseArgs(1, 1_000_000))
        );
        assertEq(
            vm.parseJsonBytes(json, ".messages.disputeByClient"),
            PqAuth.encodeMessage(9800, escrow, client, EscrowArgs.DISPUTE, nonce, deadline, EscrowArgs.disputeArgs(1, true))
        );
        assertEq(
            vm.parseJsonBytes(json, ".messages.disputeByFreelancer"),
            PqAuth.encodeMessage(
                9800, escrow, freelancer, EscrowArgs.DISPUTE, nonce, deadline, EscrowArgs.disputeArgs(1, false)
            )
        );
        assertEq(
            vm.parseJsonBytes(json, ".messages.cancelClient"),
            PqAuth.encodeMessage(9800, escrow, client, EscrowArgs.CANCEL, nonce, deadline, EscrowArgs.cancelArgs(1))
        );
        assertEq(
            vm.parseJsonBytes(json, ".messages.cancelFreelancer"),
            PqAuth.encodeMessage(9800, escrow, freelancer, EscrowArgs.CANCEL, nonce, deadline, EscrowArgs.cancelArgs(1))
        );
    }
}
