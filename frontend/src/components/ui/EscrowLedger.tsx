import { useState } from 'react';
import { Check, Copy, Lock } from 'lucide-react';
import type { Order } from '../../types';
import { shortAddress } from '../../lib/wallet';
import { escrowContractAddress, shortOrderId } from '../../lib/escrow';
import StatusBadge from './StatusBadge';

type Tone = 'muted' | 'accent' | 'success' | 'warning' | 'danger';
type NodeState = 'idle' | 'active' | 'done' | 'error';
type Align = 'start' | 'center' | 'end';

interface LedgerNode {
  key: string;
  role: string;
  name: string;
  detail?: string;
  detailMono?: boolean;
  title?: string;
  mono?: boolean;
  align: Align;
  state: NodeState;
  status: string;
}

interface LedgerView {
  slot: 0 | 1 | 2;
  tone: Tone;
  buyer: { state: NodeState; status: string };
  contract: { state: NodeState; status: string };
  seller: { state: NodeState; status: string };
  summary: string;
}

interface EscrowLedgerProps {
  order: Order;
  className?: string;
}

/**
 * Presentation only. Every value comes from the escrow record the contract
 * returned — this never infers a state the chain has not committed.
 */
function viewFor(order: Order): LedgerView {
  const amount = `${order.amountDisplay} pUSD`;

  switch (order.status) {
    case 'RELEASED':
      return {
        slot: 2,
        tone: 'success',
        buyer: { state: 'done', status: 'Deposited' },
        contract: { state: 'done', status: 'Settled' },
        seller: { state: 'done', status: 'Paid' },
        summary: `Escrow ledger for ${order.id}. ${amount} was released from the contract and paid to the seller.`,
      };
    case 'REFUNDED':
      return {
        slot: 2,
        tone: 'warning',
        buyer: { state: 'done', status: 'Refunded' },
        contract: { state: 'done', status: 'Refunded' },
        seller: { state: 'idle', status: 'Not paid' },
        summary: `Escrow ledger for ${order.id}. ${amount} was refunded from the contract back to the buyer.`,
      };
    default:
      return {
        slot: 1,
        tone: 'accent',
        buyer: { state: 'done', status: 'Deposited' },
        contract: { state: 'active', status: 'Holding funds' },
        seller: { state: 'idle', status: 'Awaiting settlement' },
        summary: `Escrow ledger for ${order.id}. ${amount} is held in the contract. The buyer has deposited and the seller is awaiting settlement.`,
      };
  }
}

export default function EscrowLedger({ order, className = '' }: EscrowLedgerProps) {
  const [copied, setCopied] = useState(false);
  const view = viewFor(order);
  const contract = escrowContractAddress();

  const copyOrderId = () => {
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(order.id).catch(() => undefined);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const nodes: LedgerNode[] = [
    {
      key: 'buyer',
      role: 'Buyer wallet',
      name: shortAddress(order.buyerAddress),
      title: order.buyerAddress,
      mono: true,
      align: 'start',
      state: view.buyer.state,
      status: view.buyer.status,
    },
    {
      key: 'contract',
      role: 'Escrow contract',
      name: 'ProofPay Escrow',
      detail: shortAddress(contract),
      detailMono: true,
      title: contract,
      align: 'center',
      state: view.contract.state,
      status: view.contract.status,
    },
    {
      key: 'seller',
      role: 'Seller wallet',
      name: shortAddress(order.sellerAddress),
      detail: order.sellerLabel || undefined,
      title: order.sellerAddress,
      mono: true,
      align: 'end',
      state: view.seller.state,
      status: view.seller.status,
    },
  ];

  return (
    <figure className={`ledger ${className}`}>
      <figcaption className="ledger-head">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <Lock size={12} className="shrink-0 text-accent-ink" aria-hidden="true" />
          <span className="ledger-title">Escrow ledger</span>
          <span className="ledger-id text-caption" title={order.id}>
            {shortOrderId(order.id)}
          </span>
          <button
            type="button"
            onClick={copyOrderId}
            aria-label={copied ? 'Order ID copied' : 'Copy order ID'}
            title="Copy order ID"
            className="icon-btn ledger-copy"
          >
            {copied ? (
              <Check size={12} className="text-success-ink" />
            ) : (
              <Copy size={12} />
            )}
          </button>
          <StatusBadge status={order.status} />
        </span>
        <span className="ledger-total">
          <span className="amount amount-sm">{order.amountDisplay}</span>
          <span className="ledger-unit">pUSD</span>
        </span>
      </figcaption>

      <div className="ledger-grid">
        {nodes.map(node => (
          <div key={node.key} className="ledger-node" data-align={node.align} data-state={node.state}>
            <p className="ledger-role">{node.role}</p>
            <p
              className={`ledger-name ${node.mono ? 'ledger-name--mono' : ''}`}
              title={node.title ?? node.name}
            >
              {node.name}
            </p>
            {node.detail && (
              <p
                className={`ledger-subname ${node.detailMono ? 'ledger-name--mono' : ''}`}
                title={node.title ?? node.detail}
              >
                {node.detail}
              </p>
            )}
          </div>
        ))}

        <div className="ledger-rail" aria-hidden="true">
          <span className="ledger-track" />
          <span className="ledger-token" data-slot={view.slot} data-tone={view.tone}>
            <span className="ledger-chip">
              <span className="amount amount-xs">{order.amountDisplay}</span>
              <span className="ledger-unit">pUSD</span>
            </span>
          </span>
          <span className="ledger-dot" data-slot="0" data-state={view.buyer.state} />
          <span className="ledger-dot" data-slot="1" data-state={view.contract.state} />
          <span className="ledger-dot" data-slot="2" data-state={view.seller.state} />
        </div>

        {nodes.map(node => (
          <div key={`${node.key}-state`} className="ledger-node" data-align={node.align}>
            <p className="ledger-state" data-state={node.state}>
              {node.status}
            </p>
          </div>
        ))}
      </div>

      <p className="sr-only" aria-live="polite">
        {view.summary}
      </p>
    </figure>
  );
}
