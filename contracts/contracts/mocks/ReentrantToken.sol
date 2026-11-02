// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ProofPayEscrow} from "../ProofPayEscrow.sol";

contract ReentrantToken is ERC20 {
    ProofPayEscrow public escrow;
    bytes32 public reentryOrderId;
    address public reentrySeller;
    uint256 public reentryAmount;
    bool public reentryEnabled;

    constructor() ERC20("Reentrant Token", "RT") {
        _mint(address(this), 1_000_000 ether);
    }

    function configure(
        address escrowAddress,
        bytes32 orderId,
        address seller,
        uint256 amount
    ) external {
        escrow = ProofPayEscrow(escrowAddress);
        reentryOrderId = orderId;
        reentrySeller = seller;
        reentryAmount = amount;
        reentryEnabled = true;
    }

    function startEscrow(bytes32 orderId, address seller, uint256 amount) external {
        _approve(address(this), address(escrow), type(uint256).max);
        escrow.createEscrow(orderId, address(this), seller, amount);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (reentryEnabled) {
            reentryEnabled = false;
            escrow.createEscrow(reentryOrderId, address(this), reentrySeller, reentryAmount);
        }
        return super.transferFrom(from, to, value);
    }
}
