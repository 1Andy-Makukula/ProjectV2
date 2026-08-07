import { ConciergeBell, Package, Store } from 'lucide-react';
import { Badge } from '../ui/badge';
import { cn } from '../ui/utils';

interface ShopOfferingBadgeProps {
  offersProducts?: boolean | null;
  offersServices?: boolean | null;
  className?: string;
}

/**
 * What a shop actually sells — products, services, or both.
 *
 * The declaration is captured at onboarding (`shops.offers_products` /
 * `offers_services`, see 20260727010000_merchant_offerings_and_kyc_review.sql)
 * and already gates which item types the merchant may list. Until now it was
 * only ever rendered on the storefront, and only when services were offered, so
 * neither an admin reviewing a shop nor the merchant themselves could see what
 * the platform had them down as.
 *
 * Icons match the storefront's existing vocabulary: Package for goods,
 * ConciergeBell for services (see StorefrontProductCard).
 */
export function ShopOfferingBadge({
  offersProducts,
  offersServices,
  className,
}: ShopOfferingBadgeProps) {
  const products = Boolean(offersProducts);
  const services = Boolean(offersServices);

  // A shop must offer at least one (enforced by shops_offers_something_check),
  // but a partial record loaded before that constraint existed should render
  // nothing rather than an empty pill.
  if (!products && !services) return null;

  const { Icon, label } = products && services
    ? { Icon: Store, label: 'Products & Services' }
    : products
      ? { Icon: Package, label: 'Products' }
      : { Icon: ConciergeBell, label: 'Services' };

  return (
    <Badge variant="secondary" className={cn(className)}>
      <Icon strokeWidth={2} />
      {label}
    </Badge>
  );
}
