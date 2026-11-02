import { ApiError } from '../lib/errors.js';

/** keccak256("getEscrow(bytes32)")[0..4], verified against the deployed build. */
export const GET_ESCROW_SELECTOR = '0xf023b811';

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function wordAt(data, index) {
  return data.slice(index * 64, (index + 1) * 64);
}

function decodeEscrow(result, expectedOrderId) {
  const data = result.startsWith('0x') ? result.slice(2) : result;

  if (data.length < 7 * 64) {
    throw new ApiError(
      502,
      'INVALID_CHAIN_RESPONSE',
      'The escrow RPC returned an unexpected getEscrow() response.'
    );
  }

  const record = {
    orderId: `0x${wordAt(data, 0)}`,
    buyer: `0x${wordAt(data, 1).slice(24)}`,
    seller: `0x${wordAt(data, 2).slice(24)}`,
    amount: BigInt(`0x${wordAt(data, 3) || '0'}`),
    createdAt: Number(BigInt(`0x${wordAt(data, 4) || '0'}`)),
    settledAt: Number(BigInt(`0x${wordAt(data, 5) || '0'}`)),
    status: Number(BigInt(`0x${wordAt(data, 6) || '0'}`)),
  };

  if (record.orderId.toLowerCase() !== expectedOrderId.toLowerCase()) {
    throw new ApiError(
      502,
      'INVALID_CHAIN_RESPONSE',
      'The escrow RPC returned a different order ID than requested.'
    );
  }

  return record;
}

/** Read-only escrow client: it can verify funding but has no signing or settlement path. */
export function createEscrowChain({
  rpcUrl,
  chainId,
  escrowAddress,
  timeoutMs = 5000,
  fetchImpl = fetch,
}) {
  if (!ADDRESS_PATTERN.test(escrowAddress)) {
    throw new Error(`Invalid ESCROW_CONTRACT_ADDRESS: ${escrowAddress}`);
  }

  async function rpc(method, params) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      });

      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new ApiError(
          503,
          'CHAIN_UNAVAILABLE',
          'The escrow RPC returned a non-JSON response.'
        );
      }

      if (payload?.error) {
        const message = payload.error.message ?? 'Unknown RPC error';

        // Hardhat returns an execution-reverted error for an unknown order ID.
        if (/revert/i.test(message)) {
          return { reverted: true, message };
        }

        throw new ApiError(503, 'CHAIN_UNAVAILABLE', `Escrow RPC error: ${message}`);
      }

      if (!response.ok) {
        throw new ApiError(
          503,
          'CHAIN_UNAVAILABLE',
          `Escrow RPC returned HTTP ${response.status}.`
        );
      }

      return { result: payload?.result };
    } catch (error) {
      if (error instanceof ApiError) throw error;

      if (error?.name === 'AbortError') {
        throw new ApiError(
          503,
          'CHAIN_UNAVAILABLE',
          `Escrow RPC timed out at ${rpcUrl}.`
        );
      }

      throw new ApiError(
        503,
        'CHAIN_UNAVAILABLE',
        `Could not reach the escrow RPC at ${rpcUrl}.`
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async function verifyEscrow(orderId) {
    const chainResult = await rpc('eth_chainId', []);

    if (chainResult.reverted) {
      throw new ApiError(503, 'CHAIN_UNAVAILABLE', 'Escrow RPC rejected eth_chainId.');
    }

    const actualChainId = Number(BigInt(chainResult.result));

    if (actualChainId !== chainId) {
      throw new ApiError(
        503,
        'WRONG_CHAIN',
        `Backend is configured for chain ${chainId}, but the RPC reports chain ${actualChainId}.`
      );
    }

    const callResult = await rpc('eth_call', [
      {
        to: escrowAddress,
        data: `${GET_ESCROW_SELECTOR}${orderId.slice(2)}`,
      },
      'latest',
    ]);

    if (callResult.reverted || !callResult.result || callResult.result === '0x') {
      return null;
    }

    const record = decodeEscrow(callResult.result, orderId);
    return record.status === 0 ? null : record;
  }

  return { verifyEscrow };
}
