// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {HavenEscrowV2} from "./HavenEscrowV2.sol";

/// @notice Deploys one HavenEscrowV2 per deal. Creation does not move funds.
/// @dev The `DeliveryReceipts` address is fixed here once, so a creator cannot point an escrow at another contract.
contract EscrowFactoryV2 {
    event EscrowCreated(address indexed escrow, address indexed client, address indexed freelancer, bytes32 termsHash);

    error NoReceiptsCode(address receipts);

    address public immutable receipts;
    mapping(address => bool) public isEscrow;

    constructor(address receipts_) {
        if (receipts_.code.length == 0) revert NoReceiptsCode(receipts_);
        receipts = receipts_;
    }

    function create(HavenEscrowV2.Terms calldata t) external returns (address escrow) {
        bytes32 termsHash = keccak256(abi.encode(t));
        escrow = address(new HavenEscrowV2(t, receipts));
        isEscrow[escrow] = true;
        emit EscrowCreated(escrow, t.client, t.freelancer, termsHash);
    }
}
