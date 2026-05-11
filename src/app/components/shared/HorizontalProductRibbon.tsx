// KithLy Horizontal Ribbon - Discovery Engine Component

import { ChevronRight } from 'lucide-react';
import type { Product } from '../../types';
import { ProductCard } from './ProductCard';
import { ScrollArea, ScrollBar } from '../ui/scroll-area';

interface HorizontalProductRibbonProps {
  title: string;
  subtitle?: string;
  products: Product[];
  onViewAll?: () => void;
  onProductClick?: (product: Product) => void;
}

export function HorizontalProductRibbon({
  title,
  subtitle,
  products,
  onViewAll,
  onProductClick,
}: HorizontalProductRibbonProps) {
  return (
    <section className="py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 px-4 md:px-6">
        <div>
          <h2 className="font-light text-black">{title}</h2>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-1 font-light">
              {subtitle}
            </p>
          )}
        </div>

        {onViewAll && (
          <button
            onClick={onViewAll}
            className="flex items-center gap-1 text-sm font-light text-[#F97316] hover:gap-2 transition-all"
          >
            View All
            <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* Horizontal Scroll */}
      <ScrollArea className="w-full whitespace-nowrap">
        <div className="flex gap-4 px-4 md:px-6 pb-4">
          {products.map((product) => (
            <div key={product.id} className="w-64 flex-shrink-0">
              <ProductCard
                product={product}
                onClick={() => onProductClick?.(product)}
              />
            </div>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </section>
  );
}
