import { useState, useEffect } from 'react';

/**
 * Calculates the time remaining between now and a future target timestamp.
 * Returns a strictly formatted string: "1d 04h 22m 11s" or a processing state.
 */
export function useSettlementCountdown(targetTime?: string | null): string {
  const [timeLeftStr, setTimeLeftStr] = useState<string>('Processing Batch Clearance...');

  useEffect(() => {
    if (!targetTime) {
      console.warn('[useSettlementCountdown] Warning: targetTime is undefined or null.');
      setTimeLeftStr('Processing Batch Clearance...');
      return;
    }

    const targetMs = new Date(targetTime).getTime();

    // Guard against invalid dates
    if (isNaN(targetMs)) {
      console.warn(`[useSettlementCountdown] Warning: Invalid targetTime format received: "${targetTime}".`);
      setTimeLeftStr('Processing Batch Clearance...');
      return;
    }

    const calculateRemaining = () => {
      const now = Date.now();
      const differenceMs = targetMs - now;

      // If we've reached or passed the target time, switch to processing text
      if (differenceMs <= 0) {
        return 'Processing Batch Clearance...';
      }

      // Calculate time components
      const days = Math.floor(differenceMs / (1000 * 60 * 60 * 24));
      const hours = Math.floor((differenceMs / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((differenceMs / 1000 / 60) % 60);
      const seconds = Math.floor((differenceMs / 1000) % 60);

      // Pad with leading zeros for h, m, s
      const paddedHours = hours.toString().padStart(2, '0');
      const paddedMinutes = minutes.toString().padStart(2, '0');
      const paddedSeconds = seconds.toString().padStart(2, '0');

      return `${days}d ${paddedHours}h ${paddedMinutes}m ${paddedSeconds}s`;
    };

    // Set initial value immediately without waiting for first interval tick
    setTimeLeftStr(calculateRemaining());

    // Tick exactly every second
    const intervalId = setInterval(() => {
      const remaining = calculateRemaining();
      setTimeLeftStr(remaining);
      
      // Stop ticking if we've reached the processing state
      if (remaining === 'Processing Batch Clearance...') {
        clearInterval(intervalId);
      }
    }, 1000);

    // Cleanup interval on unmount or targetTime change
    return () => clearInterval(intervalId);
  }, [targetTime]);

  return timeLeftStr;
}
