export function getExplorerTxUrl(txHash: string): string {
  // For local Hardhat, we don't have a block explorer, but provide a placeholder
  return `#tx-${txHash}`;
}
