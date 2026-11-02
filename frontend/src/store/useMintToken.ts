import { useCallback, useState } from 'react';
import type { MintState, TokenState, WalletState } from '../types';
import {
  PROOFPAY_USD_ADDRESS,
  ZERO_ADDRESS,
  buildMintCalldata,
  isValidAddress,
  parseTokenAmount,
} from '../lib/contracts';
import {
  formatEther,
  getProvider,
  providerErrorText,
  walletErrorMessage,
} from '../lib/wallet';

const IDLE: MintState = { phase: 'idle', hash: null, blockNumber: null, error: null };

interface Receipt {
  status?: string;
  blockNumber?: string;
}

function fail(error: string, hash: string | null = null): MintState {
  return { phase: 'error', hash, blockNumber: null, error };
}

function describeError(error: unknown, fallback: string): string {
  const code = (error as { code?: number } | null)?.code;
  const message = providerErrorText(error);

  if (code === 4001 || /user rejected|denied transaction/i.test(message)) {
    return 'Transaction rejected in MetaMask.';
  }
  if (/insufficient funds/i.test(message)) {
    return 'Not enough ETH to pay for gas.';
  }
  if (code === -32603 || /revert/i.test(message)) {
    return 'The contract rejected this transaction. Only the token owner can mint.';
  }
  return walletErrorMessage(error, fallback);
}

async function waitForReceipt(hash: string): Promise<Receipt | null> {
  const provider = getProvider();
  if (!provider) return null;

  for (let attempt = 0; attempt < 90; attempt += 1) {
    let receipt: Receipt | null;
    try {
      receipt = await provider.request<Receipt | null>({
        method: 'eth_getTransactionReceipt',
        params: [hash],
      });
    } catch {
      receipt = null;
    }
    if (receipt) return receipt;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return null;
}

export interface UseMintTokenResult {
  mintState: MintState;
  mint: (recipient: string, amount: string) => Promise<void>;
  reset: () => void;
}

/**
 * Owner-only pUSD mint. The owner check lives in the token contract —
 * this hook only surfaces the outcome, it never assumes authority.
 */
export function useMintToken(
  wallet: WalletState,
  token: TokenState,
  onSettled: () => void
): UseMintTokenResult {
  const [mintState, setMintState] = useState<MintState>(IDLE);

  const mint = useCallback(
    async (recipientInput: string, amountInput: string) => {
      const provider = getProvider();

      if (!provider) {
        setMintState(fail('MetaMask was not detected.'));
        return;
      }
      if (!wallet.address) {
        setMintState(fail('Connect a wallet before minting.'));
        return;
      }
      if (!wallet.isCorrectNetwork) {
        setMintState(fail('Switch MetaMask to Hardhat Local (chain 31337) first.'));
        return;
      }

      const recipient = recipientInput.trim();
      if (!isValidAddress(recipient)) {
        setMintState(fail('Enter a valid recipient address.'));
        return;
      }
      if (recipient.toLowerCase() === ZERO_ADDRESS) {
        setMintState(fail('The zero address cannot receive tokens.'));
        return;
      }

      const parsed = parseTokenAmount(amountInput, token.decimals);
      if (parsed.error) {
        setMintState(fail(parsed.error));
        return;
      }

      const data = buildMintCalldata(recipient, parsed.value);
      setMintState({ phase: 'signing', hash: null, blockNumber: null, error: null });

      // Estimate first: a revert here means the call would fail on-chain
      // (most often because the sender is not the owner).
      let gasLimitHex: string;
      try {
        gasLimitHex = await provider.request<string>({
          method: 'eth_estimateGas',
          params: [{ from: wallet.address, to: PROOFPAY_USD_ADDRESS, data }],
        });
      } catch (error) {
        setMintState(
          fail(
            describeError(
              error,
              'The transaction would fail. Only the token owner can mint.'
            )
          )
        );
        return;
      }

      // Fail before prompting MetaMask if gas is unaffordable.
      try {
        const [gasPriceHex, balanceHex] = await Promise.all([
          provider.request<string>({ method: 'eth_gasPrice' }),
          provider.request<string>({
            method: 'eth_getBalance',
            params: [wallet.address, 'latest'],
          }),
        ]);
        const required = BigInt(gasLimitHex) * BigInt(gasPriceHex);
        if (BigInt(balanceHex) < required) {
          setMintState(
            fail(
              `Not enough ETH for gas. This transaction needs about ${formatEther(
                `0x${required.toString(16)}`
              )} ETH.`
            )
          );
          return;
        }
      } catch {
        // Non-fatal: let MetaMask surface its own gas error.
      }

      let hash: string;
      try {
        hash = await provider.request<string>({
          method: 'eth_sendTransaction',
          params: [
            {
              from: wallet.address,
              to: PROOFPAY_USD_ADDRESS,
              data,
              gas: gasLimitHex,
            },
          ],
        });
      } catch (error) {
        setMintState(fail(describeError(error, 'The transaction was not submitted.')));
        return;
      }

      setMintState({ phase: 'pending', hash, blockNumber: null, error: null });

      const receipt = await waitForReceipt(hash);

      if (!receipt) {
        setMintState({
          phase: 'pending',
          hash,
          blockNumber: null,
          error: 'Still waiting for a receipt. Check MetaMask activity for the latest status.',
        });
        return;
      }

      const blockNumber = receipt.blockNumber
        ? Number.parseInt(receipt.blockNumber, 16)
        : null;

      if (receipt.status === '0x1') {
        setMintState({ phase: 'confirmed', hash, blockNumber, error: null });
        onSettled();
      } else {
        setMintState({
          phase: 'error',
          hash,
          blockNumber,
          error: 'The transaction reverted on-chain.',
        });
      }
    },
    [wallet.address, wallet.isCorrectNetwork, token.decimals, onSettled]
  );

  const reset = useCallback(() => setMintState(IDLE), []);

  return { mintState, mint, reset };
}
