import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Check, Loader2, Radio, Undo2 } from 'lucide-react';
import type { Order, WalletState } from '../../types';
import { useEscrowActions } from '../../store/useEscrowActions';
import { shortOrderId, readEscrowOracle } from '../../lib/escrow';
import { receiverAddress, RECEIVER_ABI, isReceiverMode, encodeProcessReportCalldata } from '../../lib/receiver';
import { encodeFunctionData, decodeFunctionResult } from 'viem';
import { getProvider, shortAddress } from '../../lib/wallet';
import { formatUnixDateTime } from '../../lib/format';
import Panel from '../ui/Panel';
import StatusBadge from '../ui/StatusBadge';

interface OraclePanelProps {
  wallet: WalletState;
  orders: Order[];
  onSettled: () => void;
}

export default function OraclePanel({ wallet, orders, onSettled }: OraclePanelProps) {
  const { tx, settle, reset } = useEscrowActions(wallet);
  const [selected, setSelected] = useState('');
  const [oracle, setOracle] = useState<string | null>(null);
  const [receiverManualOracle, setReceiverManualOracle] = useState<string | null>(null);
  const [escrowOracleState, setEscrowOracleState] = useState<string | null>(null);
  const [receiverError, setReceiverError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const addr = receiverAddress();
  const receiverDeployed = Boolean(addr);
  const receiverAuthorized =
    receiverDeployed &&
    Boolean(escrowOracleState) &&
    escrowOracleState.toLowerCase() === addr.toLowerCase();
  const walletAuthorized =
    Boolean(wallet.address) &&
    Boolean(receiverManualOracle) &&
    wallet.address.toLowerCase() === receiverManualOracle.toLowerCase();

  useEffect(() => {
    let cancelled = false;
    void readEscrowOracle().then(value => {
      if (!cancelled) setOracle(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!addr) return;
    let cancelled = false;
    const provider = getProvider();
    const read = async () => {
      if (!provider) return;
      try {
        const data = encodeFunctionData({ abi: RECEIVER_ABI, functionName: 'manualOracle' });
        const hex = await provider.request<string>({
          method: 'eth_call',
          params: [{ to: addr, data }, 'latest'],
        });
        const value = decodeFunctionResult({
          abi: RECEIVER_ABI,
          functionName: 'manualOracle',
          data: hex as `0x${string}`,
        }) as string;
        if (!cancelled) setReceiverManualOracle(value);
      } catch {
        if (!cancelled) setReceiverManualOracle(null);
      }
      try {
        const escrowOracleValue = await readEscrowOracle();
        if (!cancelled) setEscrowOracleState(escrowOracleValue);
      } catch {
        if (!cancelled) setEscrowOracleState(null);
      }
    };
    void read();
    const onAccounts = () => void read();
    provider?.on?.('accountsChanged', onAccounts);
    provider?.on?.('chainChanged', onAccounts);
    return () => {
      cancelled = true;
      provider?.removeListener?.('accountsChanged', onAccounts);
      provider?.removeListener?.('chainChanged', onAccounts);
    };
  }, [addr, wallet.address]);

  const funded = orders.filter(order => order.status === 'FUNDED');

  const submitReceiver = async (kind: 'delivery' | 'failure') => {
    setReceiverError(null);
    if (!addr) {
      setReceiverError('Receiver contract address is not configured.');
      return;
    }
    const provider = getProvider();
    if (!provider || !wallet.address) {
      setReceiverError('Connect a wallet to submit receiver settlement.');
      return;
    }
    if (!receiverManualOracle || wallet.address.toLowerCase() !== receiverManualOracle.toLowerCase()) {
      setReceiverError('Connected wallet is not the authorized manual oracle.');
      return;
    }
    if (!escrowOracleState || escrowOracleState.toLowerCase() !== addr.toLowerCase()) {
      setReceiverError('Receiver is not authorized as escrow oracle.');
      return;
    }
    const selectedOrder = funded.find(order => order.id === selected);
    if (!selectedOrder) {
      setReceiverError('No escrow order selected.');
      return;
    }
    const calldata = encodeProcessReportCalldata(selectedOrder.id, kind, new Date().toISOString());
    try {
      await provider.request<string>({
        method: 'eth_sendTransaction',
        params: [{ from: wallet.address, to: addr, data: calldata }],
      });
    } catch (error) {
      setReceiverError(
        error instanceof Error ? error.message : 'Receiver settlement transaction failed.'
      );
    }
  };
  const selectedOrder = funded.find(order => order.id === selected);

  const isOracle =
    Boolean(wallet.address) &&
    Boolean(oracle) &&
    wallet.address?.toLowerCase() === oracle?.toLowerCase();

  const busy = tx.phase === 'creating' || tx.phase === 'approving';
  const receiverBusy = tx.phase === 'creating' || tx.phase === 'approving';

  const run = async (kind: 'delivery' | 'failure') => {
    if (!selected) return;
    if (isReceiverMode()) {
      await submitReceiver(kind);
      return;
    }
    const ok = await settle(selected, kind);
    if (ok) {
      setSelected('');
      onSettled();
    }
  };

  const copyHash = () => {
    if (!tx.createHash) return;
    void navigator.clipboard.writeText(tx.createHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const receiverSettlementDisabled =
    !receiverDeployed || !receiverAuthorized || !walletAuthorized || !selectedOrder || busy;

  return (
    <Panel
      title="Oracle settlement"
      description="Manual settlement by the contract oracle account."
    >
      <div className="space-y-4">
        {/* This must never be mistaken for automated verification. */}
        <p className="flex items-start gap-2 rounded-control border border-warning/25 bg-warning/10 px-3 py-2.5 text-body-xs leading-5 text-warning-ink">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold">LOCAL ORACLE SIMULATION — CHAINLINK CRE NOT YET
            CONNECTED.</span>{' '}
            These are manual admin transactions, not automated shipment verification.
          </span>
        </p>

        <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-body-xs">
          <div className="flex items-center gap-1.5">
            <dt className="text-ink-muted">Oracle</dt>
            <dd className="font-mono text-ink-secondary">
              {oracle ? shortAddress(oracle) : '—'}
            </dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-ink-muted">Funded escrows</dt>
            <dd className="font-medium text-ink">{funded.length}</dd>
          </div>
        </dl>

        {receiverDeployed && (
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-body-xs">
            <div className="flex items-center gap-1.5">
              <dt className="text-ink-muted">Receiver</dt>
              <dd className="font-mono text-ink-secondary">
                {addr ? shortAddress(addr) : '—'}
              </dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="text-ink-muted">Manual Oracle</dt>
              <dd className="font-mono text-ink-secondary">
                {receiverManualOracle ? shortAddress(receiverManualOracle) : '—'}
              </dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="text-ink-muted">Connected Wallet</dt>
              <dd className={`font-mono text-ink-secondary ${walletAuthorized ? 'text-success-ink' : 'text-danger-ink'}`}>
                {walletAuthorized ? 'Authorized' : 'Unauthorized'}
              </dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="text-ink-muted">Escrow Oracle</dt>
              <dd className="font-mono text-ink-secondary">
                {escrowOracleState ? shortAddress(escrowOracleState) : '—'}
              </dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="text-ink-muted">Receiver Authorization</dt>
              <dd className={`font-mono text-ink-secondary ${receiverAuthorized ? 'text-success-ink' : 'text-danger-ink'}`}>
                {receiverAuthorized ? 'Authorized' : 'Not authorized'}
              </dd>
            </div>
          </dl>
        )}

        {!receiverDeployed && (
          <p className="text-body-xs leading-5 text-ink-muted">
            Receiver contract is not deployed. Set <span className="font-mono">VITE_RECEIVER_CONTRACT_ADDRESS</span> to enable receiver mode.
          </p>
        )}

        {receiverDeployed && !receiverAuthorized && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-control border border-warning/25 bg-warning/10 px-3 py-2.5 text-body-xs leading-5 text-warning-ink"
          >
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            Receiver deployed but not yet authorized as escrow oracle.
          </p>
        )}

        {wallet.isConnected && oracle && !isOracle && !isReceiverMode() && (
          <p className="text-body-xs leading-5 text-warning-ink">
            The connected wallet is not the oracle. Settlement transactions will revert
            on-chain.
          </p>
        )}

        {receiverError && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-control border border-danger/25 bg-danger/10 px-3 py-2.5 text-body-xs leading-5 text-danger-ink"
          >
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {receiverError}
          </p>
        )}

        {funded.length === 0 ? (
          <p className="text-body-sm text-ink-muted">
            No funded escrows are awaiting settlement.
          </p>
        ) : (
          <>
            <div>
              <label htmlFor="oracle-order" className="field-label">
                Escrow order
              </label>
              <select
                id="oracle-order"
                value={selected}
                onChange={event => {
                  setSelected(event.target.value);
                  reset();
                }}
                disabled={busy}
                className="field cursor-pointer"
              >
                <option value="">Select a funded escrow</option>
                {funded.map(order => (
                  <option key={order.id} value={order.id}>
                    {shortOrderId(order.id)} · {order.amountDisplay} pUSD ·{' '}
                    {order.product || shortAddress(order.sellerAddress)}
                  </option>
                ))}
              </select>
            </div>

            {selectedOrder && (
              <div className="space-y-2 rounded-control border border-line bg-elevated px-3 py-2.5 text-body-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink-muted">Amount held</span>
                  <span className="amount amount-sm">{selectedOrder.amountDisplay} pUSD</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink-muted">Buyer</span>
                  <span className="font-mono text-ink-secondary">
                    {shortAddress(selectedOrder.buyerAddress)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink-muted">Seller</span>
                  <span className="font-mono text-ink-secondary">
                    {shortAddress(selectedOrder.sellerAddress)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink-muted">Funded</span>
                  <span className="text-ink-secondary">
                    {formatUnixDateTime(selectedOrder.createdAt)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink-muted">Status</span>
                  <StatusBadge status={selectedOrder.status} />
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => void run('delivery')}
                disabled={receiverSettlementDisabled || !receiverAuthorized || !walletAuthorized}
                aria-busy={receiverBusy}
                className="btn btn-primary"
              >
                {receiverBusy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Confirm delivery → release
              </button>
              <button
                type="button"
                onClick={() => void run('failure')}
                disabled={receiverSettlementDisabled || !receiverAuthorized || !walletAuthorized}
                className="btn btn-danger"
              >
                <Undo2 size={14} />
                Confirm failure → refund
              </button>
            </div>
            <p className="flex items-start gap-1.5 text-body-xs leading-5 text-ink-muted">
              <Radio size={12} className="mt-0.5 shrink-0" />
              Delivery releases the full amount to the seller. Failure refunds the buyer.
              The contract enforces <span className="font-mono">onlyOracle</span>.
            </p>
          </>
        )}

        {tx.error && !isReceiverMode() && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-control border border-danger/25 bg-danger/10 px-3 py-2.5 text-body-xs leading-5 text-danger-ink"
          >
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {tx.error}
          </p>
        )}

        {(tx.phase === 'creating' || tx.phase === 'confirmed') && !isReceiverMode() && (
          <div
            role="status"
            aria-live="polite"
            className="space-y-2 rounded-control border border-line bg-elevated px-3 py-2.5"
          >
            <p
              className={`flex items-center gap-2 text-body-xs font-medium ${
                tx.phase === 'confirmed' ? 'text-success-ink' : 'text-ink'
              }`}
            >
              {tx.phase === 'confirmed' ? (
                <CheckCircle2 size={13} className="shrink-0" />
              ) : (
                <Loader2 size={13} className="shrink-0 animate-spin" />
              )}
              {tx.step}
              {tx.phase === 'confirmed' && tx.blockNumber !== null
                ? ` Block ${tx.blockNumber}.`
                : ''}
            </p>
            {tx.createHash && (
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 font-mono text-caption leading-5 break-all text-ink-muted">
                  {tx.createHash}
                </p>
                <button
                  type="button"
                  onClick={copyHash}
                  aria-label="Copy transaction hash"
                  className="icon-btn shrink-0"
                >
                  {copied ? (
                    <Check size={12} className="text-success-ink" />
                  ) : (
                    <Copy size={12} />
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
