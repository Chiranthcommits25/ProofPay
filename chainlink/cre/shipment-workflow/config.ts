import { z } from 'zod';

export const configSchema = z.object({
  shipmentApiBaseUrl: z.string().default('http://localhost:5001'),
  shipmentApiPath: z.string().default('/api/shipments'),
  rpcUrl: z.string().default('http://127.0.0.1:8545'),
  chainId: z.number().default(31337),
  escrowContractAddress: z.string().default('0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'),
  receiverContractAddress: z.string().default('0x0000000000000000000000000000000000000000'),
  forwarderAddress: z.string().default('0x0000000000000000000000000000000000000000'),
  dryRun: z.boolean().default(false),
});

export type Config = z.infer<typeof configSchema>;
