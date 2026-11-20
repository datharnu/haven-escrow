// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {HavenEscrow} from "./HavenEscrow.sol";

/// @notice Deploys one HavenEscrow per deal. Creation does not move funds.
contract EscrowFactory {
    event EscrowCreated(address indexed escrow, address indexed client, address indexed freelancer, bytes32 termsHash);

    mapping(address => bool) public isEscrow;

    function create(HavenEscrow.Terms calldata t) external returns (address escrow) {
        bytes32 termsHash = keccak256(abi.encode(t));
        escrow = address(new HavenEscrow(t));
        isEscrow[escrow] = true;
        emit EscrowCreated(escrow, t.client, t.freelancer, termsHash);
    }
}
