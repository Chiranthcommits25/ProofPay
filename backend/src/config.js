import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number.`);
  }

  return value;
}

function booleanFromEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === 'true' || raw === '1';
}

function dataFileFromEnv() {
  const raw = process.env.SHIPMENT_DATA_FILE?.trim();
  if (!raw) return path.join(backendRoot, 'data', 'shipments.json');
  return path.isAbsolute(raw) ? raw : path.resolve(backendRoot, raw);
}

export const config = {
  port: numberFromEnv('PORT', 5001),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  corsOrigin: process.env.CORS_ORIGIN?.trim() || '*',

  // Local Hardhat by default. The backend only reads escrow state.
  rpcUrl: process.env.BLOCKCHAIN_RPC_URL?.trim() || 'http://127.0.0.1:8545',
  chainId: numberFromEnv('CHAIN_ID', 31337),
  escrowAddress:
    process.env.ESCROW_CONTRACT_ADDRESS?.trim() ||
    '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  pusdTokenAddress:
    process.env.PUSD_TOKEN_ADDRESS?.trim() ||
    '0x5FbDB2315678afecb367f032d93F642f64180aa3',

  dataFile: dataFileFromEnv(),
  simulatorToken: process.env.SHIPMENT_SIMULATOR_TOKEN?.trim() || '',
  allowRemoteMutations: booleanFromEnv('SHIPMENT_ALLOW_REMOTE_MUTATIONS'),
  chainTimeoutMs: numberFromEnv('SHIPMENT_CHAIN_TIMEOUT_MS', 5000),
};
