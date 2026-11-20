import { useCallback, useEffect, useMemo, useState } from 'react';
import { Briefcase, Building2, Edit3, ListPlus, Plus, Power, RotateCcw, Save, Search, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { friendlyDbError } from '../../lib/dbErrors';
import type { WfDepartmentRow, WfEmployeeRow, WfPositionRow } from '../../lib/database.types';
import { cleanName, employeeCounts, loadDepartmentLists, missingFromLists, nameKey } from '../../lib/workforce/departments';
import { fetchAllPages } from '../../lib/fetchAll';
import ActionModal from '../ActionModal';
import ReadOnlyNotice from '../ReadOnlyNotice';
import { Badge, Card, EmptyState, ErrorBanner, Field, FormModal, LoadingRow, PageHeader, RefreshButton, SuccessBanner, ToolbarButton, WarningNote } from './WorkforceUi';

interface Props {
  canManage: boolean;
}

/** "any" = positions that can be used in any department. */
type PositionFilter = 'all' | 'any' | string;

type Editing =
  | { kind: 'department'; row: WfDepartmentRow | null }
  | { kind: 'position'; row: WfPositionRow | null };

type DeleteTarget =
  | { kind: 'department'; row: WfDepartmentRow }
  | { kind: 'position'; row: WfPositionRow };

interface FormState {
  name: string;
  notes: string;
  department_id: string;
}

const EMPTY_FORM: FormState = { name: '', notes: '', department_id: '' };

export default function WorkforceDepartments({ canManage }: Props) {
  const [departments, setDepartments] = useState<WfDepartmentRow[]>([]);
  const [positions, setPositions] = useState<WfPositionRow[]>([]);
  const [employees, setEmployees] = useState<Pick<WfEmployeeRow, 'department' | 'position' | 'status'>[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [positionFilter, setPositionFilter] = useState<PositionFilter>('all');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    const [lists, employeeResult] = await Promise.all([
      loadDepartmentLists(),
      fetchAllPages<Pick<WfEmployeeRow, 'department' | 'position' | 'status'>>(async (from, to) => await supabase
        .from('wf_employees').select('department, position, status').order('id').range(from, to)),
    ]);
    if (lists.error) setError(`Could not load departments. ${lists.error}`);
    setDepartments(lists.data.departments);
    setPositions(lists.data.positions);
    setAvailable(lists.data.available);
    if (employeeResult.error) setError(`Could not load employees. ${employeeResult.error.message}`);
    else setEmployees(employeeResult.data);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const lists = useMemo(() => ({ departments, positions }), [departments, positions]);
  const activeCounts = useMemo(() => employeeCounts(lists, employees), [employees, lists]);
  const allCounts = useMemo(() => employeeCounts(lists, employees, false), [employees, lists]);
  const missing = useMemo(() => missingFromLists(lists, employees), [employees, lists]);
  const departmentById = useMemo(() => new Map(departments.map(item => [item.id, item])), [departments]);
  const positionCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const position of positions) {
      if (position.department_id && position.is_active) counts.set(position.department_id, (counts.get(position.department_id) ?? 0) + 1);
    }
    return counts;
  }, [positions]);

  const words = search.trim().toLowerCase();
  const visibleDepartments = departments.filter(item => (showInactive || item.is_active) && (!words || item.name.toLowerCase().includes(words)));
  const visiblePositions = positions
    .filter(item => showInactive || item.is_active)
    .filter(item => positionFilter === 'all' || (positionFilter === 'any' ? item.department_id === null : item.department_id === positionFilter))
    .filter(item => !words || `${item.name} ${departmentById.get(item.department_id ?? '')?.name ?? ''}`.toLowerCase().includes(words))
    .sort((a, b) => (departmentById.get(a.department_id ?? '')?.name ?? '').localeCompare(departmentById.get(b.department_id ?? '')?.name ?? '') || a.name.localeCompare(b.name));
  const inactiveCount = departments.filter(item => !item.is_active).length + positions.filter(item => !item.is_active).length;

  function openForm(next: Editing) {
    setEditing(next);
    setFormError('');
    setMessage('');
    if (next.row) {
      setForm({ name: next.row.name, notes: next.row.notes, department_id: next.kind === 'position' ? next.row.department_id ?? '' : '' });
    } else {
      const presetDepartment = next.kind === 'position' && positionFilter !== 'all' && positionFilter !== 'any' ? positionFilter : '';
      setForm({ ...EMPTY_FORM, department_id: presetDepartment });
    }
  }

  const renameCount = (() => {
    if (!editing?.row || nameKey(form.name) === nameKey(editing.row.name)) return 0;
    return (editing.kind === 'department' ? allCounts.departments : allCounts.positions).get(editing.row.id) ?? 0;
  })();

  async function handleSave(event?: React.FormEvent) {
    event?.preventDefault();
    if (!editing || saving || !canManage) return;
    const name = cleanName(form.name);
    if (!name) {
      setFormError('Enter a name.');
      return;
    }
    const departmentId = editing.kind === 'position' ? (form.department_id || null) : null;
    const duplicate = editing.kind === 'department'
      ? departments.find(item => item.id !== editing.row?.id && nameKey(item.name) === nameKey(name))
      : positions.find(item => item.id !== editing.row?.id && item.department_id === departmentId && nameKey(item.name) === nameKey(name));
    if (duplicate) {
      setFormError(`"${duplicate.name}" is already in the list${duplicate.is_active ? '' : ' (inactive, tick "Show inactive" to reactivate it)'}.`);
      return;
    }

    setSaving(true);
    setFormError('');
    const notes = form.notes.trim();
    let result;
    if (editing.kind === 'department') {
      result = editing.row
        ? await supabase.from('wf_departments').update({ name, notes }).eq('id', editing.row.id).select('id')
        : await supabase.from('wf_departments').insert({ name, notes }).select('id');
    } else {
      result = editing.row
        ? await supabase.from('wf_positions').update({ name, notes }).eq('id', editing.row.id).select('id')
        : await supabase.from('wf_positions').insert({ name, notes, department_id: departmentId }).select('id');
    }
    setSaving(false);
    if (result.error || !result.data?.length) {
      setFormError(result.error?.code === '23505' ? `"${name}" is already in the list.` : friendlyDbError(result.error));
      return;
    }
    const label = editing.kind === 'department' ? 'department' : 'position';
    setMessage(editing.row
      ? `Updated ${label} ${name}.${renameCount ? ` ${renameCount} employee${renameCount === 1 ? '' : 's'} renamed too.` : ''}`
      : `Added ${label} ${name}.`);
    setEditing(null);
    await fetchData();
  }

  async function setActive(target: DeleteTarget, isActive: boolean) {
    setSaving(true);
    setError('');
    setMessage('');
    const table = target.kind === 'department' ? 'wf_departments' : 'wf_positions';
    const { data, error: saveError } = await supabase.from(table).update({ is_active: isActive }).eq('id', target.row.id).select('id');
    setSaving(false);
    if (saveError || !data?.length) {
      setError(friendlyDbError(saveError));
      return;
    }
    setMessage(isActive ? `${target.row.name} is active again.` : `${target.row.name} is hidden from the Edit Employee dropdown. Employees keep it.`);
    await fetchData();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setSaving(true);
    setError('');
    setMessage('');
    const table = deleteTarget.kind === 'department' ? 'wf_departments' : 'wf_positions';
    const { data, error: deleteError } = await supabase.from(table).delete().eq('id', deleteTarget.row.id).select('id');
    setSaving(false);
    const name = deleteTarget.row.name;
    setDeleteTarget(null);
    if (deleteError || !data?.length) {
      setError(friendlyDbError(deleteError));
      return;
    }
    if (deleteTarget.kind === 'department' && positionFilter === deleteTarget.row.id) setPositionFilter('all');
    setMessage(`Deleted ${name}.`);
    await fetchData();
  }

  async function addMissing() {
    if (!canManage || saving) return;
    setSaving(true);
    setError('');
    setMessage('');
    if (missing.departments.length) {
      const { error: insertError } = await supabase.from('wf_departments').insert(missing.departments.map(name => ({ name })));
      if (insertError && insertError.code !== '23505') {
        setSaving(false);
        setError(friendlyDbError(insertError));
        return;
      }
    }
    const fresh = await loadDepartmentLists();
    const idByKey = new Map(fresh.data.departments.map(item => [nameKey(item.name), item.id]));
    if (missing.positions.length) {
      const rows = missing.positions.map(item => ({ name: item.name, department_id: idByKey.get(nameKey(item.department)) ?? null }));
      const { error: insertError } = await supabase.from('wf_positions').insert(rows);
      if (insertError && insertError.code !== '23505') {
        setSaving(false);
        setError(friendlyDbError(insertError));
        return;
      }
    }
    setSaving(false);
    setMessage(`Added ${missing.departments.length} department${missing.departments.length === 1 ? '' : 's'} and ${missing.positions.length} position${missing.positions.length === 1 ? '' : 's'} from the employee list.`);
    await fetchData();
  }

  const missingTotal = missing.departments.length + missing.positions.length;
  const deleteUsage = deleteTarget ? ((deleteTarget.kind === 'department' ? allCounts.departments : allCounts.positions).get(deleteTarget.row.id) ?? 0) : 0;
  const deletePositions = deleteTarget?.kind === 'department' ? positions.filter(item => item.department_id === deleteTarget.row.id).length : 0;

  function rowActions(target: DeleteTarget) {
    if (!canManage) return null;
    const used = ((target.kind === 'department' ? allCounts.departments : allCounts.positions).get(target.row.id) ?? 0) > 0;
    return (
      <div className="flex items-center justify-end gap-1" onClick={event => event.stopPropagation()}>
        {target.row.is_active ? (
          <>
            <button type="button" title="Edit" onClick={() => openForm(target.kind === 'department' ? { kind: 'department', row: target.row } : { kind: 'position', row: target.row })} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Edit3 size={15} /></button>
            <button type="button" title="Deactivate (hide from dropdown)" onClick={() => setActive(target, false)} disabled={saving} className="rounded-lg p-1.5 text-slate-400 hover:bg-amber-50 hover:text-amber-600 disabled:opacity-50"><Power size={15} /></button>
          </>
        ) : (
          <button type="button" title="Reactivate" onClick={() => setActive(target, true)} disabled={saving} className="rounded-lg p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-50"><RotateCcw size={15} /></button>
        )}
        <button
          type="button"
          title={used ? 'Used by employees: deactivate it instead' : 'Delete'}
          onClick={() => setDeleteTarget(target)}
          disabled={saving || used}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <Trash2 size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Departments & Positions" subtitle="The choices in Edit Employee. Renaming here renames it on every employee too.">
        <RefreshButton loading={loading} onClick={fetchData} />
      </PageHeader>

      {!canManage && <ReadOnlyNotice message="Your account can view departments and positions only." />}
      <ErrorBanner message={error} />
      <SuccessBanner message={message} />

      {!loading && !available && (
        <WarningNote>
          The departments list is not set up yet. Run the migration <span className="font-mono">20261120100000_workforce_departments_positions.sql</span> in Supabase, then press Refresh.
        </WarningNote>
      )}

      {available && canManage && missingTotal > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          <div>
            <p className="font-semibold">Employees use {missing.departments.length ? `${missing.departments.length} department${missing.departments.length === 1 ? '' : 's'}` : ''}{missing.departments.length && missing.positions.length ? ' and ' : ''}{missing.positions.length ? `${missing.positions.length} position${missing.positions.length === 1 ? '' : 's'}` : ''} that are not in the list yet.</p>
            <p className="mt-0.5 text-xs text-sky-700">{[...missing.departments, ...missing.positions.map(item => item.department ? `${item.name} (${item.department})` : item.name)].slice(0, 8).join(' · ')}{missingTotal > 8 ? ' …' : ''}</p>
          </div>
          <ToolbarButton tone="primary" icon={<ListPlus size={15} />} label="Add Them to the List" onClick={addMissing} disabled={saving} spinning={saving} />
        </div>
      )}

      {available && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search department or position..." className="input pl-9" />
          </div>
          {inactiveCount > 0 && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={showInactive} onChange={event => setShowInactive(event.target.checked)} className="h-4 w-4 accent-emerald-500" />
              Show inactive ({inactiveCount})
            </label>
          )}
        </div>
      )}

      {available && (
        <div className="grid gap-5 xl:grid-cols-5">
          <div className="xl:col-span-2">
            <Card
              title="Departments"
              subtitle="Click one to see its positions"
              actions={canManage ? <ToolbarButton tone="primary" icon={<Plus size={15} />} label="Add Department" onClick={() => openForm({ kind: 'department', row: null })} /> : undefined}
            >
              {loading ? <LoadingRow label="Loading departments..." /> : visibleDepartments.length === 0 ? (
                <EmptyState icon={<Building2 size={32} />} title={departments.length ? 'No departments found' : 'No departments yet'} detail={departments.length ? 'Try another search.' : 'Add the departments employees belong to.'} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <th className="px-5 py-3">Department</th>
                        <th className="px-3 py-3 text-right">Employees</th>
                        <th className="px-3 py-3 text-right">Positions</th>
                        {canManage && <th className="px-3 py-3" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibleDepartments.map(item => {
                        const selected = positionFilter === item.id;
                        return (
                          <tr
                            key={item.id}
                            onClick={() => setPositionFilter(selected ? 'all' : item.id)}
                            className={`cursor-pointer ${selected ? 'bg-emerald-50' : item.is_active ? 'hover:bg-slate-50' : 'bg-slate-50 text-slate-400'}`}
                          >
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <Building2 size={15} className={item.is_active ? 'text-emerald-600' : 'text-slate-300'} />
                                <span className={`font-semibold ${item.is_active ? 'text-slate-800' : 'text-slate-400'}`}>{item.name}</span>
                                {!item.is_active && <Badge tone="slate">Inactive</Badge>}
                              </div>
                              {item.notes && <p className="ml-6 mt-0.5 text-xs text-slate-400">{item.notes}</p>}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums text-slate-600">{activeCounts.departments.get(item.id) ?? 0}</td>
                            <td className="px-3 py-3 text-right tabular-nums text-slate-600">{positionCount.get(item.id) ?? 0}</td>
                            {canManage && <td className="px-3 py-2">{rowActions({ kind: 'department', row: item })}</td>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <div className="xl:col-span-3">
            <Card
              title="Positions"
              subtitle={positionFilter === 'all' ? 'All departments' : positionFilter === 'any' ? 'Usable in any department' : departmentById.get(positionFilter)?.name}
              actions={(
                <>
                  <select value={positionFilter} onChange={event => setPositionFilter(event.target.value)} className="input w-auto py-2 text-sm">
                    <option value="all">All departments</option>
                    <option value="any">Any department</option>
                    {departments.filter(item => item.is_active || item.id === positionFilter).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  {canManage && <ToolbarButton tone="primary" icon={<Plus size={15} />} label="Add Position" onClick={() => openForm({ kind: 'position', row: null })} />}
                </>
              )}
            >
              {loading ? <LoadingRow label="Loading positions..." /> : visiblePositions.length === 0 ? (
                <EmptyState icon={<Briefcase size={32} />} title="No positions found" detail={positions.length ? 'Try another department or search.' : 'Add the positions employees hold, for example Welder or Loader Operator.'} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <th className="px-5 py-3">Position</th>
                        <th className="px-3 py-3">Department</th>
                        <th className="px-3 py-3 text-right">Employees</th>
                        {canManage && <th className="px-3 py-3" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visiblePositions.map(item => (
                        <tr key={item.id} className={item.is_active ? '' : 'bg-slate-50 text-slate-400'}>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <Briefcase size={15} className={item.is_active ? 'text-sky-600' : 'text-slate-300'} />
                              <span className={`font-semibold ${item.is_active ? 'text-slate-800' : 'text-slate-400'}`}>{item.name}</span>
                              {!item.is_active && <Badge tone="slate">Inactive</Badge>}
                            </div>
                            {item.notes && <p className="ml-6 mt-0.5 text-xs text-slate-400">{item.notes}</p>}
                          </td>
                          <td className="px-3 py-3 text-slate-600">{item.department_id ? departmentById.get(item.department_id)?.name ?? '—' : <span className="text-slate-400">Any department</span>}</td>
                          <td className="px-3 py-3 text-right tabular-nums text-slate-600">{activeCounts.positions.get(item.id) ?? 0}</td>
                          {canManage && <td className="px-3 py-2">{rowActions({ kind: 'position', row: item })}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      <FormModal
        open={editing !== null}
        title={`${editing?.row ? 'Edit' : 'Add'} ${editing?.kind === 'position' ? 'Position' : 'Department'}`}
        onClose={() => !saving && setEditing(null)}
        footer={(
          <>
            <button type="button" onClick={() => setEditing(null)} disabled={saving} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
            <ToolbarButton tone="primary" icon={<Save size={15} />} label="Save" onClick={() => handleSave()} disabled={saving} spinning={saving} />
          </>
        )}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <ErrorBanner message={formError} />
          <Field label="Name">
            <input
              autoFocus
              value={form.name}
              onChange={event => setForm(current => ({ ...current, name: event.target.value }))}
              className="input"
              placeholder={editing?.kind === 'position' ? 'ex. Loader Operator' : 'ex. Stone Crusher'}
              required
            />
          </Field>
          {editing?.kind === 'position' && (
            <Field label="Department" helper={editing.row ? 'Fixed once saved' : undefined}>
              <select
                value={form.department_id}
                onChange={event => setForm(current => ({ ...current, department_id: event.target.value }))}
                disabled={!!editing.row}
                className="input disabled:bg-slate-50 disabled:text-slate-500"
              >
                <option value="">Any department</option>
                {departments.filter(item => item.is_active || item.id === form.department_id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Notes">
            <textarea value={form.notes} onChange={event => setForm(current => ({ ...current, notes: event.target.value }))} className="input resize-none" rows={2} />
          </Field>
          {renameCount > 0 && (
            <WarningNote>{renameCount} employee{renameCount === 1 ? '' : 's'} with "{editing?.row?.name}" will be renamed to "{cleanName(form.name)}" too.</WarningNote>
          )}
          <button type="submit" className="hidden" />
        </form>
      </FormModal>

      <ActionModal
        open={!!deleteTarget}
        title={`Delete ${deleteTarget?.kind === 'position' ? 'Position' : 'Department'}`}
        description={deleteTarget?.kind === 'department' && deletePositions > 0
          ? `This also deletes its ${deletePositions} position${deletePositions === 1 ? '' : 's'}. This cannot be undone.`
          : 'This cannot be undone.'}
        variant="danger"
        confirmLabel="Delete"
        loading={saving}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => (deleteUsage === 0 ? handleDelete() : setDeleteTarget(null))}
      >
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">{deleteTarget?.row.name}</p>
      </ActionModal>
    </div>
  );
}
