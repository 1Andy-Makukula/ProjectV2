// Brand colours for the few places that need real values rather than classes —
// canvas-confetti being the main one, since it paints to a canvas and cannot
// read a Tailwind class.
//
// Resolved from the same CSS custom properties everything else uses, so the
// palette stays defined in exactly one file (theme.css). The fallbacks match
// the token defaults and only apply during SSR or before styles load.

const FALLBACKS: Record<string, string> = {
  '--primary': '#E8460A',
  '--primary-light': '#F26334',
  '--mode-from': '#E8460A',
  '--mode-to': '#F26334',
};

function cssVar(name: string): string {
  if (typeof window === 'undefined') return FALLBACKS[name] ?? '#E8460A';
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || FALLBACKS[name] || '#E8460A';
}

/**
 * Celebration palette, brand-first and fading to white. Reads the active mode's
 * tint, so confetti on a services page comes out amber rather than orange.
 */
export function celebrationColors(): string[] {
  return [cssVar('--mode-from'), cssVar('--mode-to'), '#FDBA74', '#FED7AA', '#ffffff'];
}
