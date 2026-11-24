// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice A token whose `transfer` can return false, revert, return no data, or call back into a target.
contract HostileToken {
    enum Mode {
        Normal,
        ReturnFalse,
        Revert,
        NoReturnData,
        Reenter
    }

    mapping(address => uint256) public balanceOf;
    Mode public mode;
    address public target;
    bytes public reenterCall;
    bool public reentered;
    bool public reenterOk;
    bytes public reenterResult;

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function setMode(Mode next) external {
        mode = next;
    }

    function setReenter(address target_, bytes calldata call) external {
        mode = Mode.Reenter;
        target = target_;
        reenterCall = call;
    }

    function transfer(address account, uint256 amount) external returns (bool) {
        if (mode == Mode.Revert) revert("token says no");
        if (mode == Mode.ReturnFalse) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[account] += amount;
        if (mode == Mode.Reenter && !reentered) {
            reentered = true;
            // Swallow the result so the test can read what the escrow said to a callback.
            (reenterOk, reenterResult) = target.call(reenterCall);
        }
        if (mode == Mode.NoReturnData) {
            assembly {
                return(0, 0)
            }
        }
        return true;
    }
}
