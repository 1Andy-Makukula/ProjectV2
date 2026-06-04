/**
 * PageShell — Wraps every admin/merchant/sender page with the consistent
 * KithLy background and entrance animation.
 *
 * Includes safe-area padding for Capacitor mobile deployment (notch/home indicator).
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
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
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
        'py-7 px-4 md:px-5',
        contained && 'container mx-auto max-w-6xl',
        className,
      )}
    >
      {children}
    </div>
  );
}
