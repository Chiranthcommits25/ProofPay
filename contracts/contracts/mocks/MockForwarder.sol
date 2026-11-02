// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

contract MockForwarder {
    function forwardReport(address receiver, bytes calldata metadata, bytes calldata report) external {
        IReceiver(receiver).onReport(metadata, report);
    }
}
