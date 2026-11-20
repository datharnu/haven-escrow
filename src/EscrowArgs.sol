// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice The only place a Haven Escrow authorisation hash is built.
library EscrowArgs {
    bytes32 internal constant DELIVER = keccak256("haven-escrow.deliver");
    bytes32 internal constant RELEASE = keccak256("haven-escrow.release");
    bytes32 internal constant DISPUTE = keccak256("haven-escrow.dispute");
    bytes32 internal constant CANCEL = keccak256("haven-escrow.cancel");
    bytes32 internal constant RESOLVE = keccak256("haven-escrow.resolve");

    function deliverArgs(uint256 m, bytes32 commitment) internal pure returns (bytes32) {
        return keccak256(abi.encode(m, commitment));
    }

    function releaseArgs(uint256 m, uint256 amount) internal pure returns (bytes32) {
        return keccak256(abi.encode(m, amount));
    }

    function disputeArgs(uint256 m, bool byClient) internal pure returns (bytes32) {
        return keccak256(abi.encode(m, byClient));
    }

    function cancelArgs(uint256 m) internal pure returns (bytes32) {
        return keccak256(abi.encode(m));
    }

    function resolveArgs(uint256 m, uint16 splitBps) internal pure returns (bytes32) {
        return keccak256(abi.encode(m, splitBps));
    }
}
