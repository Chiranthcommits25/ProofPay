import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowRight,
  CheckCircle2,
  Lock,
  PackageCheck,
  Radio,
  RotateCcw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import StatusBadge from '../components/ui/StatusBadge';
import EscrowLedger from '../components/ui/EscrowLedger';
import type { Order } from '../types';

const STEPS = [
  {
    icon: Lock,
    tone: 'border-accent/25 bg-accent/10 text-accent-ink',
    title: 'Payment locked',
    description:
      'Buyer funds are deposited into a smart contract escrow the moment checkout completes.',
  },
  {
    icon: Radio,
    tone: 'border-accent/25 bg-accent/10 text-accent-ink',
    title: 'Delivery verified',
    description:
      'The authorized local oracle confirms delivery or failure on-chain. Chainlink CRE integration is planned for the next phase.',
  },
  {
    icon: CheckCircle2,
    tone: 'border-success/25 bg-success/10 text-success-ink',
    title: 'Settlement executed',
      description:
        'Confirmed delivery releases funds to the seller. A confirmed failed delivery refunds the buyer in full.',
  },
];

const FEATURES = [
  {
    icon: ShieldCheck,
    title: 'Escrow-first payments',
    description: 'Funds stay locked until the delivery condition is met. No counterparty risk.',
  },
  {
    icon: Radio,
    title: 'Oracle-verified delivery',
    description:
      'The escrow contract enforces an authorized oracle. Chainlink CRE is not connected in this phase.',
  },
  {
    icon: RotateCcw,
    title: 'Oracle-driven resolution',
    description: 'Confirmed delivery releases payment. Confirmed failure triggers a full refund.',
  },
];

// Illustrative only — no simulated order is presented as on-chain data.
const PREVIEW_TIMELINE = [
  { label: 'Escrow funded', detail: 'Example amount', state: 'complete' },
  { label: 'Funds held', detail: 'By the escrow contract', state: 'complete' },
  { label: 'Awaiting settlement', detail: 'Confirmed by the oracle', state: 'active' },
  { label: 'Settlement', detail: 'Release or refund', state: 'pending' },
];

interface LandingPageProps {
  orders: Order[];
}

export default function LandingPage({ orders }: LandingPageProps) {
  const featuredOrder = orders[0];

  return (
    <main id="main" className="flex-1">
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-line-soft">
        <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="hero-glow pointer-events-none absolute inset-x-0 top-0 h-[560px]" aria-hidden="true" />

        <div className="container-page relative">
          <div className="mx-auto flex max-w-3xl flex-col items-center py-20 text-center sm:py-24 lg:py-28">
            <span className="chip">
              <span className="size-1.5 rounded-pill bg-accent" />
              Blockchain escrow · Oracle-verified delivery
            </span>

            <h1 className="mt-7 text-balance text-display text-ink">
              Your money, protected until delivery.
            </h1>

            <p className="mt-6 max-w-xl text-pretty text-lede text-ink-secondary">
              ProofPay holds high-value payments in escrow and settles when the authorized
              oracle confirms delivery — or returns funds if delivery fails.
            </p>

            <div className="mt-9 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center">
              <Link to="/buyer" className="btn btn-primary btn-lg">
                Launch app
                <ArrowRight size={15} />
              </Link>
              <a href="#how-it-works" className="btn btn-secondary btn-lg">
                How it works
                <ArrowDown size={15} />
              </a>
            </div>

            <div className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-label text-ink-muted">
              <span className="flex items-center gap-1.5">
                <ShieldCheck size={13} />
                Non-custodial escrow
              </span>
              <span className="flex items-center gap-1.5">
                <Radio size={13} />
                Local oracle (Phase 2C)
              </span>
              <span className="flex items-center gap-1.5">
                <Wallet size={13} />
                Wallet-native checkout
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Lifecycle ────────────────────────────────────── */}
      <section id="how-it-works" className="container-page scroll-mt-24 py-16 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">How it works</p>
          <h2 className="mt-3 text-balance text-h2 text-ink">
            Three steps, contract-enforced settlement.
          </h2>
          <p className="mt-3 text-body text-ink-secondary">
            Payment and settlement are executed by the escrow contract. Chainlink CRE
            automation is planned; this phase uses a local oracle.
          </p>
        </div>

        <div className="mt-10 overflow-hidden rounded-surface border border-line bg-surface">
          <div className="grid divide-y divide-line-soft md:grid-cols-3 md:divide-x md:divide-y-0">
            {STEPS.map((step, index) => {
              const Icon = step.icon;
              return (
                <div key={step.title} className="p-6 sm:p-8">
                  <div className="flex items-center justify-between">
                    <span
                      className={`flex size-10 items-center justify-center rounded-control border ${step.tone}`}
                    >
                      <Icon size={18} />
                    </span>
                    <span className="font-mono text-label font-medium text-ink-muted">
                      0{index + 1}
                    </span>
                  </div>
                  <h3 className="mt-6 text-h3 text-ink">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-body text-ink-secondary">
                    {step.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

              {/* ── Escrow ledger ────────────────────────────────── */}
      <section className="container-page pb-16 sm:pb-20">
        <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-10">
          <div>
            <p className="eyebrow">Escrow ledger</p>
            <h2 className="mt-3 text-balance text-h2 text-ink">
              See exactly where the money is.
            </h2>
            <p className="mt-3 max-w-md text-body text-ink-secondary">
              Every order renders the same ledger, driven by the escrow contract.
              Funds sit in the contract until settlement, then move to the seller
              — or back to you.
            </p>
          </div>
          {featuredOrder ? (
            <EscrowLedger order={featuredOrder} />
          ) : (
            <div className="rounded-surface border border-line bg-surface px-6 py-10 text-center">
              <p className="text-h3 text-ink">No escrow funded yet</p>
              <p className="mx-auto mt-2 max-w-sm text-body-sm leading-6 text-ink-muted">
                Connect a wallet on Hardhat Local and fund an escrow from checkout —
                the ledger renders the first real record from the contract.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ── Product proof ────────────────────────────────── */}
      <section className="container-page pb-16 sm:pb-20">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="eyebrow">Built for high-value commerce</p>
            <h2 className="mt-3 text-balance text-h2 text-ink">
              Escrow that settles itself.
            </h2>
            <p className="mt-3 max-w-md text-body text-ink-secondary">
              Every order carries its own programmable settlement logic, visible to both
              sides of the transaction.
            </p>

            <ul className="mt-9 space-y-7">
              {FEATURES.map(feature => {
                const Icon = feature.icon;
                return (
                  <li key={feature.title} className="flex gap-4">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-control border border-line bg-elevated text-ink-secondary">
                      <Icon size={16} />
                    </span>
                    <div>
                      <h3 className="text-h3 text-ink">{feature.title}</h3>
                      <p className="mt-1 max-w-sm text-body text-ink-secondary">
                        {feature.description}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Static product preview */}
          <div className="relative">
            <div
              className="pointer-events-none absolute -inset-8 rounded-surface bg-accent/[0.06] blur-3xl"
              aria-hidden="true"
            />
            <div className="relative rounded-surface border border-line bg-surface p-5 shadow-lift sm:p-6">
              <div className="flex items-center justify-between gap-4 border-b border-line-soft pb-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-control border border-accent/25 bg-accent/10 text-accent-ink">
                    <PackageCheck size={16} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-medium text-ink">
                      Example escrow
                    </p>
                    <p className="truncate text-body-xs text-ink-muted">
                      Illustrative lifecycle
                    </p>
                  </div>
                </div>
                <StatusBadge status="FUNDED" />
              </div>

              <ul className="mt-5 space-y-4">
                {PREVIEW_TIMELINE.map((item, index) => {
                  const isLast = index === PREVIEW_TIMELINE.length - 1;
                  return (
                    <li key={item.label} className="relative flex gap-3.5">
                      {!isLast && (
                        <span
                          className={`absolute left-[11px] top-6 bottom-0 w-px ${
                            item.state === 'complete' ? 'bg-success/35' : 'bg-line'
                          }`}
                          aria-hidden="true"
                        />
                      )}
                      <span
                        className={`relative z-10 mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-pill border ${
                          item.state === 'complete'
                            ? 'border-success/30 bg-success/10 text-success-ink'
                            : item.state === 'active'
                              ? 'border-accent/30 bg-accent/10 text-accent-ink'
                              : 'border-line bg-elevated text-ink-muted'
                        }`}
                      >
                        {item.state === 'complete' ? (
                          <CheckCircle2 size={12} />
                        ) : item.state === 'active' ? (
                          <Radio size={10} />
                        ) : (
                          <span className="size-1.5 rounded-pill bg-ink-muted" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1 pb-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-sm font-medium text-ink">{item.label}</p>
                          {item.state === 'active' && (
                            <span className="text-caption font-medium text-accent-ink">Live</span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-body-xs text-ink-muted">{item.detail}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-5 flex items-center justify-between rounded-control border border-line bg-elevated px-4 py-3">
                <div>
                  <p className="text-caption font-medium uppercase tracking-[0.1em] text-ink-muted">
                    Escrow balance
                  </p>
                  <p className="mt-1 text-label text-ink-muted">Example amount</p>
                </div>
                <p className="flex items-baseline gap-1">
                  <span className="amount text-h2">849</span>
                  <span className="text-caption font-semibold tracking-[0.06em] text-ink-muted">
                    pUSD
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────── */}
      <section className="container-page pb-20">
        <div className="relative overflow-hidden rounded-surface border border-line bg-surface px-6 py-10 sm:px-10">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_120%_at_100%_0%,color-mix(in_oklch,var(--color-accent)_14%,transparent),transparent_70%)]"
            aria-hidden="true"
          />
          <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-balance text-h2 text-ink">
                Ready to protect your next order?
              </h2>
              <p className="mt-2 text-body text-ink-secondary">
                Run the full escrow flow in under a minute.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link to="/checkout" className="btn btn-primary btn-lg">
                Start checkout
                <ArrowRight size={15} />
              </Link>
              <Link to="/seller" className="btn btn-secondary btn-lg">
                Seller view
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
