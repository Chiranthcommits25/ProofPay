import { Link } from 'react-router-dom';
import Logo from '../ui/Logo';

const FOOTER_LINKS = [
  { label: 'Buyer', path: '/buyer' },
  { label: 'Seller', path: '/seller' },
  { label: 'Checkout', path: '/checkout' },
  { label: 'Admin', path: '/admin' },
];

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-line-soft">
      <div className="container-page">
        <div className="flex flex-col gap-8 py-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-3 text-body-sm leading-6 text-ink-muted">
              Escrow protection for high-value commerce. Funds settle only when
              delivery is verified.
            </p>
          </div>

          <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-2 text-body-sm">
            {FOOTER_LINKS.map(link => (
              <Link
                key={link.path}
                to={link.path}
                className="text-ink-secondary transition-colors hover:text-ink"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex flex-col gap-2 border-t border-line-soft py-5 text-label text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} ProofPay. Demo application.</p>
          <p className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-pill bg-warning" />
            Hardhat Local testnet — test funds only.
          </p>
        </div>
      </div>
    </footer>
  );
}
