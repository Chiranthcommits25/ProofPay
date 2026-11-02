import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  LogOut,
  Menu,
  Wallet,
  X,
} from 'lucide-react';
import type { TokenState, WalletState } from '../../types';
import { shortAddress } from '../../lib/wallet';
import Logo from '../ui/Logo';

interface NavbarProps {
  wallet: WalletState;
  token: TokenState;
  onConnect: () => Promise<boolean>;
  onDisconnect: () => void;
  onSwitchNetwork: () => void;
  onDismissError: () => void;
}

const NAV_LINKS = [
  { label: 'Buyer', path: '/buyer' },
  { label: 'Seller', path: '/seller' },
  { label: 'Checkout', path: '/checkout' },
  { label: 'Admin', path: '/admin' },
];

export default function Navbar({
  wallet,
  token,
  onConnect,
  onDisconnect,
  onSwitchNetwork,
  onDismissError,
}: NavbarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const closeMenus = () => {
    setMenuOpen(false);
    setWalletOpen(false);
  };

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setWalletOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setWalletOpen(false);
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  const copyAddress = () => {
    if (!wallet.address) return;
    navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleConnect = async () => {
    const connected = await onConnect();
    closeMenus();
    if (connected) navigate('/buyer');
  };

  const isActive = (path: string) =>
    location.pathname === path ||
    (path === '/buyer' && location.pathname.startsWith('/order'));

  const wrongNetwork = wallet.isConnected && !wallet.isCorrectNetwork;
  const connecting = wallet.status === 'connecting';

  return (
    <header className="sticky top-0 z-50 border-b border-line-soft bg-base">
      <div className="container-page">
        <div className="flex h-[68px] items-center justify-between gap-4">
          {/* Left — brand */}
          <Logo className="shrink-0" onClick={closeMenus} />

          {/* Center — primary navigation */}
          <nav
            aria-label="Primary"
            className="hidden items-center gap-0.5 rounded-pill border border-line bg-surface/70 p-1 lg:flex"
          >
            {NAV_LINKS.map(link => (
              <Link
                key={link.path}
                to={link.path}
                onClick={closeMenus}
                aria-current={isActive(link.path) ? 'page' : undefined}
                className={`flex h-8 items-center rounded-pill px-3.5 text-body-sm font-medium transition-colors ${
                  isActive(link.path)
                    ? 'bg-elevated text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]'
                    : 'text-ink-secondary hover:text-ink'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Right — network, balance, wallet */}
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={`chip hidden xl:inline-flex ${
                wrongNetwork ? 'border-warning/30 text-warning-ink' : ''
              }`}
            >
              <span
                className={`size-1.5 rounded-pill ${
                  !wallet.isConnected
                    ? 'bg-ink-muted'
                    : wallet.isCorrectNetwork
                      ? 'bg-success'
                      : 'bg-warning'
                }`}
              />
              {wallet.isConnected
                ? wallet.network || `Chain ${wallet.chainId ?? '—'}`
                : 'Not connected'}
            </span>

            {wallet.isConnected ? (
              <>
                <div className="hidden h-8 items-center gap-1.5 rounded-pill border border-line bg-surface px-3 md:flex">
                  <span className="amount amount-sm text-ink">
                    {token.status === 'ready' ? token.balanceFormatted : '—'}
                  </span>
                  <span className="text-caption font-semibold text-accent-ink">
                    {token.symbol || 'pUSD'}
                  </span>
                </div>

                <div className="relative" ref={dropdownRef}>
                  <button
                    type="button"
                    onClick={() => setWalletOpen(open => !open)}
                    aria-expanded={walletOpen}
                    aria-label="Wallet menu"
                    className={`hit-44 flex h-8 items-center gap-2 rounded-pill border px-3 text-body-sm transition-colors ${
                      walletOpen
                        ? 'border-line-strong bg-raised'
                        : 'border-line bg-elevated hover:border-line-strong'
                    }`}
                  >
                    <Wallet size={13} className="text-ink-muted" />
                    <span className="hidden font-mono text-label text-ink-secondary sm:inline">
                      {wallet.address ? shortAddress(wallet.address) : ''}
                    </span>
                    <ChevronDown
                      size={12}
                      className={`text-ink-muted transition-transform ${walletOpen ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {walletOpen && (
                    <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-surface border border-line bg-surface shadow-pop">
                      <div className="border-b border-line-soft px-4 py-3">
                        <p className="eyebrow">Connected wallet</p>
                        <div className="mt-2 flex items-center justify-between gap-2 rounded-control border border-line bg-elevated px-3 py-2">
                          <span className="truncate font-mono text-label text-ink">
                            {wallet.address}
                          </span>
                          <button
                            type="button"
                            onClick={copyAddress}
                            aria-label="Copy wallet address"
                            className="icon-btn shrink-0"
                          >
                            {copied ? (
                              <Check size={13} className="text-success-ink" />
                            ) : (
                              <Copy size={13} />
                            )}
                          </button>
                        </div>
                      </div>

                      <dl className="space-y-2 border-b border-line-soft px-4 py-3 text-body-sm">
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-ink-muted">Network</dt>
                          <dd className="text-right text-ink-secondary">
                            {wallet.network || 'Unknown'}
                            {wallet.chainId !== null && (
                              <span className="ml-1.5 font-mono text-caption text-ink-muted">
                                {wallet.chainId}
                              </span>
                            )}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-ink-muted">
                            {token.symbol || 'pUSD'} balance
                          </dt>
                          <dd className="amount amount-sm">
                            {token.status === 'ready' ? token.balanceFormatted : '—'}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-ink-muted">ETH (gas)</dt>
                          <dd className="amount amount-sm">{wallet.ethBalance || '—'}</dd>
                        </div>
                      </dl>

                      {wrongNetwork && (
                        <div className="border-b border-line-soft px-4 py-3">
                          <p className="flex items-start gap-2 text-body-xs leading-5 text-warning-ink">
                            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                            <span>
                              ProofPay runs on Hardhat Local (chain 31337). Switch
                              networks to continue.
                            </span>
                          </p>
                          <button
                            type="button"
                            onClick={onSwitchNetwork}
                            disabled={connecting}
                            className="btn btn-secondary btn-sm mt-2 w-full"
                          >
                            {connecting ? 'Switching…' : 'Switch to Hardhat Local'}
                          </button>
                        </div>
                      )}

                      <div className="p-2">
                        <button
                          type="button"
                          onClick={() => {
                            onDisconnect();
                            setWalletOpen(false);
                          }}
                          className="flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-body-sm font-medium text-danger-ink transition-colors hover:bg-danger/10"
                        >
                          <LogOut size={13} />
                          Disconnect wallet
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={handleConnect}
                disabled={connecting}
                className="btn btn-primary h-9 px-3.5 text-body-sm"
              >
                <Wallet size={14} />
                {connecting ? 'Connecting…' : 'Connect Wallet'}
              </button>
            )}

            <button
              type="button"
              onClick={() => setMenuOpen(open => !open)}
              aria-label="Toggle navigation menu"
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              className="hit-44 -mr-1 flex size-9 items-center justify-center rounded-control text-ink-secondary transition-colors hover:bg-elevated hover:text-ink lg:hidden"
            >
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
      </div>

      {/* Provider errors: rejected requests, missing extension, pending prompts */}
      {wallet.error && (
        <div className="border-t border-danger/25 bg-danger/10">
          <div className="container-page flex items-start justify-between gap-3 py-2">
            <p
              role="alert"
              className="flex items-start gap-2 text-body-xs leading-5 text-danger-ink"
            >
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {wallet.error}
            </p>
            <button
              type="button"
              onClick={onDismissError}
              aria-label="Dismiss error"
              className="icon-btn -mr-2 shrink-0"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Mobile navigation */}
      {menuOpen && (
        <div id="mobile-nav" className="border-t border-line-soft bg-base lg:hidden">
          <div className="container-page py-4">
            <nav aria-label="Mobile" className="flex flex-col gap-1">
              {NAV_LINKS.map(link => (
                <Link
                  key={link.path}
                  to={link.path}
                  onClick={closeMenus}
                  aria-current={isActive(link.path) ? 'page' : undefined}
                  className={`flex h-11 items-center rounded-control px-3 text-body-sm font-medium transition-colors ${
                    isActive(link.path)
                      ? 'bg-elevated text-ink'
                      : 'text-ink-secondary hover:bg-elevated hover:text-ink'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-soft pt-3 text-caption text-ink-muted">
              <span className="flex items-center gap-1.5">
                <span
                  className={`size-1.5 rounded-pill ${
                    !wallet.isConnected
                      ? 'bg-ink-muted'
                      : wallet.isCorrectNetwork
                        ? 'bg-success'
                        : 'bg-warning'
                  }`}
                />
                {wallet.isConnected
                  ? `${wallet.network} · ${wallet.chainId}`
                  : 'Not connected'}
              </span>
              {wallet.isConnected && (
                <>
                  <span className="text-ink-secondary">{wallet.ethBalance} ETH</span>
                  <span className="font-mono">
                    {wallet.address ? shortAddress(wallet.address) : ''}
                  </span>
                </>
              )}
            </div>

            {wrongNetwork && (
              <button
                type="button"
                onClick={onSwitchNetwork}
                className="btn btn-secondary btn-sm mt-3 w-full"
              >
                Switch to Hardhat Local
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
