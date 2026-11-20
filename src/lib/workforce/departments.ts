import type { WfDepartmentRow, WfEmployeeRow, WfPositionRow } from '../database.types';
import { supabase } from '../supabase';

/** Same rule as the database's unique indexes: case and extra spaces do not count. */
export function nameKey(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export interface DepartmentLists {
  departments: WfDepartmentRow[];
  positions: WfPositionRow[];
  /** false until the 2026-11-20 migration is run; screens then fall back to free text. */
  available: boolean;
}

export async function loadDepartmentLists(): Promise<{ data: DepartmentLists; error: string | null }> {
  const [departments, positions] = await Promise.all([
    supabase.from('wf_departments').select('*').order('name'),
    supabase.from('wf_positions').select('*').order('name'),
  ]);
  const error = departments.error ?? positions.error;
  if (error) {
    const missing = error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message);
    return { data: { departments: [], positions: [], available: false }, error: missing ? null : error.message };
  }
  return { data: { departments: departments.data ?? [], positions: positions.data ?? [], available: true }, error: null };
}

/** Positions to offer for a department: its own ones plus the ones for any department. */
export function positionsForDepartment(lists: Pick<DepartmentLists, 'departments' | 'positions'>, departmentName: string, includeInactive = false): WfPositionRow[] {
  const department = lists.departments.find(item => nameKey(item.name) === nameKey(departmentName));
  return lists.positions
    .filter(position => (includeInactive || position.is_active) && (position.department_id === null || position.department_id === department?.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** How many employees use each department / position (keyed by id). */
export function employeeCounts(lists: Pick<DepartmentLists, 'departments' | 'positions'>, employees: Pick<WfEmployeeRow, 'department' | 'position' | 'status'>[], activeOnly = true) {
  const departments = new Map<string, number>();
  const positions = new Map<string, number>();
  const departmentIdByKey = new Map(lists.departments.map(item => [nameKey(item.name), item.id]));
  for (const employee of employees) {
    if (activeOnly && employee.status !== 'active') continue;
    const departmentId = departmentIdByKey.get(nameKey(employee.department));
    if (departmentId) departments.set(departmentId, (departments.get(departmentId) ?? 0) + 1);
    if (!nameKey(employee.position)) continue;
    const position = lists.positions.find(item => nameKey(item.name) === nameKey(employee.position) && item.department_id === (departmentId ?? null))
      ?? lists.positions.find(item => nameKey(item.name) === nameKey(employee.position) && item.department_id === null);
    if (position) positions.set(position.id, (positions.get(position.id) ?? 0) + 1);
  }
  return { departments, positions };
}

export interface MissingEntries {
  departments: string[];
  /** Positions used by employees that are not in the list, with the department they are used in. */
  positions: { department: string; name: string }[];
}

/** Departments and positions employees have that are not in the lists yet (for example typed before the lists existed). */
export function missingFromLists(lists: Pick<DepartmentLists, 'departments' | 'positions'>, employees: Pick<WfEmployeeRow, 'department' | 'position'>[]): MissingEntries {
  const departmentKeys = new Set(lists.departments.map(item => nameKey(item.name)));
  const missingDepartments = new Map<string, string>();
  const missingPositions = new Map<string, { department: string; name: string }>();
  for (const employee of employees) {
    const departmentName = cleanName(employee.department ?? '');
    if (departmentName && !departmentKeys.has(nameKey(departmentName)) && !missingDepartments.has(nameKey(departmentName))) {
      missingDepartments.set(nameKey(departmentName), departmentName);
    }
    const positionName = cleanName(employee.position ?? '');
    if (!positionName) continue;
    const offered = positionsForDepartment(lists, departmentName, true);
    if (offered.some(item => nameKey(item.name) === nameKey(positionName))) continue;
    const key = `${nameKey(departmentName)}|${nameKey(positionName)}`;
    if (!missingPositions.has(key)) missingPositions.set(key, { department: departmentName, name: positionName });
  }
  const byName = (a: string, b: string) => a.localeCompare(b);
  return {
    departments: [...missingDepartments.values()].sort(byName),
    positions: [...missingPositions.values()].sort((a, b) => byName(a.department, b.department) || byName(a.name, b.name)),
  };
}
