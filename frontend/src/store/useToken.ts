import { useCallback, useEffect, useState } from 'react';
import type { TokenState, WalletState } from '../types';
import {
  formatTokenAmount,
  readTokenBalance,
  readTokenMetadata,
  readTokenOwner,
} from '../lib/contracts';

const EMPTY_TOKEN: TokenState = {
  name: '',
  symbol: '',
  decimals: 18,
  totalSupply: 0n,
  balance: 0n,
  balanceFormatted: '',
  owner: null,
  status: 'idle',
  error: null,
};

export interface UseTokenResult {
  token: TokenState;
  refresh: () => Promise<void>;
}

/**
 * Reads ProofPayUSD metadata and the connected account's balance straight from
 * the deployed contract. Nothing is cached across networks: every read is
 * re-issued when the account or chain changes, and after a transaction settles.
 */
export function useToken(wallet: WalletState): UseTokenResult {
  const [token, setToken] = useState<TokenState>(EMPTY_TOKEN);

  const refresh = useCallback(async () => {
    if (!wallet.address || !wallet.isCorrectNetwork) {
      setToken(EMPTY_TOKEN);
      return;
    }

    setToken(prev => ({ ...prev, status: prev.status === 'ready' ? 'ready' : 'loading' }));

    try {
      const [metadata, balance, owner] = await Promise.all([
        readTokenMetadata(),
        readTokenBalance(wallet.address),
        readTokenOwner(),
      ]);

      setToken({
        ...metadata,
        balance,
        balanceFormatted: formatTokenAmount(balance, metadata.decimals),
        owner,
        status: 'ready',
        error: null,
      });
    } catch {
      setToken(prev => ({
        ...prev,
        status: 'error',
        error:
          'Could not read ProofPay USD from the Hardhat node. Check that it is running on 127.0.0.1:8545.',
      }));
    }
  }, [wallet.address, wallet.isCorrectNetwork]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return { token, refresh };
}
