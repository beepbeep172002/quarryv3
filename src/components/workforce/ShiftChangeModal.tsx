import { useMemo, useState } from 'react';
import { CalendarClock, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { friendlyDbError } from '../../lib/dbErrors';
import type { WfEmployeeRow, WfShiftRow } from '../../lib/database.types';
import { ErrorBanner, Field, FormModal, ToolbarButton } from './WorkforceUi';

interface Props {
  employees: WfEmployeeRow[];
  shifts: WfShiftRow[];
  today: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

/** Moves several employees to another shift from a start date (e.g. a crew going on night shift). */
export default function ShiftChangeModal({ employees, shifts, today, onClose, onSaved }: Props) {
  const activeShifts = shifts.filter(shift => shift.is_active);
  const [shiftId, setShiftId] = useState(activeShifts.find(shift => shift.crosses_midnight)?.id ?? activeShifts[0]?.id ?? '');
  const [startDate, setStartDate] = useState(today);
  const [department, setDepartment] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const shiftsById = useMemo(() => new Map(shifts.map(shift => [shift.id, shift])), [shifts]);
  const active = useMemo(() => employees.filter(employee => employee.status === 'active'), [employees]);
  const departments = useMemo(() => [...new Set(active.map(employee => employee.department).filter(Boolean))].sort(), [active]);
  const visible = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return active.filter(employee => {
      if (department && employee.department !== department) return false;
      const haystack = `${employee.full_name} ${employee.biometric_id} ${employee.position}`.toLowerCase();
      return words.every(word => haystack.includes(word));
    });
  }, [active, department, search]);
  const allVisibleSelected = visible.length > 0 && visible.every(employee => selected.has(employee.id));

  function toggle(id: string) {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleVisible() {
    setSelected(previous => {
      const next = new Set(previous);
      for (const employee of visible) {
        if (allVisibleSelected) next.delete(employee.id);
        else next.add(employee.id);
      }
      return next;
    });
  }

  async function handleSave() {
    if (!shiftId) return setError('Choose a shift.');
    if (!startDate) return setError('Choose the date the shift starts.');
    if (selected.size === 0) return setError('Choose at least one employee.');
    setSaving(true);
    setError('');
    const { error: saveError } = await supabase.rpc('wf_set_employee_shift', {
      p_employee_ids: [...selected],
      p_shift_id: shiftId,
      p_effective_from: startDate,
    });
    setSaving(false);
    if (saveError) {
      setError(friendlyDbError(saveError));
      return;
    }
    await onSaved();
  }

  const shiftName = shiftsById.get(shiftId)?.name ?? 'the shift';

  return (
    <FormModal
      open
      wide
      title="Change Shift"
      subtitle="Move employees to another shift from a start date. Days before it keep their old shift, so past timecards do not change."
      onClose={() => !saving && onClose()}
      footer={(
        <>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
          <ToolbarButton
            tone="primary"
            icon={<CalendarClock size={15} />}
            label={selected.size ? `Move ${selected.size} to ${shiftName}` : 'Change Shift'}
            onClick={handleSave}
            disabled={saving || selected.size === 0}
            spinning={saving}
          />
        </>
      )}
    >
      <div className="space-y-4">
        <ErrorBanner message={error} />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="New Shift">
            <select value={shiftId} onChange={event => setShiftId(event.target.value)} className="input">
              {activeShifts.map(shift => <option key={shift.id} value={shift.id}>{shift.name}{shift.crosses_midnight ? ' (night)' : ''}</option>)}
            </select>
          </Field>
          <Field label="Starts On">
            <input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} className="input" required />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, ID, position..." className="input pl-9" />
          </div>
          <select value={department} onChange={event => setDepartment(event.target.value)} className="input w-auto" aria-label="Department">
            <option value="">All departments</option>
            {departments.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>

        <div className="rounded-lg border border-slate-200">
          <label className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
            Select all shown ({visible.length}) · {selected.size} selected
          </label>
          <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
            {visible.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-400">No active employees match.</p>
            ) : visible.map(employee => (
              <label key={employee.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={selected.has(employee.id)} onChange={() => toggle(employee.id)} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-slate-700">{employee.full_name}</span>
                  <span className="block text-xs text-slate-400">ID {employee.biometric_id}{employee.department ? ` · ${employee.department}` : ''}{employee.position ? ` · ${employee.position}` : ''}</span>
                </span>
                <span className="text-xs text-slate-500">{shiftsById.get(employee.shift_id ?? '')?.name ?? 'No shift'}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </FormModal>
  );
}
