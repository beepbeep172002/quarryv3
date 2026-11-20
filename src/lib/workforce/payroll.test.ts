import { describe, expect, it } from 'vitest';
import {
  buildPayrollLine,
  computePay,
  fromSavedLine,
  nextPeriodRange,
  payrollTotals,
  prefillCaDeduction,
  prefillChargeDeduction,
  rateOn,
  rateWarning,
  recomputeLine,
  toSavePayload,
  type PayInputs,
} from './payroll';
import { DEFAULT_PAY_RULES } from './types';

const BASE: PayInputs = {
  dailyRate: 610,
  days: 6,
  otHours: 5,
  ndHours: 3,
  regHolidays: 1,
  specialHolidaysWorked: 1,
  caDeduction: 500,
  chargeDeduction: 0,
  sss: 0,
  philhealth: 0,
  pagibig: 0,
  otherDeductions: 0,
};

describe('payroll engine (client Salary.xlsx formulas)', () => {
  it('computes each column with the client defaults', () => {
    expect(computePay(BASE, DEFAULT_PAY_RULES)).toEqual({
      hourlyRate: 76.25,
      basicPay: 3660,
      otPay: 381.25, // 5 x 76.25 x 1.00
      ndPay: 22.88, // 3 x 76.25 x 0.10 = 22.875
      holidayPay: 793, // 610 + 610 x 0.30
      grossPay: 4857.13,
      totalDeductions: 500,
      netPay: 4357.13,
    });
  });

  it('follows the OT multiplier setting (law: 1.25)', () => {
    expect(computePay(BASE, { ...DEFAULT_PAY_RULES, otMultiplier: 1.25 }).otPay).toBe(476.56);
  });

  it('rounds to 2 decimals and keeps gross equal to the sum of its rounded parts', () => {
    const amounts = computePay({ ...BASE, dailyRate: 575, ndHours: 1 }, DEFAULT_PAY_RULES);
    expect(amounts.hourlyRate).toBe(71.88);
    expect(amounts.ndPay).toBe(7.19);
    expect(amounts.grossPay).toBe(Math.round((amounts.basicPay + amounts.otPay + amounts.ndPay + amounts.holidayPay) * 100) / 100);
  });

  it('subtracts every deduction from gross', () => {
    const amounts = computePay({ ...BASE, caDeduction: 100, sss: 50, philhealth: 25, pagibig: 10, otherDeductions: 15 }, DEFAULT_PAY_RULES);
    expect(amounts.totalDeductions).toBe(200);
    expect(amounts.netPay).toBe(4657.13);
  });

  it('treats a missing rate as zero pay', () => {
    expect(computePay({ ...BASE, dailyRate: Number.NaN }, DEFAULT_PAY_RULES).grossPay).toBe(0);
  });
});

describe('cash advance prefill', () => {
  it.each([
    [1500, 500, 500],
    [300, 500, 300],
    [0, 500, 0],
    [-50, 500, 0],
    [1000, 0, 1000],
  ])('balance %d, per payroll %d -> %d', (balance, perPayroll, expected) => {
    expect(prefillCaDeduction(balance, perPayroll)).toBe(expected);
  });

  it.each([
    [1000, 0, 4000, 1000],
    [1000, 0, 600, 600],
    [1000, 0, -50, 0],
    [1000, 500, 300, 500],
  ])('balance %d, per payroll %d, pay left %d -> %d', (balance, perPayroll, payLeft, expected) => {
    expect(prefillCaDeduction(balance, perPayroll, payLeft)).toBe(expected);
  });
});

describe('charges prefill (cafeteria tab)', () => {
  it.each([
    [800, 4000, 800],
    [800, 300, 300],
    [800, -20, 0],
    [0, 4000, 0],
    [-100, 4000, 0],
  ])('balance %d, pay left %d -> %d', (balance, payLeft, expected) => {
    expect(prefillChargeDeduction(balance, payLeft)).toBe(expected);
  });

  it('deducts charges after C.A and kept deductions, never past zero net', () => {
    const line = buildPayrollLine({
      employeeId: 'b',
      employeeName: 'SAMPLE, BETA',
      biometricId: '8',
      payType: 'daily',
      dailyRate: 600,
      summary: { days: 2, otHours: 0, ndHours: 0, regHolidays: 0, specialHolidaysWorked: 0 },
      caBalance: 1000,
      caPerPayroll: 500,
      chargeBalance: 900,
      kept: { sss: 100, philhealth: 0, pagibig: 0, otherDeductions: 0 },
      rules: DEFAULT_PAY_RULES,
    });
    // Gross 1,200 - C.A 500 - SSS 100 = 600 left, so only 600 of the 900 tab is taken.
    expect(line).toMatchObject({ grossPay: 1200, caDeduction: 500, sss: 100, chargeDeduction: 600, totalDeductions: 1200, netPay: 0 });
  });

  it('reads rows saved before charges existed as zero charges', () => {
    const [row] = toSavePayload([buildPayrollLine({
      employeeId: 'c', employeeName: 'X', biometricId: '9', payType: 'daily', dailyRate: 600,
      summary: { days: 1, otHours: 0, ndHours: 0, regHolidays: 0, specialHolidaysWorked: 0 },
      caBalance: 0, caPerPayroll: 0, rules: DEFAULT_PAY_RULES,
    })]);
    const legacy: Partial<typeof row> = { ...row };
    delete legacy.charge_deduction;
    expect(fromSavedLine(legacy as typeof row).chargeDeduction).toBe(0);
  });
});

describe('rates', () => {
  const history = [
    { employeeId: 'a', dailyRate: 550, effectiveFrom: '2026-01-01' },
    { employeeId: 'a', dailyRate: 610, effectiveFrom: '2026-10-05' },
    { employeeId: 'b', dailyRate: 700, effectiveFrom: '2026-11-01' },
  ];

  it('uses the rate in effect on the given date', () => {
    expect(rateOn(history, 'a', '2026-10-04')).toBe(550);
    expect(rateOn(history, 'a', '2026-10-11')).toBe(610);
    expect(rateOn(history, 'b', '2026-10-11')).toBeNull();
  });

  it('warns about missing and below-minimum rates', () => {
    expect(rateWarning(null, 'daily', 600)).toBe('no_rate');
    expect(rateWarning(550, 'daily', 600)).toBe('below_minimum');
    expect(rateWarning(550, 'fixed', 600)).toBeNull();
    expect(rateWarning(610, 'daily', 600)).toBeNull();
  });
});

describe('register lines', () => {
  const line = buildPayrollLine({
    employeeId: 'a',
    employeeName: 'TESTER, ALPHA',
    biometricId: '7',
    payType: 'daily',
    dailyRate: 610,
    summary: { days: 6, otHours: 5, ndHours: 3, regHolidays: 1, specialHolidaysWorked: 1 },
    caBalance: 1500,
    caPerPayroll: 500,
    rules: DEFAULT_PAY_RULES,
  });

  it('prefills the register from the timecard summary', () => {
    expect(line).toMatchObject({ caDeduction: 500, grossPay: 4857.13, netPay: 4357.13 });
  });

  it('recomputes after an edit', () => {
    expect(recomputeLine({ ...line, days: 5 }, DEFAULT_PAY_RULES).basicPay).toBe(3050);
  });

  it('round-trips through the save payload', () => {
    const [row] = toSavePayload([line]);
    expect(row).toMatchObject({ employee_id: 'a', gross_pay: 4857.13, net_pay: 4357.13, ca_deduction: 500 });
    expect(fromSavedLine(row)).toEqual(line);
  });

  it('totals the register', () => {
    expect(payrollTotals([line, line])).toMatchObject({ grossPay: 9714.26, netPay: 8714.26 });
  });
});

describe('next payroll period', () => {
  it('starts the day after the last period and lasts 7 days', () => {
    expect(nextPeriodRange('2026-10-07', '2026-10-29')).toEqual({ dateFrom: '2026-10-08', dateTo: '2026-10-14' });
  });

  it('defaults to the 7 days ending today without history', () => {
    expect(nextPeriodRange(null, '2026-10-29')).toEqual({ dateFrom: '2026-10-23', dateTo: '2026-10-29' });
  });
});
