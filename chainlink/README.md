# ProofPay Chainlink Integration

This directory is designated for the Chainlink oracle integration connecting real-world shipment tracking data with the blockchain escrow contracts.

## Architecture Role
- **Chainlink CRE / Functions**: Bridges off-chain tracking data (Mock Shipment API) into EVM smart contracts.
- **Automated Verification**: Triggers automated seller release upon confirmed delivery or refund upon failed/canceled delivery.
