# ProofPay Chainlink CRE Integration

This directory contains the Chainlink CRE workflow for automated shipment-based settlement.

## Structure

- `project.yaml` - CRE project configuration
- `workflow.yaml` - CRE workflow configuration  
- `shipment-workflow/` - Workflow implementation
  - `main.ts` - Main workflow logic
  - `config.ts` - Configuration schema
  - `types.ts` - Type definitions
  - `package.json` - Dependencies

## Workflow Behavior

The workflow:
1. Fetches all shipments from the Express API (`http://localhost:5001/api/shipments`)
2. For each shipment, determines settlement action based on status:
   - `DELIVERED` → Eligible for release (seller payment)
   - `LOST` → Eligible for refund (buyer payment)  
   - `IN_TRANSIT` / `SHIPPED` → No settlement (payment locked)
   - `RETURNED` → Manual review required
   - `CREATED` → No settlement yet
3. For settlements, verifies the escrow is still `FUNDED` on-chain
4. Generates a structured report for the CRE receiver contract
5. Never settles already-released or already-refunded escrows

## Report Format

Reports are ABI-encoded as: `(bytes32 orderId, string outcome, bytes32 trackingIdHash, string observedAt)`
- `orderId`: The bytes32 order ID from the escrow
- `outcome`: Either "DELIVERED" or "LOST"
- `trackingIdHash`: keccak256 hash of tracking ID (for privacy)
- `observedAt`: ISO timestamp

## Simulation

### Prerequisites
- Chainlink CRE CLI (not found in this environment)
- Node.js v22
- Backend running on port 5001
- Hardhat node running on port 8545 with deployed contracts

### Running Simulation (if CRE CLI available)
```bash
cd chainlink/cre
cre workflow simulate shipment-workflow --config shipment-workflow/config.json
```

### Local Testing (without CRE CLI)
```bash
cd chainlink/cre/shipment-workflow
node --import tsx main.ts  # or use ts-node
```

## Notes
- This is a local development setup. The workflow connects to localhost:5001 which is not accessible from a deployed Chainlink DON.
- For production deployment, the shipment API would need to be publicly accessible via HTTPS.
- EVM write capabilities require the CRE DON to support the target chain.
