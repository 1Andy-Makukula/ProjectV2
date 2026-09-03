// The native surface, and the one rule about it.
//
// KithLy ships as one codebase to three places: the web, an Android shell and
// an iOS shell. Every capability below therefore has to answer honestly on a
// device that does not have it — a browser has no haptics engine and no status
// bar, and the same code runs there.
//
// So nothing in the app calls a Capacitor plugin directly. It calls one of
// these, each of which degrades on its own terms: to a web equivalent where one
// exists, and to silence where none does. Failing quietly is right here — a
// missing buzz is not worth an error, and a gift being sent must never fail
// because a phone refused to vibrate.

import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Share } from '@capacitor/share';

/** Running inside an Android or iOS shell rather than a browser. */
export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function platform(): 'ios' | 'android' | 'web' {
  try {
    return Capacitor.getPlatform() as 'ios' | 'android' | 'web';
  } catch {
    return 'web';
  }
}

// ── Haptics ────────────────────────────────────────────────────────────────
//
// Mobile browsers on Android expose the vibration motor, so the web is not
// left silent: it gets a short pulse where a native device gets a shaped one.
// iOS Safari has neither, and gets nothing.

function webVibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* Blocked by the browser, or no motor. Not worth reporting. */
  }
}

/** The lightest possible acknowledgement — a chip changing, a tab moving. */
export async function hapticTick() {
  if (!isNative()) return webVibrate(8);
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    /* no-op */
  }
}

/** Something was added or committed — a tap with weight behind it. */
export async function hapticTap() {
  if (!isNative()) return webVibrate(14);
  try {
    await Haptics.impact({ style: ImpactStyle.Medium });
  } catch {
    /* no-op */
  }
}

/**
 * It worked, and it mattered — a claim code accepted at the counter, a
 * payment confirmed. The one pattern in the app that is meant to be felt
 * across a room.
 */
export async function hapticSuccess() {
  if (!isNative()) return webVibrate([12, 60, 24]);
  try {
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    /* no-op */
  }
}

/** It did not work. Distinct from success by rhythm, not just by strength. */
export async function hapticError() {
  if (!isNative()) return webVibrate([40, 60, 40]);
  try {
    await Haptics.notification({ type: NotificationType.Error });
  } catch {
    /* no-op */
  }
}

// ── Sharing ────────────────────────────────────────────────────────────────

export interface ShareRequest {
  title: string;
  text?: string;
  url: string;
  /** Shown on the native sheet's title bar on Android. */
  dialogTitle?: string;
}

export type ShareOutcome = 'shared' | 'copied' | 'dismissed' | 'failed';

/**
 * One share path for gift links, lists and shops.
 *
 * Three tiers, in order of how good the result is: the native sheet, the
 * browser's own sheet, then the clipboard. The caller is told which happened,
 * because "Link copied" and "Shared" are different things to say to somebody.
 */
export async function shareLink(request: ShareRequest): Promise<ShareOutcome> {
  const { title, text, url, dialogTitle } = request;

  if (isNative()) {
    try {
      await Share.share({ title, text, url, dialogTitle: dialogTitle ?? title });
      return 'shared';
    } catch (error) {
      // The native sheet reports a cancel as a rejection, which is not a
      // failure — the person simply changed their mind.
      if (isDismissal(error)) return 'dismissed';
    }
  }

  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (error) {
      if (isDismissal(error)) return 'dismissed';
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

function isDismissal(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error ?? '').toLowerCase();
  return (
    (error as Error)?.name === 'AbortError' ||
    message.includes('cancel') ||
    message.includes('abort') ||
    message.includes('dismiss')
  );
}
