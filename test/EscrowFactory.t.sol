// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {HavenEscrow} from "../src/HavenEscrow.sol";
import {EscrowFactory} from "../src/EscrowFactory.sol";
import {Actors} from "./Actors.sol";
import {Fixture} from "./Fixture.sol";

contract EscrowFactoryTest is Fixture {
    function test_create_recordsEscrowAndTermsHash() public {
        EscrowFactory factory = new EscrowFactory();
        HavenEscrow.Terms memory t = _one(1_000_000, uint64(block.timestamp + 7 days));
        bytes32 termsHash = keccak256(abi.encode(t));

        vm.recordLogs();
        address escrow = factory.create(t);
        assertTrue(factory.isEscrow(escrow));
        assertFalse(factory.isEscrow(address(0x1234)));

        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        assertEq(logs[0].topics[0], EscrowFactory.EscrowCreated.selector);
        assertEq(logs[0].topics[1], bytes32(uint256(uint160(escrow))));
        assertEq(logs[0].topics[2], bytes32(uint256(uint160(Actors.CLIENT))));
        assertEq(logs[0].topics[3], bytes32(uint256(uint160(Actors.FREELANCER))));
        assertEq(abi.decode(logs[0].data, (bytes32)), termsHash);
        assertEq(HavenEscrow(escrow).client(), Actors.CLIENT);
    }
}
