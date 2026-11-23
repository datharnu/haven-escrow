// SPDX-License-Identifier: Apache-2.0
// Test copy of Courier src/DeliveryReceipts.sol. Only these comment lines were added
// (github.com/datharnu/courier, commit ca98ee7). The deployed 0x06b52afc4a151b0efa260e2adcdf2d477632cb56 has
// runtime code keccak 0xcedfc1642c2ec50dc06b3b67975ebfbb6938204aa8a8774dba19769e9114391f, equal to Courier's own build
// of that source (checked 23 November 2026). scripts/deploy-v2.ts re-checks that hash before it deploys.
pragma solidity 0.8.28;

import {PqAuth} from "haven-pq-kit/PqAuth.sol";

/// @notice Optional on-chain delivery receipts for Courier messages.
/// @dev A recipient signs `(DOMAIN, chainid, conversationId, counter, ciphertextHash, recipient)`
/// with their on-chain ML-DSA-87 key. The sender (or anyone holding the ack) can submit it here
/// to prove delivery without revealing any plaintext.
contract DeliveryReceipts {
    bytes32 public constant DOMAIN = keccak256("courier.receipt.v1");

    struct Record {
        address submitter;
        address recipient;
        uint256 recordedAt;
    }

    mapping(bytes32 => Record) private receipts;
    uint256 public count;

    event Delivered(
        bytes32 indexed conversationId,
        uint256 indexed counter,
        bytes32 indexed ciphertextHash,
        address recipient,
        address submitter
    );

    error ZeroWord();
    error ZeroRecipient();
    error AlreadyRecorded(bytes32 receiptId);

    function signingMessage(
        bytes32 conversationId,
        uint256 counter,
        bytes32 ciphertextHash,
        address recipient
    ) public view returns (bytes memory) {
        return abi.encode(DOMAIN, block.chainid, conversationId, counter, ciphertextHash, recipient);
    }

    function receiptKey(
        bytes32 conversationId,
        uint256 counter,
        bytes32 ciphertextHash,
        address recipient
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(conversationId, counter, ciphertextHash, recipient));
    }

    /// @notice Verify the recipient's ML-DSA-87 acknowledgement and record proof of delivery.
    function record(
        bytes32 conversationId,
        uint256 counter,
        bytes32 ciphertextHash,
        address recipient,
        bytes calldata signature
    ) external {
        if (conversationId == bytes32(0) || ciphertextHash == bytes32(0)) revert ZeroWord();
        if (recipient == address(0)) revert ZeroRecipient();
        bytes32 id = receiptKey(conversationId, counter, ciphertextHash, recipient);
        if (receipts[id].recordedAt != 0) revert AlreadyRecorded(id);
        PqAuth.verify(recipient, signingMessage(conversationId, counter, ciphertextHash, recipient), signature);
        receipts[id] = Record({submitter: msg.sender, recipient: recipient, recordedAt: block.timestamp});
        count += 1;
        emit Delivered(conversationId, counter, ciphertextHash, recipient, msg.sender);
    }

    function receipt(
        bytes32 conversationId,
        uint256 counter,
        bytes32 ciphertextHash,
        address recipient
    ) external view returns (address submitter, uint256 recordedAt) {
        Record storage item = receipts[receiptKey(conversationId, counter, ciphertextHash, recipient)];
        return (item.submitter, item.recordedAt);
    }
}
