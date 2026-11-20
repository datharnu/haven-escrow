// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {PqAuth} from "haven-pq-kit/PqAuth.sol";

/// @notice Thrown away by the spike. Not part of Haven Escrow.
contract SpikeChild {}

/// @notice Spike only. Not part of Haven Escrow. See docs/spikes.md.
contract SpikeTarget {
    using PqAuth for PqAuth.Signer;

    PqAuth.Signer internal owner_;
    uint256 public pings;
    bytes32 public constant PING = keccak256("haven-escrow.spike.ping");

    constructor(address owner) {
        owner_.init(owner);
    }

    function nonce() external view returns (uint256) {
        return owner_.nonce;
    }

    function ping(uint256 deadline, bytes calldata sig) external {
        owner_.authorize(PING, keccak256(abi.encode(pings)), deadline, 1 days, sig);
        pings += 1;
    }

    function spawn() external returns (address child) {
        child = address(new SpikeChild());
    }
}
