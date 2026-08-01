/**
 * AnimatedMetric — counts a number up to its value on mount.
 *
 * Lifted verbatim out of MerchantDashboard, where it was a file-local helper,
 * so the admin dashboard can use the same motion. Renders a string, not an
 * element, so it drops into any text context.
 */

import { useEffect, useState } from 'react';
import { formatCurrency } from '../../../utils/currency';

const DURATION_MS = 900;

export function AnimatedMetric({
  value,
  isCurrency = false,
}: {
  value: number;
  isCurrency?: boolean;
}) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    // Anyone who has asked the OS to calm animations down gets the final
    // number immediately rather than a count-up.
    const prefersReducedMotion = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    if (prefersReducedMotion) {
      setDisplayValue(value);
      return;
    }

    let frameId = 0;
    const startTime = performance.now();

    const tick = (now: number) => {
      const progress = Math.min((now - startTime) / DURATION_MS, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(value * easedProgress));

      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick);
      }
    };

    setDisplayValue(0);
    frameId = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(frameId);
  }, [value]);

  return isCurrency ? formatCurrency(displayValue) : displayValue.toLocaleString();
}

export default AnimatedMetric;
