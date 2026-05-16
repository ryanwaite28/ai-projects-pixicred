import { describe, it, expect } from 'vitest';
import { generateCardNumber, generateCardExpiry, generateCardCvv } from '../../src/lib/card';

describe('generateCardNumber', () => {
  it('returns exactly 16 characters', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateCardNumber()).toHaveLength(16);
    }
  });

  it('contains only digit characters', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateCardNumber()).toMatch(/^\d{16}$/);
    }
  });

  it('zero-pads short numbers to 16 digits', () => {
    // The function pads with '0', so all results must be exactly 16 digits
    const result = generateCardNumber();
    expect(result.length).toBe(16);
    expect(Number.isNaN(Number(result))).toBe(false);
  });
});

describe('generateCardExpiry', () => {
  it('returns a date approximately 36 months in the future', () => {
    const from = new Date('2026-01-15T00:00:00Z');
    const expiry = generateCardExpiry(from);
    expect(expiry.getUTCFullYear()).toBe(2029);
    expect(expiry.getUTCMonth()).toBe(0); // January
  });

  it('sets expiry to the first of the month', () => {
    const from = new Date('2026-05-15T12:34:56Z');
    const expiry = generateCardExpiry(from);
    expect(expiry.getUTCDate()).toBe(1);
  });

  it('sets expiry to UTC midnight', () => {
    const from = new Date('2026-05-15T12:34:56Z');
    const expiry = generateCardExpiry(from);
    expect(expiry.getUTCHours()).toBe(0);
    expect(expiry.getUTCMinutes()).toBe(0);
    expect(expiry.getUTCSeconds()).toBe(0);
    expect(expiry.getUTCMilliseconds()).toBe(0);
  });

  it('handles month overflow into next year', () => {
    const from = new Date('2026-11-15T00:00:00Z');
    const expiry = generateCardExpiry(from);
    expect(expiry.getUTCFullYear()).toBe(2029);
    expect(expiry.getUTCMonth()).toBe(10); // November
  });

  it('does not mutate the input date', () => {
    const from = new Date('2026-05-15T00:00:00Z');
    const original = from.getTime();
    generateCardExpiry(from);
    expect(from.getTime()).toBe(original);
  });
});

describe('generateCardCvv', () => {
  it('returns exactly 3 characters', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateCardCvv()).toHaveLength(3);
    }
  });

  it('contains only digit characters', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateCardCvv()).toMatch(/^\d{3}$/);
    }
  });

  it('zero-pads single-digit results to 3 characters', () => {
    // Run many iterations to statistically cover low values
    const results = Array.from({ length: 100 }, () => generateCardCvv());
    results.forEach(cvv => {
      expect(cvv).toHaveLength(3);
      expect(cvv).toMatch(/^\d{3}$/);
    });
  });
});
