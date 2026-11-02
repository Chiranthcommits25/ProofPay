import { config } from './config.js';
import { createApp } from './app.js';
import { createEscrowChain } from './services/escrowChain.js';
import { ShipmentService } from './services/shipmentService.js';
import { ShipmentStore } from './services/shipmentStore.js';

async function main() {
  const store = new ShipmentStore(config.dataFile);
  await store.load();

  const chainVerifier = createEscrowChain({
    rpcUrl: config.rpcUrl,
    chainId: config.chainId,
    escrowAddress: config.escrowAddress,
    timeoutMs: config.chainTimeoutMs,
  });

  const shipmentService = new ShipmentService({ store, chainVerifier });
  const app = createApp({ config, shipmentService, store });

  const server = app.listen(config.port, () => {
    console.log(`ProofPay backend server running on port ${config.port}`);
    console.log(`Shipment API: http://localhost:${config.port}/api/shipments`);
    console.log(`Shipment data file: ${config.dataFile}`);
    console.log(
      `Escrow verification: ${config.rpcUrl} (chain ${config.chainId})`
    );
  });

  server.on('error', error => {
    console.error('[proofpay-backend] Server error:', error.message);
    process.exit(1);
  });

  const shutdown = signal => {
    console.log(`[proofpay-backend] ${signal} received, shutting down.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(error => {
  console.error('[proofpay-backend] Startup failed:', error.message);
  process.exit(1);
});
