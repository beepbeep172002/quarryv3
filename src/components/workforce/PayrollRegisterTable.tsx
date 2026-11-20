import { Fragment, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Search } from 'lucide-react';
import type { WfEmployeeRow } from '../../lib/database.types';
import { money, qty } from '../../lib/workforce/format';
import type { PayInputs, PayrollLine } from '../../lib/workforce/payroll';
import { Badge } from './WorkforceUi';

export type EditableKey = keyof Pick<PayInputs, 'days' | 'otHours' | 'ndHours' | 'regHolidays' | 'specialHolidaysWorked' | 'caDeduction' | 'chargeDeduction' | 'sss' | 'philhealth' | 'pagibig' | 'otherDeductions'>;

interface FieldDef { key: EditableKey; label: string; step: string; unit?: string }

const ATTENDANCE: FieldDef[] = [
  { key: 'days', label: 'Days worked', step: '0.5', unit: 'days' },
  { key: 'otHours', label: 'Overtime', step: '0.5', unit: 'hrs' },
  { key: 'ndHours', label: 'Night differential', step: '0.5', unit: 'hrs' },
  { key: 'regHolidays', label: 'Regular holidays', step: '1', unit: 'days' },
  { key: 'specialHolidaysWorked', label: 'Special holidays worked', step: '0.5', unit: 'days' },
];

const DEDUCTIONS: FieldDef[] = [
  { key: 'caDeduction', label: 'C.A (vale)', step: '0.01' },
  { key: 'chargeDeduction', label: 'Charges (cafeteria)', step: '0.01' },
  { key: 'sss', label: 'SSS', step: '0.01' },
  { key: 'philhealth', label: 'PhilHealth', step: '0.01' },
  { key: 'pagibig', label: 'Pag-IBIG', step: '0.01' },
  { key: 'otherDeductions', label: 'Other', step: '0.01' },
];

type Filter = 'all' | 'attention' | 'deductions';

interface Props {
  lines: PayrollLine[];
  editable: boolean;
  isDraft: boolean;
  employeesById: Map<string, WfEmployeeRow>;
  caBalances: Map<string, number>;
  chargeBalances: Map<string, number>;
  totals: { basicPay: number; otPay: number; ndPay: number; holidayPay: number; grossPay: number; totalDeductions: number; netPay: number };
  lineWarnings: (line: PayrollLine) => { tone: 'red' | 'amber'; text: string }[];
  updateLine: (employeeId: string, key: EditableKey | 'remarks', value: string) => void;
}

/** Shows a quantity, or a faint dash for zero so the numbers that matter stand out. */
function Quantity({ value, money: isMoney }: { value: number; money?: boolean }) {
  if (!value) return <span className="text-slate-300">—</span>;
  return <span className="tabular-nums">{isMoney ? money(value) : qty(value)}</span>;
}

export default function PayrollRegisterTable({ lines, editable, isDraft, employeesById, caBalances, chargeBalances, totals, lineWarnings, updateLine }: Props) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Set<string>>(new Set());

  const caNotDeducted = (line: PayrollLine) => isDraft && line.caDeduction === 0 && (caBalances.get(line.employeeId) ?? 0) > 0;
  const needsAttention = (line: PayrollLine) => lineWarnings(line).length > 0 || caNotDeducted(line);

  const counts = {
    all: lines.length,
    attention: lines.filter(needsAttention).length,
    deductions: lines.filter(line => line.totalDeductions > 0).length,
  };

  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visible = lines.filter(line => {
    if (filter === 'attention' && !needsAttention(line)) return false;
    if (filter === 'deductions' && line.totalDeductions <= 0) return false;
    const haystack = `${line.employeeName} ${line.biometricId} ${employeesById.get(line.employeeId)?.department ?? ''}`.toLowerCase();
    return words.every(word => haystack.includes(word));
  });

  const allOpen = visible.length > 0 && visible.every(line => open.has(line.employeeId));

  function toggle(employeeId: string) {
    setOpen(current => {
      const next = new Set(current);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  }

  function toggleAll() {
    setOpen(allOpen ? new Set() : new Set(visible.map(line => line.employeeId)));
  }

  function input(line: PayrollLine, field: FieldDef) {
    if (!editable) {
      return <p className="rounded-lg bg-slate-50 px-3 py-2 text-right text-sm font-semibold tabular-nums text-slate-700">{field.step === '0.01' ? money(line[field.key]) : qty(line[field.key])}</p>;
    }
    return (
      <div className="relative">
        <input
          type="number"
          min="0"
          step={field.step}
          value={line[field.key]}
          onChange={event => updateLine(line.employeeId, field.key, event.target.value)}
          onFocus={event => event.target.select()}
          aria-label={`${field.label} for ${line.employeeName}`}
          className={`w-full rounded-lg border border-slate-200 bg-white py-2 text-right text-sm font-semibold tabular-nums text-slate-800 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100 ${field.unit ? 'pl-3 pr-11' : 'px-3'}`}
        />
        {field.unit && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{field.unit}</span>}
      </div>
    );
  }

  const chips: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'attention', label: 'Needs attention' },
    { id: 'deductions', label: 'With deductions' },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, ID, department..." className="input pl-9" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {chips.map(chip => (
            <button
              key={chip.id}
              type="button"
              onClick={() => setFilter(chip.id)}
              aria-pressed={filter === chip.id}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${filter === chip.id ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
            >
              {chip.id === 'attention' && counts.attention > 0 && <AlertTriangle size={12} className="text-amber-500" />}
              {chip.label}
              <span className="rounded-full bg-white/80 px-1.5 tabular-nums text-slate-400">{counts[chip.id]}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={toggleAll} disabled={visible.length === 0} className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-40">
          {allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="w-8 py-2.5 pl-4" />
              <th className="px-3 py-2.5 text-left">Employee</th>
              <th className="px-3 py-2.5 text-right">Rate</th>
              <th className="px-3 py-2.5 text-right">Days</th>
              <th className="px-3 py-2.5 text-right">OT hrs</th>
              <th className="px-3 py-2.5 text-right">ND hrs</th>
              <th className="px-3 py-2.5 text-right">Gross</th>
              <th className="px-3 py-2.5 text-right">Deductions</th>
              <th className="px-4 py-2.5 text-right">Net Pay</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={9} className="py-12 text-center text-sm text-slate-400">No employees match.</td></tr>
            )}
            {visible.map(line => {
              const isOpen = open.has(line.employeeId);
              const warnings = lineWarnings(line);
              const employee = employeesById.get(line.employeeId);
              const caBalance = caBalances.get(line.employeeId) ?? 0;
              const chargeBalance = chargeBalances.get(line.employeeId) ?? 0;
              return (
                <Fragment key={line.employeeId}>
                  <tr
                    onClick={() => toggle(line.employeeId)}
                    aria-expanded={isOpen}
                    className={`cursor-pointer border-t ${isOpen ? 'border-emerald-200 bg-emerald-100/70' : 'border-slate-100 hover:bg-slate-50'}`}
                  >
                    <td className={`py-3 pl-4 ${isOpen ? 'text-emerald-600 shadow-[inset_4px_0_0_#10b981]' : 'text-slate-400'}`}>{isOpen ? <ChevronDown size={18} strokeWidth={2.5} /> : <ChevronRight size={16} />}</td>
                    <td className="px-3 py-3">
                      <p className={`font-semibold ${isOpen ? 'text-emerald-900' : 'text-slate-800'}`}>{line.employeeName}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-400">
                        <span>ID {line.biometricId}{employee?.department ? ` · ${employee.department}` : ''}</span>
                        {line.payType === 'fixed' && <Badge tone="slate">Fixed</Badge>}
                        {warnings.map(warning => <Badge key={warning.text} tone={warning.tone}>{warning.text}</Badge>)}
                        {caNotDeducted(line) && <Badge tone="amber">Vale {money(caBalance)} not deducted</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-600">{line.dailyRate ? money(line.dailyRate) : <span className="text-red-500">—</span>}</td>
                    <td className="px-3 py-3 text-right text-slate-700"><Quantity value={line.days} /></td>
                    <td className="px-3 py-3 text-right text-slate-700"><Quantity value={line.otHours} /></td>
                    <td className="px-3 py-3 text-right text-slate-700"><Quantity value={line.ndHours} /></td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-sky-700">{money(line.grossPay)}</td>
                    <td className="px-3 py-3 text-right text-amber-700">{line.totalDeductions ? <span className="tabular-nums">−{money(line.totalDeductions)}</span> : <span className="text-slate-300">—</span>}</td>
                    <td className={`px-4 py-3 text-right text-base font-bold tabular-nums ${line.netPay < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{money(line.netPay)}</td>
                  </tr>

                  {isOpen && (
                    <tr className="border-b-2 border-emerald-200 bg-emerald-50/70">
                      <td className="shadow-[inset_4px_0_0_#10b981]" />
                      <td colSpan={8} className="px-3 pb-5 pt-1">
                        <div className="grid gap-4 lg:grid-cols-3">
                          <section className="rounded-xl border border-slate-200 bg-white p-4">
                            <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Attendance</h4>
                            <div className="space-y-2.5">
                              {ATTENDANCE.map(field => (
                                <label key={field.key} className="grid grid-cols-[1fr_8.5rem] items-center gap-3 text-sm text-slate-600">
                                  {field.label}
                                  {input(line, field)}
                                </label>
                              ))}
                            </div>
                          </section>

                          <section className="rounded-xl border border-slate-200 bg-white p-4">
                            <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Deductions</h4>
                            <div className="space-y-2.5">
                              {DEDUCTIONS.map(field => {
                                const balance = field.key === 'caDeduction' ? caBalance : field.key === 'chargeDeduction' ? chargeBalance : 0;
                                const showBalance = isDraft && (field.key === 'caDeduction' || field.key === 'chargeDeduction') && balance > 0;
                                return (
                                  <div key={field.key} className="grid grid-cols-[1fr_8.5rem] items-center gap-3 text-sm text-slate-600">
                                    <div>
                                      <span>{field.label}</span>
                                      {showBalance && (
                                        <p className="text-[11px] text-slate-400">
                                          Balance {money(balance)}
                                          {editable && line[field.key] !== balance && (
                                            <button type="button" onClick={() => updateLine(line.employeeId, field.key, String(balance))} className="ml-1.5 font-semibold text-emerald-600 hover:underline">Use all</button>
                                          )}
                                        </p>
                                      )}
                                    </div>
                                    {input(line, field)}
                                  </div>
                                );
                              })}
                            </div>
                          </section>

                          <section className="flex flex-col rounded-xl border border-slate-200 bg-white p-4">
                            <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Pay</h4>
                            <dl className="space-y-1.5 text-sm">
                              <SummaryRow label={`Basic pay (${qty(line.days)} × ${money(line.dailyRate)})`} value={line.basicPay} />
                              <SummaryRow label={`OT pay (${qty(line.otHours)} hrs × ${money(line.hourlyRate)})`} value={line.otPay} />
                              <SummaryRow label="Night differential" value={line.ndPay} />
                              <SummaryRow label="Holiday pay" value={line.holidayPay} />
                              <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold text-sky-700"><dt>Gross</dt><dd className="tabular-nums">{money(line.grossPay)}</dd></div>
                              <div className="flex justify-between text-amber-700"><dt>Less deductions</dt><dd className="tabular-nums">−{money(line.totalDeductions)}</dd></div>
                            </dl>
                            <div className={`mt-3 flex items-baseline justify-between rounded-lg px-3 py-2.5 ${line.netPay < 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
                              <span className="text-xs font-bold uppercase tracking-wide">Net pay</span>
                              <span className="text-xl font-bold tabular-nums">{money(line.netPay)}</span>
                            </div>
                            <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Remarks
                              {editable ? (
                                <input value={line.remarks} onChange={event => updateLine(line.employeeId, 'remarks', event.target.value)} aria-label={`Remarks for ${line.employeeName}`} className="input mt-1 normal-case tracking-normal" placeholder="Optional" />
                              ) : <p className="mt-1 text-sm font-normal normal-case tracking-normal text-slate-600">{line.remarks || '—'}</p>}
                            </label>
                          </section>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold text-slate-700">
              <td />
              <td className="px-3 py-3">Total · {lines.length} employees</td>
              <td />
              <td className="px-3 py-3 text-right tabular-nums">{qty(lines.reduce((sum, line) => sum + line.days, 0))}</td>
              <td className="px-3 py-3 text-right tabular-nums">{qty(lines.reduce((sum, line) => sum + line.otHours, 0))}</td>
              <td className="px-3 py-3 text-right tabular-nums">{qty(lines.reduce((sum, line) => sum + line.ndHours, 0))}</td>
              <td className="px-3 py-3 text-right tabular-nums text-sky-700">{money(totals.grossPay)}</td>
              <td className="px-3 py-3 text-right tabular-nums text-amber-700">−{money(totals.totalDeductions)}</td>
              <td className="px-4 py-3 text-right text-base tabular-nums text-emerald-700">{money(totals.netPay)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className={`flex justify-between gap-3 ${value ? 'text-slate-600' : 'text-slate-300'}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{money(value)}</dd>
    </div>
  );
}
