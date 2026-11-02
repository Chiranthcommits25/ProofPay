# ProofPay Smart Contracts

Escrow, payment-token and CRE receiver contracts for ProofPay, built with **Solidity**, **Hardhat** and **OpenZeppelin Contracts**.

## Contracts

### ProofPayUSD (pUSD)

A custom ERC-20 payment token:

- Name: `ProofPay USD`
- Symbol: `pUSD`
- Decimals: `18`
- Minting is restricted to the contract owner.
- Standard ERC-20 transfers and approvals are supported.

### ProofPayEscrow

The escrow contract holds pUSD until an authorized oracle settles an order.

- `createEscrow(bytes32 orderId, address buyer, address seller, uint256 amount)` transfers pUSD from the buyer into escrow. The buyer must be the caller, and each order ID can only be used once.
- `confirmDelivery(bytes32 orderId)` releases the escrowed pUSD to the seller.
- `confirmFailure(bytes32 orderId)` refunds the escrowed pUSD to the buyer.
- `setOracle(address newOracle)` updates the authorized oracle and is owner-only.
- `getEscrow(bytes32 orderId)` returns the stored escrow details.

Escrow states are `None`, `Funded`, `Released`, and `Refunded`.

Order IDs are `bytes32`. Short human-readable IDs can be encoded with `ethers.encodeBytes32String("PP-1001")`; production integrations can use a 32-byte hash instead.

The contract emits `EscrowCreated`, `EscrowReleased`, `EscrowRefunded`, and `OracleUpdated` events for off-chain indexing.

## Security Model

- `SafeERC20` is used for all token transfers.
- `ReentrancyGuard` protects state-changing escrow functions.
- `Ownable` restricts token minting, oracle changes, and ownership transfer.
- Only the configured oracle can release or refund funds.
- Settlement uses checks-effects-interactions and rejects duplicate settlement.
- Order IDs are unique and cannot be reused after settlement.
- Buyer, seller, amount, order ID, and payment-token addresses are validated.
- The owner cannot withdraw escrowed funds; only the oracle can trigger a settlement.
- The escrow contract only accepts a deployed contract as its payment token.

## Project Setup

Requirements: Node.js and npm. Tested with Node.js `v22.23.2` and npm `10.9.8`.

```bash
cd contracts
npm install
npm run compile
npm test
```

If Hardhat asks for telemetry consent, answer once in the terminal. For non-interactive runs, set `HARDHAT_DISABLE_TELEMETRY_PROMPT=true`.

## Local Deployment

Start a local Hardhat node in one terminal:

```bash
npm run node
```

Deploy the contracts in another terminal:

```bash
npm run deploy:local
```

The deployment script deploys pUSD, deploys the escrow with the pUSD address, sets the oracle, and mints an initial supply of `1,000,000 pUSD` to the deployer by default. Addresses are written to `deployments/localhost.json`.

### Current Local Deployment

- Network: `localhost` (`chainId: 31337`)
- Deployer / owner / oracle: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
- ProofPayUSD: `0x5FbDB2315678afecb367f032d93F642f64180aa3`
- ProofPayEscrow: `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`
- Initial supply: `1,000,000 pUSD`

These are ephemeral local addresses. Restarting the Hardhat node resets local state, so run `npm run deploy:local` again. A fresh node with the same deployer and deployment order produces the same addresses.

## Sepolia Deployment

Create `contracts/.env` from `.env.example` and configure:

```bash
cp .env.example .env
```

```dotenv
SEPOLIA_RPC_URL=https://rpc.sepolia.org
PRIVATE_KEY=0x...
CONTRACT_OWNER=
ORACLE_ADDRESS=
INITIAL_MINT_RECIPIENT=
INITIAL_MINT=1000000
```

Blank `CONTRACT_OWNER`, `ORACLE_ADDRESS`, and `INITIAL_MINT_RECIPIENT` values default to the deployer address. Set `INITIAL_MINT=0` to skip the initial mint.

Deploy:

```bash
npm run deploy:sepolia
```

The result is saved to `deployments/sepolia.json`. For production, use a dedicated owner (for example, a multisig) and a dedicated oracle address rather than the deployer.

## Test Coverage

Run:

```bash
npm test
```

The suite contains 31 passing tests covering:

- Token metadata, decimals, owner-only minting, approvals, transfers, and invalid addresses.
- Escrow deployment validation and oracle configuration.
- Funded escrow creation and pUSD custody.
- Duplicate order ID rejection.
- Buyer, seller, amount, and order ID validation.
- Missing allowance and insufficient balance handling.
- Delivery release to the seller.
- Failure refund to the buyer.
- Unauthorized oracle calls.
- Unknown order handling.
- Duplicate settlement and settled-order reuse prevention.
- Oracle rotation.
- Independent settlement of multiple escrows.
- Reentrancy protection using a malicious token mock.

## Chainlink CRE Integration

The escrow exposes the trust boundary that the Chainlink CRE pipeline uses:

1. The CRE workflow monitors the shipment API for a delivery or loss result.
2. The workflow maps that result to the escrow `orderId` and encodes a report.
3. The report reaches `ProofPayCREReceiver`, which authorises the caller and deduplicates.
4. The receiver calls `confirmDelivery(orderId)` or `confirmFailure(orderId)`.
5. The escrow checks that the caller is the configured oracle and settles exactly once.

`ProofPayCREReceiver` is set as the escrow oracle with `setOracle`. Locally, CRE runs in
simulation only (`dryRun: true`) and a local bridge relays its report bytes; no Chainlink
DON is deployed. In a production design the owner should be a multisig, the receiver's
`forwarder` should be the DON forwarder, and the manual oracle should be removed.

## Scope

Included in Phase 1:

- pUSD ERC-20 token
- Escrow creation, release, and refund
- Oracle access control
- Hardhat tests and deployment scripts
- Local deployment addresses
- CRE integration explanation

Not included yet:

- Chainlink CRE implementation
- MetaMask/frontend integration
- Backend API integration
- Mainnet deployment
- Optional 10% inventory advance
