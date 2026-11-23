// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice The one read HavenEscrowV2 makes on Courier's `DeliveryReceipts`.
/// @dev `record` stores a receipt only after `pqcVerify` accepts `recipient`'s registered ML-DSA-87 key over
/// `(keccak256("courier.receipt.v1"), chainid, conversationId, counter, ciphertextHash, recipient)`.
/// A stored receipt is never overwritten or deleted. `recordedAt` is 0 when no receipt is stored.
interface IDeliveryReceipts {
    function receipt(bytes32 conversationId, uint256 counter, bytes32 ciphertextHash, address recipient)
        external
        view
        returns (address submitter, uint256 recordedAt);
}
