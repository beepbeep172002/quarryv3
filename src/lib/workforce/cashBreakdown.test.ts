import { describe, expect, it } from 'vitest';
import { cashBreakdown, cashBreakdownTotals } from './cashBreakdown';

const asObject = (pieces: Map<number, number>) => Object.fromEntries(pieces);

describe('cashBreakdown', () => {
  it('uses the fewest bills and coins', () => {
    expect(asObject(cashBreakdown(4350).pieces)).toEqual({ 1000: 4, 200: 1, 100: 1, 50: 1 });
    expect(asObject(cashBreakdown(1888).pieces)).toEqual({ 1000: 1, 500: 1, 200: 1, 100: 1, 50: 1, 20: 1, 10: 1, 5: 1, 1: 3 });
    expect(cashBreakdown(4350).loose).toBe(0);
  });

  it('keeps centavos as loose change', () => {
    const result = cashBreakdown(2456.75);
    expect(asObject(result.pieces)).toEqual({ 1000: 2, 200: 2, 50: 1, 5: 1, 1: 1 });
    expect(result.loose).toBe(0.75);
  });

  it('puts pesos that turned-off coins would make into loose change', () => {
    const result = cashBreakdown(1237, [1000, 500, 200, 100, 50, 20]);
    expect(asObject(result.pieces)).toEqual({ 1000: 1, 200: 1, 20: 1 });
    expect(result.loose).toBe(17);
  });

  it('gives nothing for zero or negative pay', () => {
    expect(cashBreakdown(0).pieces.size).toBe(0);
    expect(cashBreakdown(-150).loose).toBe(0);
  });
});

describe('cashBreakdownTotals', () => {
  it('adds up every envelope and skips zero or negative pay', () => {
    const totals = cashBreakdownTotals([4350, 1888, 0, -20, 0.5]);
    expect(totals.envelopes).toBe(3);
    expect(totals.cash).toBe(6238.5);
    expect(totals.loose).toBe(0.5);
    expect(asObject(totals.pieces)).toEqual({ 1000: 5, 500: 1, 200: 2, 100: 2, 50: 2, 20: 1, 10: 1, 5: 1, 1: 3 });
  });

  it('is exact for amounts that drift as floats', () => {
    expect(cashBreakdownTotals([0.1, 0.2]).loose).toBe(0.3);
  });
});
