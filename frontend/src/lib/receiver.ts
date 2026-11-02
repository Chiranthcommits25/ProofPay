import { encodeAbiParameters, encodeFunctionData, parseAbiParameters } from 'viem';

export const RECEIVER_ABI = [
  {
    type: 'function',
    name: 'manualOracle',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'processReport',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'metadata', type: 'bytes' },
      { name: 'report', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

export function receiverAddress(): string | null {
  const value = import.meta.env.VITE_RECEIVER_CONTRACT_ADDRESS as string | undefined;
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) return null;
  return value;
}

export function isReceiverMode(): boolean {
  return (import.meta.env.VITE_SETTLEMENT_MODE as string | undefined) === 'receiver';
}

export function encodeProcessReportCalldata(
  orderId: string,
  kind: 'delivery' | 'failure',
  observedAt: string
): `0x${string}` {
  const outcome = kind === 'delivery' ? 'DELIVERED' : 'LOST';
  const trackingIdHash = `0x${'0'.repeat(64)}` as `0x${string}`;
  const report = encodeAbiParameters(
    parseAbiParameters('bytes32 orderId, string outcome, bytes32 trackingIdHash, string observedAt'),
    [orderId as `0x${string}`, outcome, trackingIdHash, observedAt]
  );
  const metadata = '0x' as `0x${string}`;
  return encodeFunctionData({
    abi: RECEIVER_ABI,
    functionName: 'processReport',
    args: [metadata, report],
  });
}
