import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Banknote, Download, Printer, X } from 'lucide-react';
import { cashBreakdown, cashBreakdownTotals, PESO_DENOMINATIONS } from '../../lib/workforce/cashBreakdown';
import { formatPeriod, money, peso } from '../../lib/workforce/format';
import type { PayrollLine } from '../../lib/workforce/payroll';
import { csvEscape, downloadTextFile } from '../fuel/fuelUtils';

interface Props {
  dateFrom: string;
  dateTo: string;
  lines: PayrollLine[];
  /** Department by employee id, for grouping envelopes. */
  departmentOf: (employeeId: string) => string;
  onClose: () => void;
}

const STORAGE_KEY = 'wf-cash-breakdown-denominations';

// Only the sheet is printed: everything else in <body> is hidden.
const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 10mm; }
  body > *:not(.wf-print-root) { display: none !important; }
  html, body { background: #fff !important; }
  .wf-print-root { position: static !important; overflow: visible !important; background: #fff !important; padding: 0 !important; }
  .wf-print-root .wf-no-print { display: none !important; }
  .wf-print-sheet { box-shadow: none !important; border: 0 !important; padding: 0 !important; max-width: none !important; }
  .wf-print-sheet tr { break-inside: avoid; page-break-inside: avoid; }
}
`;

function loadDenominations(): number[] {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(saved)) {
      const valid = PESO_DENOMINATIONS.filter(value => saved.includes(value));
      if (valid.length) return valid;
    }
  } catch {
    // Storage blocked or bad value: use every denomination.
  }
  return [...PESO_DENOMINATIONS];
}

function label(denomination: number) {
  return `₱${denomination.toLocaleString('en-PH')}`;
}

/** Bills and coins for each pay envelope, plus the total to withdraw from the bank. */
export default function CashBreakdownSheet({ dateFrom, dateTo, lines, departmentOf, onClose }: Props) {
  const [denominations, setDenominations] = useState<number[]>(loadDenominations);

  function toggle(denomination: number) {
    setDenominations(current => {
      const next = current.includes(denomination) ? current.filter(value => value !== denomination) : [...current, denomination];
      if (next.length === 0) return current;
      const ordered = PESO_DENOMINATIONS.filter(value => next.includes(value));
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ordered)); } catch { /* not saved, still works */ }
      return ordered;
    });
  }

  const envelopes = useMemo(() => lines
    .filter(line => line.netPay > 0)
    .map(line => ({ line, department: departmentOf(line.employeeId), breakdown: cashBreakdown(line.netPay, denominations) }))
    .sort((a, b) => (a.department || '~').localeCompare(b.department || '~') || a.line.employeeName.localeCompare(b.line.employeeName)),
  [denominations, departmentOf, lines]);
  const totals = useMemo(() => cashBreakdownTotals(lines.map(line => line.netPay), denominations), [denominations, lines]);
  const skipped = lines.length - envelopes.length;
  const usedDenominations = denominations.filter(value => (totals.pieces.get(value) ?? 0) > 0);
  const showLoose = totals.loose > 0;

  function handleExport() {
    const headers = ['Department', 'Employee', 'Biometric ID', 'Net Pay', ...usedDenominations.map(label), ...(showLoose ? ['Loose Change'] : [])];
    const rows = envelopes.map(({ line, department, breakdown }) => [
      department, line.employeeName, line.biometricId, line.netPay,
      ...usedDenominations.map(value => breakdown.pieces.get(value) ?? ''),
      ...(showLoose ? [breakdown.loose || ''] : []),
    ]);
    const totalRow = ['', 'TOTAL PIECES', '', totals.cash, ...usedDenominations.map(value => totals.pieces.get(value) ?? 0), ...(showLoose ? [totals.loose] : [])];
    const amountRow = ['', 'AMOUNT', '', '', ...usedDenominations.map(value => (totals.pieces.get(value) ?? 0) * value), ...(showLoose ? [totals.loose] : [])];
    downloadTextFile(`cash-breakdown-${dateFrom}-to-${dateTo}.csv`, [headers, ...rows, totalRow, amountRow].map(row => row.map(csvEscape).join(',')).join('\n'), 'text/csv;charset=utf-8');
  }

  let lastDepartment: string | null = null;

  return createPortal(
    <div className="wf-print-root fixed inset-0 z-[80] overflow-auto bg-slate-900/50 p-4 sm:p-8">
      <style>{PRINT_CSS}</style>
      <div className="wf-print-sheet mx-auto max-w-6xl rounded-xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800"><Banknote size={20} className="text-emerald-600 wf-no-print" /> Cash Payroll Breakdown</h2>
            <p className="text-sm text-slate-500">{formatPeriod(dateFrom, dateTo)} · {totals.envelopes} envelopes · {peso(totals.cash)}</p>
          </div>
          <div className="wf-no-print flex gap-2">
            <button type="button" onClick={() => window.print()} className="flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-600">
              <Printer size={16} /> Print
            </button>
            <button type="button" onClick={handleExport} disabled={envelopes.length === 0} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              <Download size={16} /> CSV
            </button>
            <button type="button" onClick={onClose} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              <X size={16} /> Close
            </button>
          </div>
        </div>

        <div className="wf-no-print mb-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Bills and coins to use</p>
          <div className="flex flex-wrap gap-2">
            {PESO_DENOMINATIONS.map(value => {
              const on = denominations.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => toggle(value)}
                  aria-pressed={on}
                  className={`rounded-full border px-3 py-1 text-sm font-semibold tabular-nums ${on ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-400 line-through'}`}
                >
                  {label(value)}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-500">Turn off what the bank or cashier does not have, for example ₱1 coins. What cannot be made goes to Loose Change.</p>
        </div>

        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-600">To withdraw</h3>
        <div className="mb-6 overflow-x-auto">
          <table className="w-full max-w-xl text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3">Bill / coin</th>
                <th className="py-2 pr-3 text-right">Pieces</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {usedDenominations.map(value => (
                <tr key={value}>
                  <td className="py-1.5 pr-3 font-semibold text-slate-700">{label(value)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{(totals.pieces.get(value) ?? 0).toLocaleString('en-PH')}</td>
                  <td className="py-1.5 text-right tabular-nums">{money((totals.pieces.get(value) ?? 0) * value)}</td>
                </tr>
              ))}
              {showLoose && (
                <tr>
                  <td className="py-1.5 pr-3 font-semibold text-amber-700">Loose change</td>
                  <td className="py-1.5 pr-3" />
                  <td className="py-1.5 text-right tabular-nums text-amber-700">{money(totals.loose)}</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 font-bold text-slate-800">
                <td className="py-2 pr-3">TOTAL</td>
                <td className="py-2 pr-3" />
                <td className="py-2 text-right tabular-nums">{peso(totals.cash)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-600">Per envelope</h3>
        {envelopes.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No one has net pay above zero.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-300 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3 text-left">Employee</th>
                  <th className="py-2 pr-3 text-right">Net Pay</th>
                  {usedDenominations.map(value => <th key={value} className="px-1.5 py-2 text-center tabular-nums">{label(value)}</th>)}
                  {showLoose && <th className="px-1.5 py-2 text-right">Loose</th>}
                  <th className="py-2 pl-3 text-center">✓</th>
                </tr>
              </thead>
              <tbody>
                {envelopes.map(({ line, department, breakdown }) => {
                  const header = department !== lastDepartment;
                  lastDepartment = department;
                  return [
                    header && (
                      <tr key={`${line.employeeId}-department`} className="bg-slate-50">
                        <td colSpan={3 + usedDenominations.length + (showLoose ? 1 : 0)} className="px-2 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">{department || 'No department'}</td>
                      </tr>
                    ),
                    <tr key={line.employeeId} className="border-b border-slate-100">
                      <td className="py-1.5 pr-3 font-medium text-slate-800">{line.employeeName}</td>
                      <td className="py-1.5 pr-3 text-right font-semibold tabular-nums">{money(line.netPay)}</td>
                      {usedDenominations.map(value => (
                        <td key={value} className="px-1.5 py-1.5 text-center tabular-nums text-slate-700">{breakdown.pieces.get(value) || ''}</td>
                      ))}
                      {showLoose && <td className="px-1.5 py-1.5 text-right tabular-nums text-amber-700">{breakdown.loose ? money(breakdown.loose) : ''}</td>}
                      <td className="py-1.5 pl-3 text-center"><span className="inline-block h-3.5 w-3.5 rounded-sm border border-slate-400" /></td>
                    </tr>,
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
        {skipped > 0 && <p className="mt-3 text-xs text-slate-500">{skipped} employee{skipped === 1 ? ' has' : 's have'} zero or negative net pay and {skipped === 1 ? 'is' : 'are'} not included.</p>}
      </div>
    </div>,
    document.body,
  );
}
