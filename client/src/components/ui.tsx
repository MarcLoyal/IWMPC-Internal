import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Variant = 'primary' | 'secondary' | 'danger' | 'success';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 border-transparent',
  success: 'bg-emerald-700 text-white hover:bg-emerald-800 border-transparent',
  danger: 'bg-white text-red-700 border-red-300 hover:bg-red-50',
  secondary: 'bg-white text-slate-800 border-slate-300 hover:bg-slate-50',
};

const BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-base font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50';

export function buttonClass(variant: Variant = 'secondary', extra = '') {
  return `${BUTTON} ${VARIANT[variant]} ${extra}`;
}

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" {...props} className={buttonClass(variant, className)} />;
}

export function LinkButton({
  to,
  variant = 'secondary',
  className = '',
  children,
}: {
  to: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link to={to} className={buttonClass(variant, className)}>
      {children}
    </Link>
  );
}

export function PrintButton() {
  return (
    <Button onClick={() => window.print()} className="no-print">
      Print
    </Button>
  );
}

export function PageHeader({
  title,
  subtitle,
  back,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: { to: string; label: string };
  children?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {back && (
        <Link to={back.to} className="no-print mb-2 inline-block text-sm font-semibold text-brand-700 hover:underline">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-slate-600">{subtitle}</p>}
        </div>
        {children && <div className="no-print flex flex-wrap items-center gap-2">{children}</div>}
      </div>
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`print-plain rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>
  );
}

type Tone = 'green' | 'yellow' | 'red' | 'gray' | 'blue';

const TONE: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-600/25',
  yellow: 'bg-amber-50 text-amber-900 ring-amber-600/30',
  red: 'bg-red-50 text-red-800 ring-red-600/25',
  gray: 'bg-slate-100 text-slate-700 ring-slate-500/25',
  blue: 'bg-brand-50 text-brand-800 ring-brand-600/25',
};

const DOT: Record<Tone, string> = {
  green: 'bg-emerald-600',
  yellow: 'bg-amber-500',
  red: 'bg-red-600',
  gray: 'bg-slate-400',
  blue: 'bg-brand-600',
};

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-sm font-semibold ring-1 ring-inset ${TONE[tone]}`}
    >
      <span className={`h-2 w-2 rounded-full ${DOT[tone]}`} aria-hidden />
      {children}
    </span>
  );
}

export function MemberBadge({ isMember, pending }: { isMember: boolean; pending?: boolean }) {
  if (isMember) return <Badge tone="green">Member</Badge>;
  if (pending) return <Badge tone="yellow">Non-member · fee not yet paid</Badge>;
  return <Badge tone="gray">Non-member</Badge>;
}

export function Notice({
  tone,
  children,
  className = '',
}: {
  tone: 'error' | 'warning' | 'success' | 'info';
  children: ReactNode;
  className?: string;
}) {
  const style = {
    error: 'border-red-300 bg-red-50 text-red-900',
    warning: 'border-amber-300 bg-amber-50 text-amber-900',
    success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
    info: 'border-brand-200 bg-brand-50 text-brand-900',
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 font-medium ${style} ${className}`}>
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-sm text-slate-500">{hint}</span>}
    </label>
  );
}

export function Loading({ what = '' }: { what?: string }) {
  return <p className="py-10 text-center text-slate-500">Loading{what ? ` ${what}` : ''}…</p>;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="no-print fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} rounded-xl bg-white shadow-xl`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-xl font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg px-2 py-1 text-2xl leading-none text-slate-500 hover:bg-slate-100"
          >
            ×
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 rounded-b-xl">{footer}</div>}
      </div>
    </div>
  );
}

/** A label/value pair, used on profiles and confirmation screens. */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-semibold text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-base text-slate-900">{children || '—'}</dd>
    </div>
  );
}
