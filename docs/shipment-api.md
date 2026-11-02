# Mock Shipment Tracking API

Phase 3 adds off-chain shipment tracking to ProofPay. The courier data is simulated: it is not an independent delivery-verification authority, and it never releases or refunds escrow funds.

The backend only reads escrow state from the chain. It has no signing keys and no settlement methods.

## Architecture

- Express routes under `/api/shipments`.
- JSON persistence at `backend/data/shipments.json` using atomic temp-file + rename writes.
- One shipment per escrow order; tracking IDs are unique.
- Chain verification uses raw JSON-RPC `eth_call` with the `getEscrow(bytes32)` selector `0xf023b811`.
- The backend verifies the configured chain ID, escrow existence, `Funded` status, and seller address before registration.
- The frontend calls the real Express API through `VITE_API_BASE_URL`; there are no hardcoded shipment responses.

## Configuration

Backend `backend/.env`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5001` | Express port |
| `CORS_ORIGIN` | `*` | Allowed frontend origin(s) |
| `BLOCKCHAIN_RPC_URL` | `http://127.0.0.1:8545` | Hardhat/EVM JSON-RPC endpoint |
| `CHAIN_ID` | `31337` | Expected chain ID |
| `ESCROW_CONTRACT_ADDRESS` | local deployment | Escrow contract |
| `PUSD_TOKEN_ADDRESS` | local deployment | pUSD token |
| `SHIPMENT_DATA_FILE` | `./data/shipments.json` | Shipment JSON file |
| `SHIPMENT_CHAIN_TIMEOUT_MS` | `5000` | RPC timeout |
| `SHIPMENT_SIMULATOR_TOKEN` | empty | Optional mutation token |
| `SHIPMENT_ALLOW_REMOTE_MUTATIONS` | `false` | Bypass loopback-only mutations |

Frontend `frontend/.env`:

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Backend base URL, e.g. `http://localhost:5001` |
| `VITE_SHIPMENT_SIMULATOR_TOKEN` | Optional; must match `SHIPMENT_SIMULATOR_TOKEN` |
| `VITE_CHAIN_ID` | Expected wallet chain ID |
| `VITE_ESCROW_CONTRACT_ADDRESS` | Escrow contract |
| `VITE_PUSD_TOKEN_ADDRESS` | pUSD token |

## Local Run

```bash
cd contracts
npm run node
# separate terminal
npm run deploy:local

cd ../backend
npm start

cd ../frontend
npm run dev
```

Health check:

```bash
curl http://localhost:5001/health
```

## API

All responses use JSON. Shipment responses include `simulated: true` and `source: "mock-courier-simulator"`.

### Register a shipment

`POST /api/shipments`

```json
{
  "orderId": "0xb294f31699ea29815fdec43fbf9a16d8789bae9bdab6d75e97a1e9bbf6755dd9",
  "trackingId": "TRK123456",
  "carrier": "MockCourier",
  "sellerAddress": "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "description": "Optional package notes"
}
```

`carrier` may also be sent as `courier`. Tracking IDs are normalized to uppercase; order IDs to lowercase.

Response `201 Created`:

```json
{
  "trackingId": "TRK123456",
  "orderId": "0xb294f31699ea29815fdec43fbf9a16d8789bae9bdab6d75e97a1e9bbf6755dd9",
  "carrier": "MockCourier",
  "sellerAddress": "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
  "description": "Optional package notes",
  "status": "CREATED",
  "simulated": true,
  "source": "mock-courier-simulator",
  "createdAt": "2026-10-31T17:00:00.000Z",
  "updatedAt": "2026-10-31T17:00:00.000Z",
  "events": [
    {
      "status": "CREATED",
      "timestamp": "2026-10-31T17:00:00.000Z",
      "description": "Shipment registered with MockCourier (simulated courier data)."
    }
  ]
}
```

### List shipments

`GET /api/shipments`

Optional filters:

- `orderId`: 32-byte escrow order ID
- `status`: one of `CREATED`, `SHIPPED`, `IN_TRANSIT`, `DELIVERED`, `LOST`, `RETURNED`

```json
{
  "shipments": [],
  "count": 0,
  "simulated": true
}
```

### Get by order ID

`GET /api/shipments/order/:orderId`

Returns the single shipment registered for that escrow order.

### Get by tracking ID

`GET /api/shipments/:trackingId`

Returns the shipment for the tracking ID.

### Update status

`PATCH /api/shipments/:trackingId/status`

```json
{
  "status": "IN_TRANSIT",
  "description": "Optional custom event description"
}
```

Allowed transitions:

```text
CREATED -> SHIPPED
SHIPPED -> IN_TRANSIT
IN_TRANSIT -> DELIVERED | LOST
DELIVERED -> RETURNED
LOST -> terminal
RETURNED -> terminal
```

`DELIVERED -> RETURNED` is a simulation-only return path. No transition touches the escrow contract.

### Error format

```json
{
  "error": "Human-readable message.",
  "code": "MACHINE_READABLE_CODE",
  "details": {}
}
```

Common codes:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_ORDER_ID` | Malformed 32-byte order ID |
| 400 | `INVALID_TRACKING_ID` | Invalid tracking ID |
| 400 | `INVALID_CARRIER` | Carrier outside 2-60 printable characters |
| 400 | `INVALID_DESCRIPTION` | Description over 280 characters |
| 400 | `INVALID_STATUS` | Unsupported shipment status |
| 403 | `MUTATION_LOCAL_ONLY` | Mutation attempted from a non-loopback address |
| 403 | `MUTATION_FORBIDDEN` | Missing/incorrect simulator token |
| 404 | `ESCROW_NOT_FOUND` | No escrow exists on-chain |
| 404 | `SHIPMENT_NOT_FOUND` | No shipment for the tracking/order ID |
| 409 | `DUPLICATE_TRACKING_ID` | Tracking ID already registered |
| 409 | `SHIPMENT_ALREADY_EXISTS` | Order already has a shipment |
| 409 | `ESCROW_NOT_FUNDED` | Escrow is not in `Funded` status |
| 409 | `SELLER_MISMATCH` | Seller address differs from the on-chain seller |
| 409 | `INVALID_STATUS_TRANSITION` | Transition not allowed |
| 503 | `CHAIN_UNAVAILABLE` | RPC unreachable or chain ID mismatch |

## Mutation Access

POST and PATCH are restricted to loopback by default:

- No token: only `127.0.0.1` / `::1` may mutate.
- `SHIPMENT_SIMULATOR_TOKEN` set: mutations require `x-simulator-token`.
- `SHIPMENT_ALLOW_REMOTE_MUTATIONS=true`: bypasses the loopback check.

The token is a demo gate, not production authentication. GET endpoints remain public in this phase.

## Persistence

Shipments are stored in `backend/data/shipments.json`:

```json
{
  "version": 1,
  "shipments": []
}
```

Writes are serialized and use a temporary file followed by a rename. Invalid JSON causes startup to fail rather than silently discarding data. This storage is intended for a single backend process.

## Frontend Integration

- Seller dashboard: select a funded escrow where the connected wallet is the seller, register a mock shipment, and view its current status/timeline.
- Admin dashboard: list shipments and advance them through the allowed mock transitions.
- Order tracking: display tracking ID, courier, status, event timeline, and last update; show loading, error, and "not registered yet" states.
- Shipment data is labelled simulated and is never used to release or refund escrow.

## Testing

```bash
cd backend
npm test
```

The backend suite covers registration, duplicate detection, validation, seller/escrow checks, transitions, terminal states, list filters, persistence across restart, malformed storage, and mutation-token restrictions.

Live Phase 3 verification against Hardhat and the running backend:

```bash
cd frontend
node tmp/phase3_verify.cjs
```

Persistence check after restarting the backend:

```bash
node tmp/phase3_persist_check.cjs
```

Results are written to:

- `frontend/tmp/phase3_verify_results.json`
- `frontend/tmp/phase3_persist_results.json`

The live test creates funded escrows and verifies that shipment `DELIVERED`, `LOST`, and `RETURNED` updates leave the escrow `Funded` and do not change buyer/seller/escrow balances.

## Chainlink Deployment Note

`localhost` is not reachable from a Chainlink DON. A deployed version would need a public HTTPS endpoint, authentication, idempotency keys, rate limiting, and durable shared storage. Chainlink CRE integration is intentionally not part of Phase 3.

## Limitations

- Simulated courier data only; no real carrier integration or webhooks.
- No shipment-triggered escrow settlement or refund.
- No production authentication or multi-instance JSON storage.
- No Chainlink CRE workflow yet.
