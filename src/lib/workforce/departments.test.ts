import { describe, expect, it } from 'vitest';
import type { WfDepartmentRow, WfPositionRow } from '../database.types';
import { employeeCounts, missingFromLists, nameKey, positionsForDepartment } from './departments';

const stamp = { notes: '', created_by: null, created_at: '', updated_at: '' };
const department = (id: string, name: string, is_active = true): WfDepartmentRow => ({ id, name, is_active, ...stamp });
const position = (id: string, name: string, department_id: string | null, is_active = true): WfPositionRow => ({ id, name, department_id, is_active, ...stamp });

const lists = {
  departments: [department('sc', 'Stone Crusher'), department('sw', 'Sand Washing'), department('old', 'Old Dept', false)],
  positions: [
    position('sc-welder', 'Welder', 'sc'),
    position('sc-helper', 'Helper', 'sc'),
    position('sc-retired', 'Retired Job', 'sc', false),
    position('sw-welder', 'Welder', 'sw'),
    position('any-driver', 'Driver', null),
  ],
};

describe('nameKey', () => {
  it('ignores case and extra spaces', () => {
    expect(nameKey('  Stone   CRUSHER ')).toBe('stone crusher');
    expect(nameKey(null)).toBe('');
  });
});

describe('positionsForDepartment', () => {
  it('offers the department positions plus the any-department ones', () => {
    expect(positionsForDepartment(lists, 'stone crusher').map(item => item.id)).toEqual(['any-driver', 'sc-helper', 'sc-welder']);
  });

  it('hides inactive positions unless asked', () => {
    expect(positionsForDepartment(lists, 'Stone Crusher', true).map(item => item.id)).toContain('sc-retired');
  });

  it('offers only any-department positions when there is no department', () => {
    expect(positionsForDepartment(lists, '').map(item => item.id)).toEqual(['any-driver']);
  });
});

describe('employeeCounts', () => {
  const employees = [
    { department: 'Stone Crusher', position: 'Welder', status: 'active' as const },
    { department: 'Sand Washing', position: 'welder', status: 'active' as const },
    { department: 'Sand Washing', position: 'Driver', status: 'active' as const },
    { department: 'Stone Crusher', position: 'Helper', status: 'inactive' as const },
  ];

  it('counts each welder under its own department', () => {
    const counts = employeeCounts(lists, employees);
    expect(counts.departments.get('sc')).toBe(1);
    expect(counts.departments.get('sw')).toBe(2);
    expect(counts.positions.get('sc-welder')).toBe(1);
    expect(counts.positions.get('sw-welder')).toBe(1);
    expect(counts.positions.get('any-driver')).toBe(1);
    expect(counts.positions.get('sc-helper')).toBeUndefined();
  });

  it('includes inactive employees when asked', () => {
    expect(employeeCounts(lists, employees, false).positions.get('sc-helper')).toBe(1);
  });
});

describe('missingFromLists', () => {
  it('lists departments and positions employees use that are not in the lists', () => {
    const missing = missingFromLists(lists, [
      { department: 'Stone Crusher', position: 'Welder' },
      { department: 'Security', position: 'Guard' },
      { department: ' security ', position: 'guard' },
      { department: 'Sand Washing', position: 'Helper' },
      { department: '', position: 'Driver' },
      { department: '', position: '' },
    ]);
    expect(missing.departments).toEqual(['Security']);
    expect(missing.positions).toEqual([
      { department: 'Sand Washing', name: 'Helper' },
      { department: 'Security', name: 'Guard' },
    ]);
  });
});
