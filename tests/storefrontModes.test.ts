import { describe, it, expect } from 'vitest';
import {
  STOREFRONT_MODES,
  modeCartIcon,
  modeDefinition,
  modeDensity,
  modeLexicon,
  modeRail,
} from '../src/app/types/storefrontModes';

// Each face of the storefront is described by one object, and the accessors
// fill in whatever it does not say. That contract is what lets one mode be
// dressed in detail without the other four being touched — so it is worth a
// test, because the failure mode is a half-built face rather than an error.
describe('mode dressing falls back', () => {
  it('gives every mode a complete lexicon', () => {
    for (const mode of STOREFRONT_MODES) {
      const lexicon = modeLexicon(mode.value);
      expect(lexicon.cart).toBeTruthy();
      expect(lexicon.add).toBeTruthy();
      expect(lexicon.addAll).toBeTruthy();
      expect(lexicon.save).toBeTruthy();
    }
  });

  it('gives every mode a grid ladder, a cart glyph and a rail', () => {
    for (const mode of STOREFRONT_MODES) {
      expect(modeDensity(mode.value)).toContain('grid');
      expect(modeCartIcon(mode.value)).toBeTruthy();
      expect(modeRail(mode.value).length).toBeGreaterThan(0);
    }
  });

  it('leaves an undressed mode on the plain defaults', () => {
    // Discover deliberately says nothing about words or ornament.
    const discover = modeDefinition('discover');
    expect(discover.lexicon).toBeUndefined();
    expect(discover.ornament).toBeUndefined();
    expect(modeLexicon('discover').add).toBe('Add');
    expect(modeRail('discover')).toContain('status');
  });
});

describe('gifting', () => {
  it('speaks its own language', () => {
    const lexicon = modeLexicon('gifting');
    expect(lexicon.cart).toBe('Gift bag');
    expect(lexicon.add).toBe('Stash');
  });

  it('is denser than it was, and still looser than the standard grid', () => {
    const gifting = modeDensity('gifting');
    // Two across on a phone rather than one, three beside the rail.
    expect(gifting).toContain('grid-cols-2');
    expect(gifting).toContain('xl:grid-cols-3');
    expect(gifting).not.toBe(modeDensity('discover'));
  });

  it('carries the ribbon, and leads its rail with what is already in flight', () => {
    expect(modeDefinition('gifting').ornament).toBe('gift');
    const rail = modeRail('gifting');
    expect(rail[0]).toBe('status');
    expect(rail).toContain('occasions');
  });

  it('is the only mode with occasions, since it is the only one with dates', () => {
    const withOccasions = STOREFRONT_MODES.filter((mode) =>
      modeRail(mode.value).includes('occasions'),
    );
    expect(withOccasions.map((mode) => mode.value)).toEqual(['gifting']);
  });
});
