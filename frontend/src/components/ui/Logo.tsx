import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';

interface LogoProps {
  showWordmark?: boolean;
  className?: string;
  onClick?: () => void;
}

export default function Logo({ showWordmark = true, className = '', onClick }: LogoProps) {
  return (
    <Link
      to="/"
      aria-label="ProofPay home"
      onClick={onClick}
      className={`inline-flex items-center gap-2.5 ${className}`}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-accent-strong text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18)]">
        <ShieldCheck size={17} strokeWidth={2.2} />
      </span>
      {showWordmark && (
        <span className="text-h3 font-semibold tracking-[-0.02em] text-ink">ProofPay</span>
      )}
    </Link>
  );
}
