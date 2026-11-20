import { useMemo, useState } from 'react';
import { Loader2, Pencil, Plus, RotateCcw, Store } from 'lucide-react';
import type { FuelSupplier } from '../../lib/database.types';
import { friendlyDbError } from '../../lib/dbErrors';
import { paginate } from '../../lib/pagination';
import { supabase } from '../../lib/supabase';
import ActionModal from '../ActionModal';
import Pagination from '../Pagination';
import { EditRowButton, Field } from './FuelTables';
import { PAGE_SIZE, inputClass } from './fuelUtils';

interface SupplierFormState {
  name: string;
  contact_person: string;
  contact_no: string;
  address: string;
  notes: string;
}

const EMPTY_FORM: SupplierFormState = { name: '', contact_person: '', contact_no: '', address: '', notes: '' };

/** Same rule as the database's unique index: case and extra spaces do not count. */
function supplierKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

interface FuelSuppliersProps {
  suppliers: FuelSupplier[];
  canManage: boolean;
  search: string;
  onChanged: () => Promise<void> | void;
}

export default function FuelSuppliers({ suppliers, canManage, search, onChanged }: FuelSuppliersProps) {
  const [form, setForm] = useState<SupplierFormState>(EMPTY_FORM);
  const [editing, setEditing] = useState<FuelSupplier | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [deactivateTarget, setDeactivateTarget] = useState<FuelSupplier | null>(null);

  const inactiveCount = suppliers.filter(item => !item.is_active).length;
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suppliers.filter(item =>
      (showInactive || item.is_active) &&
      (!q || [item.name, item.contact_person, item.contact_no, item.address, item.notes].some(value => value.toLowerCase().includes(q)))
    );
  }, [search, showInactive, suppliers]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(visible.length / PAGE_SIZE)));
  const rows = paginate(visible, currentPage, PAGE_SIZE);

  function startEdit(item: FuelSupplier) {
    setEditing(item);
    setError('');
    setMessage('');
    setForm({ name: item.name, contact_person: item.contact_person, contact_no: item.contact_no, address: item.address, notes: item.notes });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError('');
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage || saving) return;
    const name = form.name.trim().replace(/\s+/g, ' ');
    if (!name) return;
    const duplicate = suppliers.find(item => item.id !== editing?.id && supplierKey(item.name) === supplierKey(name));
    if (duplicate) {
      setError(`"${duplicate.name}" is already in the list${duplicate.is_active ? '' : ' (inactive, tick "Show inactive" to reactivate it)'}.`);
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    const values = {
      name,
      contact_person: form.contact_person.trim(),
      contact_no: form.contact_no.trim(),
      address: form.address.trim(),
      notes: form.notes.trim(),
    };
    const result = editing
      ? await supabase.from('fuel_suppliers').update(values).eq('id', editing.id).select('id')
      : await supabase.from('fuel_suppliers').insert(values).select('id');
    setSaving(false);

    if (result.error || !result.data?.length) {
      setError(result.error?.code === '23505' ? `"${name}" is already in the list.` : friendlyDbError(result.error));
      return;
    }
    setMessage(editing ? `Updated ${name}. Purchases already saved keep the name they were saved with.` : `Added ${name}.`);
    setEditing(null);
    setForm(EMPTY_FORM);
    await onChanged();
  }

  async function setActive(item: FuelSupplier, isActive: boolean) {
    setSaving(true);
    setError('');
    setMessage('');
    const { data, error: saveError } = await supabase.from('fuel_suppliers').update({ is_active: isActive }).eq('id', item.id).select('id');
    setSaving(false);
    setDeactivateTarget(null);
    if (saveError || !data?.length) {
      setError(friendlyDbError(saveError));
      return;
    }
    setMessage(isActive ? `${item.name} is active again.` : `${item.name} was deactivated.`);
    if (editing?.id === item.id) cancelEdit();
    await onChanged();
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
      {canManage && (
        <div className={`bg-white rounded-xl border p-5 h-fit ${editing ? 'border-amber-300 ring-2 ring-amber-100' : 'border-slate-200'}`}>
          <h2 className="font-semibold text-slate-800 mb-4">{editing ? 'Edit Supplier' : 'Add Supplier'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Supplier Name"><input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputClass} placeholder="RTM Gas Station" /></Field>
            <Field label="Contact Person"><input value={form.contact_person} onChange={e => setForm(f => ({ ...f, contact_person: e.target.value }))} className={inputClass} /></Field>
            <Field label="Contact No."><input value={form.contact_no} onChange={e => setForm(f => ({ ...f, contact_no: e.target.value }))} className={inputClass} placeholder="09XX XXX XXXX" /></Field>
            <Field label="Address"><input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} className={inputClass} /></Field>
            <Field label="Notes"><textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={`${inputClass} resize-none`} rows={2} /></Field>
            <button disabled={saving} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold disabled:opacity-70">
              {saving ? <Loader2 size={15} className="animate-spin" /> : editing ? <Pencil size={15} /> : <Plus size={15} />}
              {editing ? 'Update Supplier' : 'Save Supplier'}
            </button>
            {editing && (
              <button type="button" onClick={cancelEdit} disabled={saving} className="w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-70">
                Cancel Edit
              </button>
            )}
          </form>
        </div>
      )}

      <div className={`space-y-3 ${canManage ? 'xl:col-span-2' : 'xl:col-span-3'}`}>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}

        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-slate-500">{visible.length} {visible.length === 1 ? 'supplier' : 'suppliers'}</span>
          {inactiveCount > 0 && (
            <label className="flex items-center gap-2 text-slate-600">
              <input type="checkbox" checked={showInactive} onChange={e => { setShowInactive(e.target.checked); setPage(1); }} className="h-4 w-4 accent-emerald-500" />
              Show inactive ({inactiveCount})
            </label>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide">
                  <th className="px-5 py-3 text-left">Supplier</th>
                  <th className="px-4 py-3 text-left">Contact</th>
                  <th className="px-4 py-3 text-left">Address / Notes</th>
                  {canManage && <th className="px-4 py-3 text-center w-28">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={canManage ? 4 : 3} className="px-4 py-12 text-center text-slate-400">
                      {suppliers.length === 0 ? 'No suppliers yet. Add the stations you buy fuel from.' : 'No suppliers found'}
                    </td>
                  </tr>
                ) : rows.map(item => (
                  <tr key={item.id} className={editing?.id === item.id ? 'bg-amber-50/60' : item.is_active ? '' : 'bg-slate-50 text-slate-400'}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <Store size={15} className={item.is_active ? 'text-emerald-600' : 'text-slate-300'} />
                        <span className="font-semibold text-slate-800">{item.name}</span>
                        {!item.is_active && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Inactive</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {item.contact_person || item.contact_no ? (
                        <>
                          <div>{item.contact_person || '—'}</div>
                          {item.contact_no && <div className="text-xs text-slate-400">{item.contact_no}</div>}
                        </>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <div>{item.address || '—'}</div>
                      {item.notes && <div className="text-xs text-slate-400">{item.notes}</div>}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          {item.is_active ? (
                            <>
                              <EditRowButton onClick={() => startEdit(item)} active={editing?.id === item.id} />
                              <button type="button" onClick={() => setDeactivateTarget(item)} disabled={saving} className="rounded-lg px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50">
                                Deactivate
                              </button>
                            </>
                          ) : (
                            <button type="button" onClick={() => setActive(item, true)} disabled={saving} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                              <RotateCcw size={13} /> Reactivate
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <Pagination page={currentPage} pageSize={PAGE_SIZE} totalItems={visible.length} onPageChange={setPage} />
      </div>

      <ActionModal
        open={!!deactivateTarget}
        title="Deactivate Supplier"
        description="This supplier will be hidden from the Supplier dropdown. Purchases already saved keep its name, and you can reactivate it anytime."
        variant="warning"
        confirmLabel="Deactivate"
        loading={saving}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={() => deactivateTarget ? setActive(deactivateTarget, false) : undefined}
      >
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">{deactivateTarget?.name}</p>
      </ActionModal>
    </div>
  );
}
