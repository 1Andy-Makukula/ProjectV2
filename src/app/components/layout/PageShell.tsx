/**
 * PageShell — Wraps every admin/merchant/sender page with the consistent
 * KithLy background and entrance animation.
 *
 * Usage:
 *   <PageShell>
 *     <PageHeader ... />
 *     <div className="kl-page-body">...</div>
 *   </PageShell>
 */
import { cn } from '../ui/utils';

interface PageShellProps {
  children: React.ReactNode;
  className?: string;
}

export function PageShell({ children, className }: PageShellProps) {
  return (
    <div
      className={cn(
        'min-h-screen bg-background kl-animate-fade-up',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ── Body content area ──────────────────────────────────────────────────────── */
interface PageBodyProps {
  children: React.ReactNode;
  className?: string;
  /** Constrain to a max-width container (default: true) */
  contained?: boolean;
}

export function PageBody({ children, className, contained = true }: PageBodyProps) {
  return (
    <div
      className={cn(
        'py-7',
        contained && 'container mx-auto px-5 max-w-6xl',
        className,
      )}
    >
      {children}
    </div>
  );
}
