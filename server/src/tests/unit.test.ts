import { describe, expect, it } from 'vitest';
import { formatPeso, parseMoney } from '../lib/money';
import { findOrGaps, normalizeOr } from '../lib/orNumbers';
import { isDateString, todayManila } from '../lib/dates';
import { formatNumber } from '../services/numbering';

describe('money', () => {
  it('always shows pesos with commas and two decimals', () => {
    expect(formatPeso('1250')).toBe('₱1,250.00');
    expect(formatPeso('1234567.5')).toBe('₱1,234,567.50');
    expect(formatPeso('0')).toBe('₱0.00');
  });

  it('parses what a cashier might type', () => {
    expect(parseMoney('1250')?.toFixed(2)).toBe('1250.00');
    expect(parseMoney('₱1,250.50')?.toFixed(2)).toBe('1250.50');
    expect(parseMoney(' 99.9 ')?.toFixed(2)).toBe('99.90');
  });

  it('rejects things that are not peso amounts', () => {
    for (const bad of ['', 'abc', '-5', '1.234', '1e3', '12..5']) expect(parseMoney(bad)).toBeNull();
  });

  it('keeps cents exact (no float rounding)', () => {
    expect(parseMoney('0.10')!.plus(parseMoney('0.20')!).toFixed(2)).toBe('0.30');
  });
});

describe('OR numbers', () => {
  it('ignores spaces and letter case', () => {
    expect(normalizeOr('  a-1045 ')).toBe('A-1045');
  });

  it('flags a skipped number: 1045, 1046, 1048', () => {
    const gaps = findOrGaps(['1045', '1046', '1048']);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ after: '1046', before: '1048', missing: ['1047'], missingCount: 1 });
  });

  it('finds no gaps in a complete run, in any order', () => {
    expect(findOrGaps(['1003', '1001', '1002'])).toEqual([]);
    expect(findOrGaps([])).toEqual([]);
    expect(findOrGaps(['1001'])).toEqual([]);
  });

  it('keeps leading zeros and prefixes', () => {
    expect(findOrGaps(['0098', '0101'])[0].missing).toEqual(['0099', '0100']);
    expect(findOrGaps(['A-7', 'A-9'])[0].missing).toEqual(['A-8']);
  });

  it('does not mix two booklets with different prefixes', () => {
    expect(findOrGaps(['A-1', 'A-2', 'B-50', 'B-51'])).toEqual([]);
  });

  it('caps the list when the gap is huge (likely a typo)', () => {
    const [gap] = findOrGaps(['1045', '10450']);
    expect(gap.missingCount).toBe(9404);
    expect(gap.missing).toHaveLength(20);
  });
});

describe('dates and numbering', () => {
  it('uses the Philippine calendar date', () => {
    // 5:30 PM UTC on Nov 12 is already 1:30 AM Nov 13 in Manila.
    expect(todayManila(new Date('2026-11-12T17:30:00Z'))).toBe('2026-11-13');
  });

  it('validates dates', () => {
    expect(isDateString('2026-02-28')).toBe(true);
    expect(isDateString('2026-02-30')).toBe(false);
    expect(isDateString('12/11/2026')).toBe(false);
  });

  it('formats account and member numbers', () => {
    expect(formatNumber('A-', 4, 1)).toBe('A-0001');
    expect(formatNumber('', 4, 123)).toBe('0123');
    expect(formatNumber('M-', 4, 12345)).toBe('M-12345');
  });
});
