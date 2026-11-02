# ProofPay

Escrow-backed marketplace payments that settle on-chain when delivery is verified.

Buyers pay with **pUSD**, an ERC-20 token, into a smart-contract escrow. A courier
status (delivered or lost) is turned into a signed settlement report by a Chainlink
CRE workflow, and the escrow releases the funds to the seller or refunds the buyer.
No party can move the money by editing a UI, and each order settles exactly once.

---

## The problem

Two strangers trading online cannot trust each other with the "who goes first"
decision. Paying first risks losing the money; shipping first risks not being paid.
ProofPay removes that decision from both parties by making the payment conditional:
funds are held by a contract, and the condition — delivery — is evaluated off-chain
by an oracle and enforced on-chain.

## Key features

- **Non-custodial escrow.** Funds sit in `ProofPayEscrow`, not in a platform account.
- **Two-transaction checkout.** ERC-20 `approve` followed by `createEscrow`, so the
  token contract remains the only authority over a buyer's balance.
- **Oracle-mediated settlement.** Only the receiver contract, acting on a CRE report,
  can release or refund — enforced by `onlyOracle`.
- **Replay and duplicate protection.** A report hash and a per-order flag make double
  settlement impossible even if a report is resubmitted.
- **Shipment API with on-chain cross-checks.** A seller cannot register a shipment for
  an order that is not funded, or for someone else's seller address.
- **Local CRE execution bridge.** Real `cre workflow simulate` runs, with the resulting
  report bytes relayed on-chain — no private key and no manual order configuration.
- **Self-driving demo courier.** An optional scheduler advances shipments through the
  courier timeline and triggers the workflow.

## Technology stack

| Layer | Technology |
| --- | --- |
| Contracts | Solidity 0.8.28, Hardhat 2.29, OpenZeppelin 5.6 |
| Token | ProofPay USD (`pUSD`), ERC-20, 18 decimals |
| Frontend | React 19, TypeScript 5.7, Vite 8, Tailwind 4, viem 2 |
| Wallet | MetaMask via EIP-1193 (`window.ethereum`) |
| Backend | Node.js, Express 4.21, JSON persistence |
| Oracle | Chainlink CRE (`@chainlink/cre-sdk` 1.23, CRE CLI 1.39) |
| Chain | Hardhat Local, chain ID `31337` |

## Architecture

```text
 Buyer (MetaMask)                    Seller (MetaMask)              Admin (MetaMask)
       |                                    |                             |
       | approve + createEscrow             | register shipment           | oracle panel
       v                                    v                             v
+----------------+   transferFrom   +----------------+          +------------------+
| ProofPayEscrow |<-----------------| ProofPayUSD    |          |  React frontend  |
|  Funded        |                  |   (pUSD)       |          |  read-only reads |
+----------------+                  +----------------+          +------------------+
       ^                                    ^                             |
       | confirmDelivery / confirmFailure   |                             | REST
       |                                    |                             v
+---------------------+   processReport   +--------------------------------------+
| ProofPayCREReceiver |<------------------| Local execution bridge               |
|  replay + duplicate |                   | (relays CRE report bytes unchanged)  |
+---------------------+                   +--------------------------------------+
                                                     ^
                                                     | PROOFPAY_REPORT_V1 log lines
                                          +--------------------------------------+
                                          | Chainlink CRE workflow (main.ts)     |
                                          | HTTP: shipments  EVM: escrow state   |
                                          +--------------------------------------+
                                                     ^
                                                     | GET /api/shipments
                                          +--------------------------------------+
                                          | Express shipment API (JSON store)    |
                                          +--------------------------------------+
```

The contract is the source of truth for money. The shipment API is the source of
truth for physical status. CRE joins the two; the bridge only relays.

## How ProofPay works

1. The buyer approves the escrow contract to spend `amount` of pUSD.
2. `createEscrow` pulls the tokens into the contract and records the order as `Funded`.
3. The seller registers a shipment for that funded order; the API verifies the order
   exists, is `Funded`, and that the seller address matches the escrow.
4. The courier reports `DELIVERED` or `LOST` (simulated, or advanced by the scheduler).
5. CRE reads the shipment list, reads the escrow state, decides `RELEASE` / `REFUND` /
   `NONE` / `MANUAL_REVIEW`, and emits an ABI-encoded settlement report.
6. The bridge validates the report against the chain and submits `processReport`.
7. The receiver checks authorisation, replay and duplicate state, then calls
   `confirmDelivery` or `confirmFailure` on the escrow.
8. The escrow pays the seller or refunds the buyer, and the order becomes terminal.

### Buyer workflow

Connect MetaMask on chain `31337` → open Checkout → choose a product → confirm the
seller address and amount → approve pUSD → create the escrow → the Buyer dashboard
shows the order as `FUNDED` with its on-chain amounts and transaction hashes.

### Seller workflow

Switch MetaMask to the seller account → Seller dashboard → select the funded order →
register a shipment with a tracking ID (`PPD-…`). Registration writes to the Express
API only; it never moves money.

### Chainlink CRE workflow

`chainlink/cre/shipment-workflow/main.ts` runs on a cron trigger. It fetches
`/api/shipments` over the HTTP capability, reads each eligible order through the EVM
capability, applies the settlement policy, and produces a report. The payload is
`abi.encode(bytes32 orderId, string outcome, bytes32 trackingIdHash, string observedAt)`.
The SDK prepends a 109-byte metadata header, which is stripped so the receiver decodes
only the ABI body. CRE keeps `dryRun: true`, so it never submits a transaction itself.

### Local execution bridge

`local-runner.ts` invokes the real CRE simulation, captures the `PROOFPAY_REPORT_V1:`
log lines, re-decodes the bytes independently, and submits `processReport` through
`eth_sendTransaction` using the Hardhat node's unlocked admin account. It makes no
settlement decision and holds no private key. Every report is validated per order —
existence, `Funded` status, order/outcome match, `orderSettled`, `processedReports`,
local state file, oracle wiring, and a gas-estimation dry run — so a new purchase
requires no configuration change. It defaults to a dry run.

## Smart contracts

| Contract | Responsibility |
| --- | --- |
| `ProofPayUSD.sol` | ERC-20 payment token; owner-only `mint`, no burn, no pause, 18 decimals. |
| `ProofPayEscrow.sol` | Holds pUSD per order; `createEscrow`, `confirmDelivery`, `confirmFailure`; `onlyOracle` settlement; `ReentrancyGuard` and `SafeERC20`. |
| `ProofPayCREReceiver.sol` | Settlement policy boundary: authorises the forwarder or manual oracle, deduplicates reports, forwards exactly one settlement per order. |

Escrow states are `None → Funded → Released | Refunded`. Settlement is terminal.

Local addresses produced by `npm run deploy:all` on a fresh node:

| Contract | Address |
| --- | --- |
| ProofPayUSD | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| ProofPayEscrow | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| ProofPayCREReceiver | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |

## Project structure

```text
Minor_2/
├── contracts/
│   ├── contracts/          # ProofPayUSD, ProofPayEscrow, ProofPayCREReceiver, mocks
│   ├── scripts/            # deploy-all, deploy, deploy-receiver, authorize-receiver
│   ├── test/               # Hardhat test suite
│   ├── deployments/        # local deployment records (committed)
│   └── hardhat.config.js
├── backend/
│   ├── src/
│   │   ├── lib/            # validation and error types
│   │   ├── middleware/     # demo mutation guard
│   │   ├── routes/         # shipment endpoints
│   │   └── services/       # shipment service, JSON store, escrow reader
│   ├── data/               # shipments.json
│   └── test/               # Node test runner suite
├── frontend/
│   └── src/
│       ├── components/     # ui, orders, shipments, admin, cre, layout
│       ├── data/           # demo product catalog
│       ├── lib/            # contract, escrow, receiver and API clients
│       ├── pages/          # landing, buyer, seller, checkout, tracking, admin
│       ├── store/          # wallet, token, escrow and shipment hooks
│       └── types/          # shared domain types
├── chainlink/cre/
│   ├── project.yaml        # CRE project + RPC targets
│   ├── workflow.yaml       # staging/production workflow settings
│   └── shipment-workflow/  # main.ts, local-runner.ts, courier-scheduler.ts, config
├── docs/                   # API reference and guide sources
├── .env.example            # reference for every service variable
└── README.md
```

## Prerequisites

- Node.js 22 and npm 10
- [Bun](https://bun.sh) (for the CRE bridge and scheduler)
- Chainlink CRE CLI (`cre`) 1.39+
- MetaMask browser extension

## Installation

```bash
cd contracts && npm install
cd ../backend && npm install
cd ../frontend && npm install
cd ../chainlink/cre/shipment-workflow && bun install
```

## Environment setup

Each service reads its own `.env`; the root `.env.example` documents the full set.
Copy the examples and adjust only what you need:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

No secrets are required for local operation. Never commit `.env` files; only
`.env.example` is tracked. The contract addresses in `frontend/.env`
(`VITE_ESCROW_CONTRACT_ADDRESS`, `VITE_PUSD_TOKEN_ADDRESS`,
`VITE_RECEIVER_CONTRACT_ADDRESS`) must match the deployment records.

## Running the application

Four terminals from the repository root:

```bash
# 1. Local chain
cd contracts && npm run node

# 2. Deploy token, escrow and receiver, authorise the oracle, seed balances
cd contracts && npm run deploy:all

# 3. Shipment API
cd backend && npm start

# 4. Frontend
cd frontend && npm run dev
```

Open <http://localhost:5173>, add the network to MetaMask (RPC
`http://127.0.0.1:8545`, chain ID `31337`) and import a Hardhat test account.

## Tests

```bash
cd contracts && npm test                                  # Solidity suite
cd backend   && npm test                                  # shipment API suite
cd frontend  && npm run lint && npm run build             # ESLint, tsc, Vite build
cd chainlink/cre/shipment-workflow && npm run typecheck    # CRE workflow types
```

## Deploying contracts locally

`npm run deploy:all` deploys all three contracts from one script, so the addresses
above are reproduced on every fresh node. The older granular commands remain available
(`deploy:local`, `deploy:receiver`, `authorize:receiver`), and
`authorize:receiver` reads the addresses from `deployments/*.json` rather than
hardcoding them.

Deployment records are written to `contracts/deployments/localhost.json` and
`contracts/deployments/cre-receiver-localhost.json`.

## Running the CRE simulation

```bash
cd chainlink/cre/shipment-workflow
cre workflow simulate shipment-workflow --target staging-settings --trigger-index 0 --non-interactive
```

The workflow prints its decision per shipment and, for eligible orders, a
`PROOFPAY_REPORT_V1:` line containing the exact report bytes.

## Running the local execution bridge

```bash
cd chainlink/cre/shipment-workflow
bun local-runner.ts                            # dry run (default): validates, submits nothing
LOCAL_BRIDGE_DRY_RUN=false bun local-runner.ts  # submit to the receiver
```

`BRIDGE_ORDER_ALLOWLIST` is optional; it scopes a run to specific order IDs but is
never required.

## Running the courier scheduler

```bash
cd chainlink/cre/shipment-workflow
bun courier-scheduler.ts                            # run until Ctrl+C
COURIER_RUN_SECONDS=60 bun courier-scheduler.ts      # bounded demo
COURIER_ONCE=true bun courier-scheduler.ts           # single tick
COURIER_FINAL_STATUS=LOST COURIER_RUN_SECONDS=120 bun courier-scheduler.ts   # force LOST
```

It advances only shipments whose tracking ID starts with `PPD-`, then runs the CRE
workflow and the bridge. The final hop is `DELIVERED` by default; a tracking ID
ending in `-LOST` produces `LOST`, and `COURIER_FINAL_STATUS=DELIVERED|LOST` forces
the outcome for every in-flight shipment. Terminal shipments are never modified.

## Security considerations

- Escrow settlement is restricted to the configured oracle (`onlyOracle`); the oracle
  is the receiver contract, whose `manualOracle` is a separate admin account.
- Both settlement paths deduplicate: the receiver stores a report hash and an
  `orderSettled` flag, so replay and re-settlement revert.
- `SafeERC20` and `ReentrancyGuard` are applied to every fund movement; state is
  updated before external calls.
- The backend is read-only for chain state — it can verify funding but cannot sign.
- Shipment mutations are a demo gate (loopback-only by default, or a shared
  `SHIPMENT_SIMULATOR_TOKEN`), not production authentication.
- No private key is stored in the repository; the bridge uses the Hardhat node's
  unlocked accounts.

## Known limitations

- **CRE runs in local simulation, not on a DON.** `dryRun` stays `true`, and the
  reports are relayed by a local bridge. No Chainlink DON operator signs or submits
  these settlements, and no DON deployment is claimed.
- The CRE SDK has no chain selector for chain ID `31337`, which is why the local
  bridge exists.
- Shipment tracking is simulated; there is no courier integration.
- Shipments are stored in a single JSON file, intended for one backend process.
- `pUSD` is a prototype token, not a stablecoin, and has no market value.
- Local chain state is ephemeral: restarting the node requires redeploying.
- The contracts are immutable — no proxy, no upgrade path, no admin rescue.

## Documentation

- `docs/shipment-api.md` — shipment API reference, transitions and error codes
- `contracts/README.md` — contract behaviour, deployment and test coverage
- `docs/README.md` — documentation index
- `PROOFPAY_MASTER_GUIDE.pdf` — full technical study guide
