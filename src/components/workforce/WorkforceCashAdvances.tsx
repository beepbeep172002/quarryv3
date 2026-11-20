import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Download, HandCoins, Plus, Search, UtensilsCrossed, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { friendlyDbError, NOT_SAVED_MESSAGE } from '../../lib/dbErrors';
import { useBusinessToday } from '../../lib/date';
import type { WfCashAdvanceEntryRow, WfChargeEntryRow, WfEmployeeRow } from '../../lib/database.types';
import { fetchAllPages } from '../../lib/fetchAll';
import { paginate } from '../../lib/pagination';
import { formatDate, money, parseAmount, peso } from '../../lib/workforce/format';
import { round2 } from '../../lib/workforce/payroll';
import { csvEscape, downloadTextFile } from '../fuel/fuelUtils';
import Pagination from '../Pagination';
import ReadOnlyNotice from '../ReadOnlyNotice';
import { Badge, Card, EmptyState, ErrorBanner, Field, FormModal, LoadingRow, PageHeader, RefreshButton, StatCard, ToolbarButton } from './WorkforceUi';

const PAGE_SIZE = 15;
const DEFAULT_CHARGE_TYPE = 'Cafeteria';

interface Props {
  canManage: boolean;
}

/** Cash advances (vale) and charges (cafeteria tab, etc.) share this screen and ledger layout. */
type LedgerKind = 'cash_advance' | 'charges';

type LedgerEntry = {
  id: string;
  employee_id: string;
  entry_date: string;
  type: WfCashAdvanceEntryRow['type'] | WfChargeEntryRow['type'];
  amount: number;
  description: string;
  charge_type?: string;
};

interface EntryForm {
  employeeId: string;
  entryDate: string;
  type: 'add' | 'adjustment';
  direction: 'increase' | 'decrease';
  amount: string;
  chargeType: string;
  description: string;
}

const TYPE_LABEL: Record<LedgerEntry['type'], string> = {
  advance: 'Advance',
  charge: 'Charge',
  deduction: 'Payroll deduction',
  adjustment: 'Adjustment',
};

const LEDGER_TEXT: Record<LedgerKind, {
  title: string;
  subtitle: string;
  addLabel: string;
  noun: string;
  addedColumn: string;
  emptyDetail: string;
  addSubtitle: string;
  descriptionPlaceholder: string;
  exportName: string;
}> = {
  cash_advance: {
    title: 'Cash Advances',
    subtitle: 'Vale ledger per employee. Payroll deductions are added automatically when a payroll is locked.',
    addLabel: 'Add Advance',
    noun: 'cash advances',
    addedColumn: 'Total Advanced',
    emptyDetail: 'Recorded advances will appear here.',
    addSubtitle: 'Money given to the employee. It is deducted in payroll by their per-payroll amount.',
    descriptionPlaceholder: 'ex. Vale for medicine',
    exportName: 'cash-advances',
  },
  charges: {
    title: 'Charges',
    subtitle: 'Cafeteria tab and other charges per employee. The open balance is taken from the next payroll, up to what is left of the pay.',
    addLabel: 'Add Charge',
    noun: 'charges',
    addedColumn: 'Total Charged',
    emptyDetail: 'Recorded charges (food, drinks, etc.) will appear here.',
    addSubtitle: 'What the employee took on credit. The whole balance is deducted in the next payroll; whatever does not fit carries over.',
    descriptionPlaceholder: 'ex. Lunch and softdrinks, Nov 10-14',
    exportName: 'charges',
  },
};

export default function WorkforceCashAdvances({ canManage }: Props) {
  const today = useBusinessToday();
  const [kind, setKind] = useState<LedgerKind>('cash_advance');
  const text = LEDGER_TEXT[kind];
  const [employees, setEmployees] = useState<WfEmployeeRow[]>([]);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [withBalanceOnly, setWithBalanceOnly] = useState(true);
  const [page, setPage] = useState(1);
  const [ledgerEmployeeId, setLedgerEmployeeId] = useState<string | null>(null);
  const [form, setForm] = useState<EntryForm | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    // Balances are computed from the full ledger, never typed in.
    const [employeeResult, entryResult] = await Promise.all([
      fetchAllPages<WfEmployeeRow>(async (from, to) => await supabase.from('wf_employees').select('*').order('full_name').range(from, to)),
      kind === 'cash_advance'
        ? fetchAllPages<LedgerEntry>(async (from, to) => await supabase.from('wf_cash_advance_entries').select('*').order('entry_date').order('created_at').range(from, to))
        : fetchAllPages<LedgerEntry>(async (from, to) => await supabase.from('wf_charge_entries').select('*').order('entry_date').order('created_at').range(from, to)),
    ]);
    const problem = employeeResult.error ?? entryResult.error;
    if (problem) {
      setError(kind === 'charges' && entryResult.error
        ? `Could not load charges. If this is new, run the migration 20261115100000_workforce_charges_and_shift_schedule.sql in Supabase. ${problem.message}`
        : `Could not load ${text.noun}. ${problem.message}`);
    }
    setEmployees(employeeResult.data);
    setEntries(entryResult.data);
    setLoading(false);
  }, [kind, text.noun]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { setPage(1); }, [search, withBalanceOnly, kind]);

  const balances = useMemo(() => {
    const map = new Map<string, { balance: number; lastDate: string | null; added: number }>();
    for (const entry of entries) {
      const current = map.get(entry.employee_id) ?? { balance: 0, lastDate: null, added: 0 };
      map.set(entry.employee_id, {
        balance: round2(current.balance + Number(entry.amount)),
        lastDate: entry.entry_date,
        added: round2(current.added + (entry.type === 'advance' || entry.type === 'charge' ? Number(entry.amount) : 0)),
      });
    }
    return map;
  }, [entries]);

  const chargeTypes = useMemo(() => {
    const types = new Set([DEFAULT_CHARGE_TYPE]);
    for (const entry of entries) if (entry.type === 'charge' && entry.charge_type) types.add(entry.charge_type);
    return [...types].sort();
  }, [entries]);

  const rows = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return employees
      .filter(employee => {
        const info = balances.get(employee.id);
        if (withBalanceOnly && !(info && Math.abs(info.balance) >= 0.005)) return false;
        if (!info && employee.status !== 'active') return false;
        const haystack = `${employee.full_name} ${employee.biometric_id} ${employee.department}`.toLowerCase();
        return words.every(word => haystack.includes(word));
      })
      .map(employee => ({ employee, info: balances.get(employee.id) ?? { balance: 0, lastDate: null, added: 0 } }))
      .sort((a, b) => b.info.balance - a.info.balance || a.employee.full_name.localeCompare(b.employee.full_name));
  }, [balances, employees, search, withBalanceOnly]);

  const totalOutstanding = useMemo(() => round2([...balances.values()].reduce((sum, info) => sum + Math.max(0, info.balance), 0)), [balances]);
  const owingCount = useMemo(() => [...balances.values()].filter(info => info.balance > 0.005).length, [balances]);
  const paged = useMemo(() => paginate(rows, page, PAGE_SIZE), [rows, page]);

  const ledgerEmployee = ledgerEmployeeId ? employees.find(employee => employee.id === ledgerEmployeeId) ?? null : null;
  const ledger = useMemo(() => {
    if (!ledgerEmployeeId) return [];
    let running = 0;
    return entries
      .filter(entry => entry.employee_id === ledgerEmployeeId)
      .map(entry => {
        running = round2(running + Number(entry.amount));
        return { entry, running };
      })
      .reverse();
  }, [entries, ledgerEmployeeId]);

  function switchKind(next: LedgerKind) {
    if (next === kind) return;
    setKind(next);
    setEntries([]);
    setLedgerEmployeeId(null);
    setForm(null);
  }

  function openForm(type: EntryForm['type'], employeeId = '') {
    setForm({ employeeId, entryDate: today, type, direction: type === 'add' ? 'increase' : 'decrease', amount: '', chargeType: DEFAULT_CHARGE_TYPE, description: '' });
    setFormError('');
  }

  async function handleSave(event?: React.FormEvent) {
    event?.preventDefault();
    if (!form || !canManage || saving) return;
    const amount = parseAmount(form.amount);
    if (!form.employeeId) return setFormError('Choose an employee.');
    if (!form.entryDate) return setFormError('Choose a date.');
    if (!(amount > 0)) return setFormError('Enter an amount greater than zero.');
    if (form.type === 'adjustment' && !form.description.trim()) return setFormError('Explain the adjustment.');
    if (kind === 'charges' && !form.chargeType.trim()) return setFormError('Enter what the charge is for, e.g. Cafeteria.');
    const signed = round2(form.type === 'add' || form.direction === 'increase' ? amount : -amount);
    setSaving(true);
    setFormError('');
    const result = kind === 'cash_advance'
      ? await supabase.from('wf_cash_advance_entries').insert({
        employee_id: form.employeeId,
        entry_date: form.entryDate,
        type: form.type === 'add' ? 'advance' : 'adjustment',
        amount: signed,
        description: form.description.trim(),
      }).select('id')
      : await supabase.from('wf_charge_entries').insert({
        employee_id: form.employeeId,
        entry_date: form.entryDate,
        type: form.type === 'add' ? 'charge' : 'adjustment',
        charge_type: form.chargeType.trim(),
        amount: signed,
        description: form.description.trim(),
      }).select('id');
    setSaving(false);
    if (result.error || !result.data?.length) {
      setFormError(result.error ? friendlyDbError(result.error) : NOT_SAVED_MESSAGE);
      return;
    }
    setForm(null);
    await fetchData();
  }

  function handleExport() {
    const headers = kind === 'cash_advance'
      ? ['Biometric ID', 'Name', 'Department', 'C.A per Payroll', 'Total Advanced', 'Balance', 'Last Entry']
      : ['Biometric ID', 'Name', 'Department', 'Total Charged', 'Balance', 'Last Entry'];
    const csvRows = rows.map(({ employee, info }) => (kind === 'cash_advance'
      ? [employee.biometric_id, employee.full_name, employee.department, employee.ca_deduction_per_payroll, info.added, info.balance, info.lastDate ?? '']
      : [employee.biometric_id, employee.full_name, employee.department, info.added, info.balance, info.lastDate ?? '']));
    downloadTextFile(`${text.exportName}-${today}.csv`, [headers, ...csvRows].map(row => row.map(csvEscape).join(',')).join('\n'), 'text/csv;charset=utf-8');
  }

  const formBalance = form?.employeeId ? balances.get(form.employeeId)?.balance ?? 0 : 0;
  const addIcon = kind === 'cash_advance' ? <HandCoins size={16} /> : <UtensilsCrossed size={16} />;

  return (
    <div className="space-y-5">
      <PageHeader title={text.title} subtitle={text.subtitle}>
        <ToolbarButton icon={<Download size={16} />} label="Export" onClick={handleExport} disabled={rows.length === 0} />
        <RefreshButton loading={loading} onClick={fetchData} />
        {canManage && <ToolbarButton icon={<Plus size={16} />} label="Adjustment" onClick={() => openForm('adjustment')} />}
        {canManage && <ToolbarButton tone="primary" icon={addIcon} label={text.addLabel} onClick={() => openForm('add')} />}
      </PageHeader>

      <div className="flex gap-1 border-b border-slate-200" role="tablist" aria-label="Ledger">
        {([['cash_advance', 'Cash Advances (Vale)'], ['charges', 'Charges (Cafeteria)']] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={kind === value}
            onClick={() => switchKind(value)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${kind === value ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {!canManage && <ReadOnlyNotice message={`Your account can view ${text.noun} only.`} />}
      <ErrorBanner message={error} />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Outstanding balance" value={peso(totalOutstanding)} tone="amber" />
        <StatCard label="Employees with balance" value={String(owingCount)} />
        <StatCard label="Ledger entries" value={String(entries.length)} tone="slate" />
      </div>

      <Card
        title="Balances"
        subtitle={kind === 'cash_advance' ? 'Balance = advances + adjustments − payroll deductions.' : 'Balance = charges + adjustments − payroll deductions.'}
        actions={(
          <>
            <div className="relative min-w-56">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, ID or department..." className="input pl-9" />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={withBalanceOnly} onChange={event => setWithBalanceOnly(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
              With balance only
            </label>
          </>
        )}
      >
        {loading ? <LoadingRow label={`Loading ${text.noun}...`} /> : rows.length === 0 ? (
          <EmptyState icon={kind === 'cash_advance' ? <HandCoins size={34} /> : <UtensilsCrossed size={34} />} title="No balances" detail={text.emptyDetail} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 text-left">Employee</th>
                    {kind === 'cash_advance' && <th className="px-4 py-3 text-right">Per Payroll</th>}
                    <th className="px-4 py-3 text-right">{text.addedColumn}</th>
                    <th className="px-4 py-3 text-right">Balance</th>
                    <th className="px-4 py-3 text-left">Last Entry</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paged.map(({ employee, info }) => (
                    <tr key={employee.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-700">{employee.full_name}</p>
                        <p className="text-xs text-slate-400">ID {employee.biometric_id}{employee.department ? ` · ${employee.department}` : ''}{employee.status === 'inactive' ? ' · inactive' : ''}</p>
                      </td>
                      {kind === 'cash_advance' && (
                        <td className="px-4 py-3 text-right tabular-nums text-slate-600">{employee.ca_deduction_per_payroll > 0 ? money(employee.ca_deduction_per_payroll) : '—'}</td>
                      )}
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">{money(info.added)}</td>
                      <td className={`px-4 py-3 text-right font-bold tabular-nums ${info.balance > 0 ? 'text-amber-700' : info.balance < 0 ? 'text-red-600' : 'text-slate-500'}`}>{money(info.balance)}</td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(info.lastDate)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2 text-xs font-semibold">
                          <button type="button" onClick={() => setLedgerEmployeeId(employee.id)} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800"><BookOpen size={14} /> Ledger</button>
                          {canManage && (
                            <button type="button" onClick={() => openForm('add', employee.id)} className="text-emerald-600 hover:text-emerald-700">
                              + {kind === 'cash_advance' ? 'Advance' : 'Charge'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} totalItems={rows.length} onPageChange={setPage} />
          </>
        )}
      </Card>

      {ledgerEmployee && (
        <div className="fixed inset-0 z-[60] flex justify-end bg-slate-900/30" onClick={() => setLedgerEmployeeId(null)}>
          <aside className="flex h-full w-full max-w-lg flex-col bg-white shadow-2xl" onClick={event => event.stopPropagation()} aria-label={`${text.title} ledger`}>
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{text.title} · ID {ledgerEmployee.biometric_id}</p>
                <h2 className="text-base font-bold text-slate-800">{ledgerEmployee.full_name}</h2>
                <p className="text-sm text-slate-500">Balance {peso(balances.get(ledgerEmployee.id)?.balance ?? 0)}</p>
              </div>
              <button type="button" onClick={() => setLedgerEmployeeId(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {ledger.length === 0 ? <EmptyState icon={<BookOpen size={30} />} title="No entries" detail={`This employee has no ${text.noun} history.`} /> : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-2 text-left">Date</th>
                      <th className="px-4 py-2 text-left">Entry</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                      <th className="px-4 py-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ledger.map(({ entry, running }) => (
                      <tr key={entry.id}>
                        <td className="px-4 py-2 text-slate-600">{formatDate(entry.entry_date)}</td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge tone={entry.type === 'advance' || entry.type === 'charge' ? 'amber' : entry.type === 'deduction' ? 'emerald' : 'slate'}>{TYPE_LABEL[entry.type]}</Badge>
                            {entry.type === 'charge' && entry.charge_type && <Badge tone="sky">{entry.charge_type}</Badge>}
                          </div>
                          {entry.description && <p className="mt-0.5 text-xs text-slate-500">{entry.description}</p>}
                        </td>
                        <td className={`px-4 py-2 text-right tabular-nums ${entry.amount < 0 ? 'text-emerald-700' : 'text-amber-700'}`}>{entry.amount > 0 ? '+' : ''}{money(entry.amount)}</td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums">{money(running)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </aside>
        </div>
      )}

      <FormModal
        open={!!form}
        title={form?.type === 'add' ? text.addLabel : 'Add Adjustment'}
        subtitle={form?.type === 'add' ? text.addSubtitle : 'Corrects a balance. Entries are never edited or deleted.'}
        onClose={() => !saving && setForm(null)}
        footer={(
          <>
            <button type="button" onClick={() => setForm(null)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
            <ToolbarButton tone="primary" icon={<Plus size={15} />} label="Save Entry" onClick={() => handleSave()} disabled={saving} spinning={saving} />
          </>
        )}
      >
        {form && (
          <form onSubmit={handleSave} className="space-y-4">
            <ErrorBanner message={formError} />
            <Field label="Employee" helper={form.employeeId ? `Balance ${peso(formBalance)}` : undefined}>
              <select value={form.employeeId} onChange={event => setForm({ ...form, employeeId: event.target.value })} className="input" required>
                <option value="">Choose employee...</option>
                {employees.filter(employee => employee.status === 'active' || employee.id === form.employeeId).map(employee => (
                  <option key={employee.id} value={employee.id}>{employee.full_name} (ID {employee.biometric_id})</option>
                ))}
              </select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date"><input type="date" value={form.entryDate} onChange={event => setForm({ ...form, entryDate: event.target.value })} className="input" required /></Field>
              <Field label="Amount"><input type="number" min="0" step="0.01" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} className="input" placeholder="0.00" required /></Field>
            </div>
            {kind === 'charges' && form.type === 'add' && (
              <Field label="Charge For">
                <input list="wf-charge-types" value={form.chargeType} onChange={event => setForm({ ...form, chargeType: event.target.value })} className="input" required />
                <datalist id="wf-charge-types">
                  {chargeTypes.map(type => <option key={type} value={type} />)}
                </datalist>
              </Field>
            )}
            {form.type === 'adjustment' && (
              <Field label="Direction">
                <select value={form.direction} onChange={event => setForm({ ...form, direction: event.target.value as EntryForm['direction'] })} className="input">
                  <option value="decrease">Decrease balance (e.g. paid in cash)</option>
                  <option value="increase">Increase balance (e.g. opening balance)</option>
                </select>
              </Field>
            )}
            <Field label={form.type === 'adjustment' ? 'Reason (required)' : 'Description'}>
              <input value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} className="input" placeholder={form.type === 'add' ? text.descriptionPlaceholder : 'ex. Opening balance from logbook'} />
            </Field>
            <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
          </form>
        )}
      </FormModal>
    </div>
  );
}
