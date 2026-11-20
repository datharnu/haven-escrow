// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice Records every transfer so tests can see who was paid.
contract MockERC20 {
    struct Move {
        address from;
        address to;
        uint256 amount;
    }

    mapping(address => uint256) public balanceOf;
    Move[] public transfers;

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function transfer(address account, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[account] += amount;
        transfers.push(Move(msg.sender, account, amount));
        return true;
    }

    function transferCount() external view returns (uint256) {
        return transfers.length;
    }
}
