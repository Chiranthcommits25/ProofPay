// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ProofPayEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum EscrowStatus {
        None,
        Funded,
        Released,
        Refunded
    }

    struct Escrow {
        bytes32 orderId;
        address buyer;
        address seller;
        uint256 amount;
        uint64 createdAt;
        uint64 settledAt;
        EscrowStatus status;
    }

    IERC20 public immutable paymentToken;
    address public oracle;

    mapping(bytes32 => Escrow) private _escrows;

    event EscrowCreated(
        bytes32 indexed orderId,
        address indexed buyer,
        address indexed seller,
        uint256 amount
    );
    event EscrowReleased(bytes32 indexed orderId, address indexed seller, uint256 amount);
    event EscrowRefunded(bytes32 indexed orderId, address indexed buyer, uint256 amount);
    event OracleUpdated(address indexed previousOracle, address indexed newOracle);

    error InvalidToken();
    error InvalidOrderId();
    error InvalidBuyer();
    error InvalidSeller();
    error SameBuyerAndSeller();
    error InvalidAmount();
    error InvalidOracle();
    error EscrowAlreadyExists(bytes32 orderId);
    error EscrowNotFound(bytes32 orderId);
    error EscrowNotFunded(bytes32 orderId);
    error UnauthorizedOracle(address caller);

    constructor(address tokenAddress, address initialOwner) Ownable(initialOwner) {
        if (tokenAddress == address(0) || tokenAddress.code.length == 0) {
            revert InvalidToken();
        }
        paymentToken = IERC20(tokenAddress);
    }

    modifier onlyOracle() {
        if (msg.sender != oracle) {
            revert UnauthorizedOracle(msg.sender);
        }
        _;
    }

    function setOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) {
            revert InvalidOracle();
        }
        address previousOracle = oracle;
        oracle = newOracle;
        emit OracleUpdated(previousOracle, newOracle);
    }

    function createEscrow(
        bytes32 orderId,
        address buyer,
        address seller,
        uint256 amount
    ) external nonReentrant {
        if (orderId == bytes32(0)) {
            revert InvalidOrderId();
        }
        if (buyer == address(0) || buyer != msg.sender) {
            revert InvalidBuyer();
        }
        if (seller == address(0)) {
            revert InvalidSeller();
        }
        if (buyer == seller) {
            revert SameBuyerAndSeller();
        }
        if (amount == 0) {
            revert InvalidAmount();
        }
        if (_escrows[orderId].status != EscrowStatus.None) {
            revert EscrowAlreadyExists(orderId);
        }

        _escrows[orderId] = Escrow({
            orderId: orderId,
            buyer: buyer,
            seller: seller,
            amount: amount,
            createdAt: uint64(block.timestamp),
            settledAt: 0,
            status: EscrowStatus.Funded
        });

        paymentToken.safeTransferFrom(buyer, address(this), amount);

        emit EscrowCreated(orderId, buyer, seller, amount);
    }

    function confirmDelivery(bytes32 orderId) external onlyOracle nonReentrant {
        Escrow storage escrow = _getFundedEscrow(orderId);

        escrow.status = EscrowStatus.Released;
        escrow.settledAt = uint64(block.timestamp);

        paymentToken.safeTransfer(escrow.seller, escrow.amount);

        emit EscrowReleased(orderId, escrow.seller, escrow.amount);
    }

    function confirmFailure(bytes32 orderId) external onlyOracle nonReentrant {
        Escrow storage escrow = _getFundedEscrow(orderId);

        escrow.status = EscrowStatus.Refunded;
        escrow.settledAt = uint64(block.timestamp);

        paymentToken.safeTransfer(escrow.buyer, escrow.amount);

        emit EscrowRefunded(orderId, escrow.buyer, escrow.amount);
    }

    function getEscrow(bytes32 orderId) external view returns (Escrow memory) {
        Escrow memory escrow = _escrows[orderId];
        if (escrow.status == EscrowStatus.None) {
            revert EscrowNotFound(orderId);
        }
        return escrow;
    }

    function _getFundedEscrow(bytes32 orderId) private view returns (Escrow storage escrow) {
        escrow = _escrows[orderId];
        if (escrow.status == EscrowStatus.None) {
            revert EscrowNotFound(orderId);
        }
        if (escrow.status != EscrowStatus.Funded) {
            revert EscrowNotFunded(orderId);
        }
    }
}
