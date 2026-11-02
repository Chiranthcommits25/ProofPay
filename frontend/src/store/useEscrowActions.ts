import { useCallback, useRef, useState } from 'react';
import type { EscrowTxState, WalletState } from '../types';
import {
  PROOFPAY_USD_ADDRESS,
  ZERO_ADDRESS,
  buildApproveCalldata,
  formatTokenAmount,
  isValidAddress,
  readAllowance,
  readTokenBalance,
} from '../lib/contracts';
import {
  ESCROW_ADDRESS,
  ESCROW_CHAIN_STATUS,
  buildConfirmDeliveryCalldata,
  buildConfirmFailureCalldata,
  buildCreateEscrowCalldata,
  generateOrderId,
  readEscrow,
  readEscrowOracle,
} from '../lib/escrow';
import { saveOrderMetadata } from '../lib/metadata';
import {
  formatEther,
  getProvider,
  providerErrorText,
  walletErrorMessage,
} from '../lib/wallet';

const IDLE: EscrowTxState = {
  phase: 'idle',
  step: '',
  approveHash: null,
  createHash: null,
  blockNumber: null,
  error: null,
  orderId: null,
};

interface Receipt {
  status?: string;
  blockNumber?: string;
}

interface CreateEscrowInput {
  seller: string;
  amountRaw: bigint;
  product: string;
  description: string;
  sellerLabel: string;
}

/** Maps contract custom errors / provider failures to actionable copy. */
export function describeEscrowError(error: unknown, fallback: string): string {
  const code = (error as { code?: number } | null)?.code;
  const message = providerErrorText(error);

  if (code === 4001 || /user rejected|denied transaction/i.test(message)) {
    return 'Transaction rejected in MetaMask.';
  }
  if (/insufficient funds/i.test(message)) {
    return 'Not enough ETH to pay for gas.';
  }
  if (/UnauthorizedOracle/i.test(message)) {
    return 'Only the contract oracle can settle escrows.';
  }
  if (/EscrowAlreadyExists/i.test(message)) {
    return 'That order ID already exists on-chain.';
  }
  if (/EscrowNotFunded/i.test(message)) {
    return 'This escrow is already settled.';
  }
  if (/EscrowNotFound/i.test(message)) {
    return 'No escrow exists for that order ID.';
  }
  if (/SameBuyerAndSeller/i.test(message)) {
    return 'The seller cannot be the buyer.';
  }
  if (/InvalidSeller/i.test(message)) {
    return 'The contract rejected the seller address.';
  }
  if (/InvalidBuyer/i.test(message)) {
    return 'The contract requires the buyer to be the connected wallet.';
  }
  if (/InvalidAmount/i.test(message)) {
    return 'The contract rejected the amount.';
  }
  if (/ERC20InsufficientAllowance/i.test(message)) {
    return 'Token allowance is lower than the escrow amount.';
  }
  if (/ERC20InsufficientBalance/i.test(message)) {
    return 'The buyer does not hold enough pUSD.';
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

async function waitForCreatedEscrow(
  orderId: string,
  buyer: string,
  seller: string,
  amountRaw: bigint,
  attempts = 10
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const record = await readEscrow(orderId);
    if (record) {
      return (
        record.buyer.toLowerCase() === buyer.toLowerCase() &&
        record.seller.toLowerCase() === seller.toLowerCase() &&
        record.amount === amountRaw
      );
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

export interface UseEscrowActionsResult {
  tx: EscrowTxState;
  createEscrow: (input: CreateEscrowInput) => Promise<string | null>;
  settle: (orderId: string, kind: 'delivery' | 'failure') => Promise<boolean>;
  reset: () => void;
}

export function useEscrowActions(
  wallet: WalletState,
  decimals = 18
): UseEscrowActionsResult {
  const [tx, setTx] = useState<EscrowTxState>(IDLE);
  const inFlight = useRef(false);
  const confirmedOrder = useRef<string | null>(null);

  /** Estimates gas (proving the call would succeed) and checks ETH for gas. */
  const prepare = useCallback(
    async (to: string, data: string): Promise<string | null> => {
      const provider = getProvider();
      if (!provider || !wallet.address) return null;

      let gasLimitHex: string;
      try {
        gasLimitHex = await provider.request<string>({
          method: 'eth_estimateGas',
          params: [{ from: wallet.address, to, data }],
        });
      } catch (error) {
        setTx(prev => ({
          ...prev,
          phase: 'error',
          error: describeEscrowError(error, 'The transaction would fail on-chain.'),
        }));
        return null;
      }

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
          setTx(prev => ({
            ...prev,
            phase: 'error',
            error: `Not enough ETH for gas. This needs about ${formatEther(
              `0x${required.toString(16)}`
            )} ETH.`,
          }));
          return null;
        }
      } catch {
        // Non-fatal: MetaMask will report its own gas failure.
      }

      return gasLimitHex;
    },
    [wallet.address]
  );

  const createEscrowFlow = useCallback(
    async (input: CreateEscrowInput): Promise<string | null> => {
      const provider = getProvider();

      const fail = (error: string) => {
        setTx(prev => ({ ...prev, phase: 'error', error }));
        return null;
      };

      if (!provider) return fail('MetaMask was not detected.');
      if (!wallet.address) return fail('Connect a wallet before paying.');
      if (!wallet.isCorrectNetwork) {
        return fail('Switch MetaMask to Hardhat Local (chain 31337) first.');
      }

      const seller = input.seller.trim();
      if (!isValidAddress(seller)) return fail('Enter a valid seller wallet address.');
      if (seller.toLowerCase() === ZERO_ADDRESS) {
        return fail('The zero address cannot receive funds.');
      }
      if (seller.toLowerCase() === wallet.address.toLowerCase()) {
        return fail('The seller cannot be the buyer.');
      }
      if (input.amountRaw <= 0n) return fail('The amount must be greater than zero.');

      setTx({ ...IDLE, phase: 'approving', step: 'Checking pUSD balance…' });

      let balance: bigint;
      try {
        balance = await readTokenBalance(wallet.address);
      } catch {
        return fail('Could not read your pUSD balance from the node.');
      }

      if (balance < input.amountRaw) {
        return fail(
          `Insufficient pUSD. You hold ${formatTokenAmount(balance, decimals)} but need ${formatTokenAmount(input.amountRaw, decimals)}.`
        );
      }

      // A collision is astronomically unlikely, but never assume.
      let orderId = generateOrderId();
      if (await readEscrow(orderId)) orderId = generateOrderId();

      setTx(prev => ({ ...prev, step: 'Checking pUSD allowance…' }));

      let allowance: bigint;
      try {
        allowance = await readAllowance(wallet.address, ESCROW_ADDRESS);
      } catch {
        allowance = 0n;
      }

      let approveHash: string | null = null;

      if (allowance < input.amountRaw) {
        setTx({
          ...IDLE,
          phase: 'approving',
          step: 'Approve pUSD in MetaMask…',
        });

        const data = buildApproveCalldata(ESCROW_ADDRESS, input.amountRaw);
        const gas = await prepare(PROOFPAY_USD_ADDRESS, data);
        if (!gas) return null;

        try {
          approveHash = await provider.request<string>({
            method: 'eth_sendTransaction',
            params: [{ from: wallet.address, to: PROOFPAY_USD_ADDRESS, data, gas }],
          });
        } catch (error) {
          return fail(describeEscrowError(error, 'Token approval was not submitted.'));
        }

        setTx(prev => ({ ...prev, step: 'Token approval pending…', approveHash }));

        const approvalReceipt = await waitForReceipt(approveHash);
        if (!approvalReceipt) {
          return fail('No receipt for the approval yet. Check MetaMask activity.');
        }
        if (approvalReceipt.status !== '0x1') {
          return fail('The token approval transaction reverted.');
        }

        setTx(prev => ({
          ...prev,
          phase: 'approved',
          step: 'Token approval confirmed.',
        }));
      }

      setTx(prev => ({
        ...prev,
        phase: 'creating',
        step: 'Create escrow in MetaMask…',
        approveHash,
      }));

      const createData = buildCreateEscrowCalldata(
        orderId,
        wallet.address,
        seller,
        input.amountRaw
      );
      const createGas = await prepare(ESCROW_ADDRESS, createData);
      if (!createGas) return null;

      const succeed = (createHash: string | null, blockNumber: number | null) => {
        saveOrderMetadata(orderId, {
          product: input.product,
          description: input.description,
          sellerLabel: input.sellerLabel,
        });

        setTx({
          phase: 'confirmed',
          step: 'Escrow funded on-chain.',
          approveHash,
          createHash,
          blockNumber,
          error: null,
          orderId,
        });

        return orderId;
      };

      let createHash: string;
      try {
        createHash = await provider.request<string>({
          method: 'eth_sendTransaction',
          params: [
            { from: wallet.address, to: ESCROW_ADDRESS, data: createData, gas: createGas },
          ],
        });
      } catch (error) {
        const code = (error as { code?: number } | null)?.code;
        const mayHaveBeenBroadcast = code !== 4001 && code !== -32002;
        if (
          mayHaveBeenBroadcast &&
          (await waitForCreatedEscrow(
            orderId,
            wallet.address,
            seller,
            input.amountRaw
          ))
        ) {
          return succeed(null, null);
        }
        return fail(describeEscrowError(error, 'Escrow creation was not submitted.'));
      }

      setTx(prev => ({
        ...prev,
        phase: 'creating',
        step: 'Escrow transaction pending…',
        createHash,
      }));

      const createReceipt = await waitForReceipt(createHash);
      if (!createReceipt) {
        if (
          await waitForCreatedEscrow(
            orderId,
            wallet.address,
            seller,
            input.amountRaw
          )
        ) {
          return succeed(createHash, null);
        }
        return fail('No receipt for the escrow transaction yet. Check MetaMask activity.');
      }
      if (createReceipt.status !== '0x1') {
        return fail('The escrow transaction reverted.');
      }

      return succeed(
        createHash,
        createReceipt.blockNumber
          ? Number.parseInt(createReceipt.blockNumber, 16)
          : null
      );
    },
    [wallet.address, wallet.isCorrectNetwork, decimals, prepare]
  );

  const settleFlow = useCallback(
    async (orderId: string, kind: 'delivery' | 'failure'): Promise<boolean> => {
      const provider = getProvider();

      const fail = (error: string) => {
        setTx(prev => ({ ...prev, phase: 'error', error }));
        return false;
      };

      if (!provider) return fail('MetaMask was not detected.');
      if (!wallet.address) return fail('Connect a wallet before settling.');
      if (!wallet.isCorrectNetwork) {
        return fail('Switch MetaMask to Hardhat Local (chain 31337) first.');
      }

      const record = await readEscrow(orderId);
      if (!record) return fail('No escrow exists for that order ID.');
      if (record.status !== ESCROW_CHAIN_STATUS.Funded) {
        return fail('This escrow is already settled.');
      }

      // Advisory only — the contract's onlyOracle check is the real gate.
      const oracle = await readEscrowOracle();
      if (oracle && oracle.toLowerCase() !== wallet.address.toLowerCase()) {
        return fail('Only the contract oracle can settle escrows.');
      }

      setTx({
        ...IDLE,
        phase: 'creating',
        step: kind === 'delivery' ? 'Confirm delivery in MetaMask…' : 'Confirm failure in MetaMask…',
      });

      const data =
        kind === 'delivery'
          ? buildConfirmDeliveryCalldata(orderId)
          : buildConfirmFailureCalldata(orderId);

      const gas = await prepare(ESCROW_ADDRESS, data);
      if (!gas) return false;

      let hash: string;
      try {
        hash = await provider.request<string>({
          method: 'eth_sendTransaction',
          params: [{ from: wallet.address, to: ESCROW_ADDRESS, data, gas }],
        });
      } catch (error) {
        return fail(describeEscrowError(error, 'The settlement was not submitted.'));
      }

      setTx(prev => ({ ...prev, step: 'Settlement transaction pending…', createHash: hash }));

      const receipt = await waitForReceipt(hash);
      if (!receipt) {
        return fail('No settlement receipt yet. Check MetaMask activity.');
      }
      if (receipt.status !== '0x1') {
        return fail('The settlement transaction reverted.');
      }

      const updated = await readEscrow(orderId);
      const expected =
        kind === 'delivery'
          ? ESCROW_CHAIN_STATUS.Released
          : ESCROW_CHAIN_STATUS.Refunded;

      if (!updated || updated.status !== expected) {
        return fail('The contract did not record the expected escrow status.');
      }

      setTx({
        phase: 'confirmed',
        step: kind === 'delivery' ? 'Escrow released to the seller.' : 'Escrow refunded to the buyer.',
        approveHash: null,
        createHash: hash,
        blockNumber: receipt.blockNumber ? Number.parseInt(receipt.blockNumber, 16) : null,
        error: null,
        orderId,
      });

      return true;
    },
    [wallet.address, wallet.isCorrectNetwork, prepare]
  );

  const createEscrow = useCallback(
    async (input: CreateEscrowInput): Promise<string | null> => {
      if (inFlight.current || confirmedOrder.current) return null;
      inFlight.current = true;
      try {
        const orderId = await createEscrowFlow(input);
        if (orderId) confirmedOrder.current = orderId;
        return orderId;
      } catch (error) {
        setTx(prev => ({
          ...prev,
          phase: 'error',
          error: describeEscrowError(error, 'The escrow transaction failed.'),
        }));
        return null;
      } finally {
        inFlight.current = false;
      }
    },
    [createEscrowFlow]
  );

  const settle = useCallback(
    async (orderId: string, kind: 'delivery' | 'failure'): Promise<boolean> => {
      if (inFlight.current) return false;
      inFlight.current = true;
      try {
        return await settleFlow(orderId, kind);
      } catch (error) {
        setTx(prev => ({
          ...prev,
          phase: 'error',
          error: describeEscrowError(error, 'The settlement transaction failed.'),
        }));
        return false;
      } finally {
        inFlight.current = false;
      }
    },
    [settleFlow]
  );

  const reset = useCallback(() => {
    confirmedOrder.current = null;
    setTx(IDLE);
  }, []);

  return { tx, createEscrow, settle, reset };
}
