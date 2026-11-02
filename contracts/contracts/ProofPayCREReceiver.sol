// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

interface IEscrowSettlement {
    function confirmDelivery(bytes32 orderId) external;
    function confirmFailure(bytes32 orderId) external;
    function getEscrow(bytes32 orderId)
        external
        view
        returns (
            bytes32 orderIdEscrow,
            address buyer,
            address seller,
            uint256 amount,
            uint64 createdAt,
            uint64 settledAt,
            uint8 status
        );
}

interface IReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

contract ProofPayCREReceiver is IReceiver, IERC165, Ownable {
    enum EscrowStatus {
        None,
        Funded,
        Released,
        Refunded
    }

    IEscrowSettlement public immutable escrow;

    // Authorized forwarder that delivers CRE reports
    address public forwarder;

    // Authorized oracle for backward compatibility (manual settlement)
    address public manualOracle;

    // Track processed reports to prevent replay
    mapping(bytes32 => bool) public processedReports;

    // Track settled orders to prevent duplicate processing
    mapping(bytes32 => bool) public orderSettled;

    event ForwarderUpdated(address indexed previousForwarder, address indexed newForwarder);
    event ManualOracleUpdated(address indexed previousOracle, address indexed newOracle);
    event ReportProcessed(bytes32 indexed orderId, string outcome, bytes32 indexed reportId);
    event SettlementExecuted(bytes32 indexed orderId, bool released);

    error UnauthorizedCaller(address caller);
    error InvalidForwarder();
    error InvalidOracle();
    error ReportAlreadyProcessed(bytes32 reportId);
    error OrderAlreadySettled(bytes32 orderId);
    error EscrowNotFunded(bytes32 orderId);
    error EscrowNotFound(bytes32 orderId);
    error UnsupportedOutcome(string outcome);
    error InvalidReportData();

    constructor(address escrowAddress, address initialOwner, address initialForwarder, address initialManualOracle)
        Ownable(initialOwner)
    {
        if (escrowAddress == address(0)) {
            revert InvalidForwarder();
        }
        escrow = IEscrowSettlement(escrowAddress);
        if (initialForwarder != address(0)) {
            forwarder = initialForwarder;
        }
        if (initialManualOracle != address(0)) {
            manualOracle = initialManualOracle;
        }
    }

    modifier onlyAuthorized() {
        if (msg.sender == forwarder) {
            _;
            return;
        }
        if (manualOracle != address(0) && msg.sender == manualOracle) {
            _;
            return;
        }
        // Also allow owner for testing if no forwarder set (but forwarder auth should not be disabled)
        if (owner() == msg.sender && forwarder == address(0)) {
            _;
            return;
        }
        revert UnauthorizedCaller(msg.sender);
    }

    function setForwarder(address newForwarder) external onlyOwner {
        if (newForwarder == address(0)) {
            revert InvalidForwarder();
        }
        address previousForwarder = forwarder;
        forwarder = newForwarder;
        emit ForwarderUpdated(previousForwarder, newForwarder);
    }

    function setManualOracle(address newOracle) external onlyOwner {
        address previousOracle = manualOracle;
        manualOracle = newOracle;
        emit ManualOracleUpdated(previousOracle, newOracle);
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    function onReport(bytes calldata metadata, bytes calldata report) external override onlyAuthorized {
        _processReport(metadata, report);
    }

    function processReport(bytes calldata metadata, bytes calldata report) external onlyAuthorized {
        _processReport(metadata, report);
    }

    function _processReport(bytes calldata metadata, bytes calldata report) internal {
        // Decode report: (bytes32 orderId, string outcome, bytes32 trackingIdHash, string observedAt)
        (
            bytes32 orderId,
            string memory outcome,
            bytes32 trackingIdHash,
            string memory observedAt
        ) = abi.decode(report, (bytes32, string, bytes32, string));

        if (orderId == bytes32(0)) {
            revert InvalidReportData();
        }

        // Generate report ID for replay protection
        bytes32 reportId = keccak256(abi.encodePacked(orderId, outcome, trackingIdHash, observedAt, metadata));
        if (processedReports[reportId]) {
            revert ReportAlreadyProcessed(reportId);
        }
        if (orderSettled[orderId]) {
            revert OrderAlreadySettled(orderId);
        }

        // Verify escrow is still funded
        try this._checkEscrowFunded(orderId) returns (bool funded) {
            if (!funded) {
                revert EscrowNotFunded(orderId);
            }
        } catch {
            revert EscrowNotFound(orderId);
        }

        // Process based on outcome
        bytes32 outcomeHash = keccak256(bytes(outcome));
        if (outcomeHash == keccak256(bytes("DELIVERED"))) {
            escrow.confirmDelivery(orderId);
            processedReports[reportId] = true;
            orderSettled[orderId] = true;
            emit ReportProcessed(orderId, outcome, reportId);
            emit SettlementExecuted(orderId, true);
        } else if (outcomeHash == keccak256(bytes("LOST"))) {
            escrow.confirmFailure(orderId);
            processedReports[reportId] = true;
            orderSettled[orderId] = true;
            emit ReportProcessed(orderId, outcome, reportId);
            emit SettlementExecuted(orderId, false);
        } else {
            revert UnsupportedOutcome(outcome);
        }
    }

    function _checkEscrowFunded(bytes32 orderId) external view returns (bool) {
        (
            ,
            ,
            ,
            ,
            ,
            ,
            uint8 status
        ) = escrow.getEscrow(orderId);
        return status == uint8(EscrowStatus.Funded);
    }
}
