/**
 * AdminPageHeader — The consistent gradient header bar used across all admin pages.
 *
 * Usage:
 *   <AdminPageHeader
 *     onBack={() => navigate('/admin')}
 *     title="Manage Shops"
 *     subtitle="Create and edit merchant storefronts"
 *     actions={<Button>...</Button>}
 *   />
 */
import { ArrowLeft, MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '../ui/button';
import { NotificationBell } from '../shared/NotificationBell';
import { cn } from '../ui/utils';

interface AdminPageHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  actions?: React.ReactNode;
  className?: string;
  /** Set false on the messages page itself, where the shortcut is redundant. */
  showCommunication?: boolean;
}

export function AdminPageHeader({
  title,
  subtitle,
  onBack,
  actions,
  className,
  showCommunication = true,
}: AdminPageHeaderProps) {
  const navigate = useNavigate();
  return (
    <div
      className={cn(
        'bg-gradient-to-r from-primary to-primary-light text-primary-foreground',
        className,
      )}
    >
      <div className="container mx-auto px-5 max-w-6xl py-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          {/* Left: back + title */}
          <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto">
            {onBack && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onBack}
                className="text-white/80 hover:text-white hover:bg-white/10 shrink-0 -ml-1"
              >
                <ArrowLeft className="size-4" />
              </Button>
            )}
            <div className="min-w-0">
              <h1 className="text-base font-medium tracking-tight text-white truncate">
                {title}
              </h1>
              {subtitle && (
                <p className="text-[0.75rem] text-white/65 font-light mt-0.5 truncate">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          {/* Right: actions, then the shared communication controls */}
          {(actions || showCommunication) && (
            <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto justify-start sm:justify-end">
              {actions}
              {showCommunication && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => navigate('/admin/messages')}
                    className="text-white/80 hover:text-white hover:bg-white/10"
                    aria-label="Messages"
                  >
                    <MessageSquare className="size-4" />
                  </Button>
                  <NotificationBell tone="light" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
