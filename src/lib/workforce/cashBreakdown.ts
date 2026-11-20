/** Philippine peso bills and coins, largest first. */
export const PESO_DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1] as const;

export interface CashBreakdown {
  /** Pieces per denomination (only the ones used). */
  pieces: Map<number, number>;
  /** What the chosen bills and coins cannot make: centavos, plus pesos when small coins are turned off. */
  loose: number;
}

/**
 * Fewest bills and coins for one envelope. Works in centavos so 0.1 + 0.2 never drifts.
 * Negative or zero pay gets nothing.
 */
export function cashBreakdown(amount: number, denominations: readonly number[] = PESO_DENOMINATIONS): CashBreakdown {
  const pieces = new Map<number, number>();
  let left = Math.max(0, Math.round(amount * 100));
  for (const denomination of [...denominations].sort((a, b) => b - a)) {
    const unit = Math.round(denomination * 100);
    if (unit <= 0) continue;
    const count = Math.floor(left / unit);
    if (count > 0) {
      pieces.set(denomination, count);
      left -= count * unit;
    }
  }
  return { pieces, loose: left / 100 };
}

export interface CashBreakdownTotals {
  pieces: Map<number, number>;
  loose: number;
  /** Total of all envelopes that get cash (net pay above zero). */
  cash: number;
  envelopes: number;
}

/** Bills and coins to withdraw for every envelope together. */
export function cashBreakdownTotals(amounts: number[], denominations: readonly number[] = PESO_DENOMINATIONS): CashBreakdownTotals {
  const pieces = new Map<number, number>();
  let looseCentavos = 0;
  let cashCentavos = 0;
  let envelopes = 0;
  for (const amount of amounts) {
    if (amount <= 0) continue;
    envelopes += 1;
    cashCentavos += Math.round(amount * 100);
    const single = cashBreakdown(amount, denominations);
    looseCentavos += Math.round(single.loose * 100);
    for (const [denomination, count] of single.pieces) pieces.set(denomination, (pieces.get(denomination) ?? 0) + count);
  }
  return { pieces, loose: looseCentavos / 100, cash: cashCentavos / 100, envelopes };
}
