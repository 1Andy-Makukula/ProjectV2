// What KithLy promises about your money, in the order people worry about it.
//
// One list, read by the Welcome page and the catalogue hub. They are the same
// three promises in both places and must stay word-for-word identical: a
// guarantee that reads slightly differently on two pages invites the question
// of which one is the real one, and on a money product that question is the
// whole game.
//
// Each is a claim the code actually keeps -- the FX lock is fifteen minutes in
// fx_quotes, the escrow release is the collection scan, and the notification
// fires from the redemption. Edit the copy and the mechanism together or not
// at all.

import { Coins, ScanLine, Shield, type LucideIcon } from 'lucide-react';

export interface TrustPromise {
  icon: LucideIcon;
  title: string;
  body: string;
}

export const PROMISES: ReadonlyArray<TrustPromise> = [
  {
    icon: Coins,
    title: 'The rate you see is the rate you pay',
    body: 'Your kwacha total is locked before you pay, and held for fifteen minutes. No spread hidden in the conversion.',
  },
  {
    icon: Shield,
    title: 'Your money waits in escrow',
    body: 'The shop is not paid when you are. It is paid once your person has collected what you sent.',
  },
  {
    icon: ScanLine,
    title: 'You are told the moment it is handed over',
    body: 'The code is scanned at the counter and you hear about it there and then — not the next day, and not from us guessing.',
  },
];
