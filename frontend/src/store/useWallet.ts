import { useCallback, useEffect, useRef, useState } from 'react';
import type { WalletState } from '../types';
import {
  HARDHAT_LOCAL,
  formatEther,
  getChainName,
  getProvider,
  parseChainId,
  walletErrorMessage,
} from '../lib/wallet';

const MANUAL_DISCONNECT_KEY = 'proofpay.wallet.manuallyDisconnected';

const INITIAL_WALLET: WalletState = {
  isConnected: false,
  address: null,
  chainId: null,
  network: '',
  ethBalance: '',
  isCorrectNetwork: false,
  status: 'disconnected',
  error: null,
};

export interface UseWalletResult {
  wallet: WalletState;
  hasProvider: boolean;
  connect: () => Promise<boolean>;
  disconnect: () => void;
  switchToHardhatLocal: () => Promise<void>;
  clearError: () => void;
  /** Re-reads account, chain and native balance (e.g. after a transaction). */
  refresh: () => Promise<void>;
}

/** Wallet state read from the injected provider and kept in sync with its events. */
export function useWallet(): UseWalletResult {
  const [wallet, setWallet] = useState<WalletState>(INITIAL_WALLET);
  const [hasProvider, setHasProvider] = useState(false);
  const addressRef = useRef<string | null>(null);

  const applyAddress = useCallback(async (address: string) => {
    const provider = getProvider();
    if (!provider) {
      setWallet(INITIAL_WALLET);
      return;
    }

    addressRef.current = address;

    let chainId: number | null;
    try {
      chainId = parseChainId(await provider.request<string>({ method: 'eth_chainId' }));
    } catch {
      chainId = null;
    }

    let ethBalance: string;
    try {
      ethBalance = formatEther(
        await provider.request<string>({ method: 'eth_getBalance', params: [address, 'latest'] })
      );
    } catch {
      ethBalance = '';
    }

    setWallet({
      isConnected: true,
      address,
      chainId,
      network: getChainName(chainId),
      ethBalance,
      isCorrectNetwork: chainId === HARDHAT_LOCAL.chainId,
      status: 'connected',
      error: null,
    });
  }, []);

  /** Re-reads the current account (no prompt) and refreshes chain + balance. */
  const refresh = useCallback(async () => {
    const provider = getProvider();
    if (!provider) return;

    try {
      const accounts = await provider.request<string[]>({ method: 'eth_accounts' });
      if (accounts.length === 0) {
        addressRef.current = null;
        setWallet(INITIAL_WALLET);
        return;
      }
      await applyAddress(accounts[0]);
    } catch {
      // Leave the last known state in place; the next event will resync.
    }
  }, [applyAddress]);

  // Silent rehydrate on mount + provider event subscriptions.
  useEffect(() => {
    const provider = getProvider();
    setHasProvider(Boolean(provider));
    if (!provider) return;

    let cancelled = false;

    const rehydrate = async () => {
      if (sessionStorage.getItem(MANUAL_DISCONNECT_KEY) === '1') return;
      try {
        const accounts = await provider.request<string[]>({ method: 'eth_accounts' });
        if (cancelled || accounts.length === 0) return;
        await applyAddress(accounts[0]);
      } catch {
        // Provider not ready — stay disconnected.
      }
    };

    void rehydrate();

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : [];
      if (accounts.length === 0) {
        addressRef.current = null;
        setWallet(INITIAL_WALLET);
        return;
      }
      // The change is the user's own action inside MetaMask — reflect it.
      void applyAddress(accounts[0]);
    };

    const handleChainChanged = () => {
      void refresh();
    };

    provider.on('accountsChanged', handleAccountsChanged);
    provider.on('chainChanged', handleChainChanged);

    return () => {
      cancelled = true;
      provider.removeListener('accountsChanged', handleAccountsChanged);
      provider.removeListener('chainChanged', handleChainChanged);
    };
  }, [applyAddress, refresh]);

  const connect = useCallback(async (): Promise<boolean> => {
    const provider = getProvider();

    if (!provider) {
      setWallet(prev => ({
        ...prev,
        status: 'error',
        error:
          'MetaMask was not detected. Install the MetaMask browser extension, then reload this page.',
      }));
      return false;
    }

    setWallet(prev => ({ ...prev, status: 'connecting', error: null }));

    try {
      const accounts = await provider.request<string[]>({ method: 'eth_requestAccounts' });
      if (!accounts[0]) {
        setWallet(prev => ({
          ...prev,
          status: 'error',
          error: 'MetaMask returned no account. Unlock the wallet and try again.',
        }));
        return false;
      }

      sessionStorage.removeItem(MANUAL_DISCONNECT_KEY);
      setHasProvider(true);
      await applyAddress(accounts[0]);
      return true;
    } catch (error) {
      setWallet(prev => ({
        ...prev,
        status: 'error',
        error: walletErrorMessage(error, 'Could not connect to MetaMask.'),
      }));
      return false;
    }
  }, [applyAddress]);

  const disconnect = useCallback(() => {
    const provider = getProvider();

    // Remember the choice so a reload does not silently reconnect.
    sessionStorage.setItem(MANUAL_DISCONNECT_KEY, '1');
    addressRef.current = null;
    setWallet(INITIAL_WALLET);

    // Best effort only: not every provider implements permission revocation.
    if (provider) {
      void provider
        .request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] })
        .catch(() => undefined);
    }
  }, []);

  const switchToHardhatLocal = useCallback(async () => {
    const provider = getProvider();

    if (!provider) {
      setWallet(prev => ({
        ...prev,
        status: 'error',
        error: 'MetaMask was not detected, so the network cannot be switched.',
      }));
      return;
    }

    setWallet(prev => ({ ...prev, status: 'connecting', error: null }));

    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: HARDHAT_LOCAL.chainIdHex }],
      });
    } catch (error) {
      const code = (error as { code?: number } | null)?.code;

      // 4902: the chain is not configured in MetaMask — offer to add it.
      if (code === 4902) {
        try {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: HARDHAT_LOCAL.chainIdHex,
                chainName: HARDHAT_LOCAL.chainName,
                nativeCurrency: HARDHAT_LOCAL.nativeCurrency,
                rpcUrls: HARDHAT_LOCAL.rpcUrls,
              },
            ],
          });
        } catch (addError) {
          setWallet(prev => ({
            ...prev,
            status: addressRef.current ? 'connected' : 'disconnected',
            error: walletErrorMessage(addError, 'Could not add the Hardhat Local network.'),
          }));
          return;
        }
      } else {
        setWallet(prev => ({
          ...prev,
          status: addressRef.current ? 'connected' : 'disconnected',
          error: walletErrorMessage(error, 'Could not switch to Hardhat Local.'),
        }));
        return;
      }
    }

    await refresh();
  }, [refresh]);

  const clearError = useCallback(() => {
    setWallet(prev => ({
      ...prev,
      status: prev.isConnected ? 'connected' : 'disconnected',
      error: null,
    }));
  }, []);

  return {
    wallet,
    hasProvider,
    connect,
    disconnect,
    switchToHardhatLocal,
    clearError,
    refresh,
  };
}
