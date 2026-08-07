import { describe, it, expect } from 'vitest';
import {
  isValidMapsLink,
  isValidTime,
  parseOpeningHours,
  shopOpenState,
} from '../src/utils/openingHours';

// 2026-08-07 is a Friday. Africa/Lusaka is UTC+2 year round (no DST), so a UTC
// instant maps to Lusaka wall time by adding two hours.
const at = (utc: string) => new Date(utc);

const NINE_TO_FIVE = {
  mon: { open: '08:00', close: '17:00' },
  fri: { open: '08:00', close: '17:00' },
};

describe('parseOpeningHours', () => {
  it('returns null when nothing is published', () => {
    expect(parseOpeningHours(null)).toBeNull();
    expect(parseOpeningHours(undefined)).toBeNull();
    expect(parseOpeningHours({})).toBeNull();
  });

  it('rejects a JSON array rather than treating it as an object', () => {
    expect(parseOpeningHours([{ open: '08:00', close: '17:00' }])).toBeNull();
  });

  it('drops unknown days and malformed times instead of throwing', () => {
    const parsed = parseOpeningHours({
      mon: { open: '08:00', close: '17:00' },
      funday: { open: '08:00', close: '17:00' },
      tue: { open: '8:00', close: '17:00' },   // not zero-padded
      wed: { open: '25:00', close: '26:00' },  // out of range
      thu: 'closed',
    });
    expect(parsed).toEqual({ mon: { open: '08:00', close: '17:00' } });
  });

  it('agrees with the database time format', () => {
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('7:30')).toBe(false);
  });
});

describe('shopOpenState', () => {
  it('renders nothing when the shop has not published hours', () => {
    expect(shopOpenState(null)).toBeNull();
    expect(shopOpenState({})).toBeNull();
  });

  it('is open inside trading hours', () => {
    // 08:00 Friday in Lusaka.
    const state = shopOpenState(NINE_TO_FIVE, at('2026-08-07T06:00:00Z'));
    expect(state).toEqual({ isOpen: true, label: 'Open now', detail: 'Closes 17:00' });
  });

  it('is closed before opening, and says when it opens', () => {
    // 07:00 Friday.
    const state = shopOpenState(NINE_TO_FIVE, at('2026-08-07T05:00:00Z'));
    expect(state).toEqual({ isOpen: false, label: 'Closed', detail: 'Opens 08:00' });
  });

  it('is closed at exactly the closing minute', () => {
    // 17:00 Friday — the shop shuts on the hour, it is not still open.
    const state = shopOpenState(NINE_TO_FIVE, at('2026-08-07T15:00:00Z'));
    expect(state?.isOpen).toBe(false);
  });

  it('points at the next trading day once today is over', () => {
    // 18:00 Friday; the next entry is Monday.
    const state = shopOpenState(NINE_TO_FIVE, at('2026-08-07T16:00:00Z'));
    expect(state).toEqual({ isOpen: false, label: 'Closed', detail: 'Opens Monday 08:00' });
  });

  it('uses Lusaka time, not the device clock', () => {
    // 23:00 UTC Thursday is already 01:00 Friday in Lusaka — before opening,
    // and on a different day than the UTC instant suggests.
    const state = shopOpenState(NINE_TO_FIVE, at('2026-08-06T23:00:00Z'));
    expect(state).toEqual({ isOpen: false, label: 'Closed', detail: 'Opens 08:00' });
  });

  describe('spans that cross midnight', () => {
    const LATE_KITCHEN = { fri: { open: '18:00', close: '02:00' } };

    it('is open on the evening side', () => {
      // 19:00 Friday.
      expect(shopOpenState(LATE_KITCHEN, at('2026-08-07T17:00:00Z'))?.isOpen).toBe(true);
    });

    it('is still open after midnight on the following day', () => {
      // 01:30 Saturday — inside Friday's span.
      expect(shopOpenState(LATE_KITCHEN, at('2026-08-07T23:30:00Z'))?.isOpen).toBe(true);
    });

    it('closes once the overnight span ends', () => {
      // 02:30 Saturday.
      expect(shopOpenState(LATE_KITCHEN, at('2026-08-08T00:30:00Z'))?.isOpen).toBe(false);
    });
  });
});

// These must agree with the `shops_maps_link_check` constraint. A drift here
// means the merchant is told their link is valid and the save then fails with a
// raw Postgres constraint violation.
describe('isValidMapsLink', () => {
  it('accepts the shapes Google actually hands out', () => {
    expect(isValidMapsLink('https://maps.app.goo.gl/AbCdEfGh')).toBe(true);
    expect(isValidMapsLink('https://www.google.com/maps/place/Lusaka')).toBe(true);
    expect(isValidMapsLink('https://google.co.zm/maps?q=-15.4,28.3')).toBe(true);
    expect(isValidMapsLink('https://goo.gl/maps/xyz')).toBe(true);
    expect(isValidMapsLink('https://maps.google.com')).toBe(true);
    expect(isValidMapsLink('  https://maps.app.goo.gl/AbCdEfGh  ')).toBe(true);
  });

  it('rejects anything that is not an https Google Maps URL', () => {
    expect(isValidMapsLink('http://maps.app.goo.gl/AbCdEfGh')).toBe(false);
    expect(isValidMapsLink('https://evil.example/google.com/maps')).toBe(false);
    expect(isValidMapsLink('https://googlemaps.evil.example/maps')).toBe(false);
    expect(isValidMapsLink('javascript:alert(1)')).toBe(false);
    expect(isValidMapsLink('')).toBe(false);
  });
});
