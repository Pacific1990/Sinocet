import { describe, expect, it } from 'vitest';
import { canView, isRole, roleModules } from './permissions';

describe('SMTR role navigation — UI only, never server authorization', () => {
  it('restricts the agent to operational modules', () => {
    expect(canView('agent', 'sales')).toBe(true);
    expect(canView('agent', 'transfers')).toBe(true);
    expect(canView('agent', 'users')).toBe(false);
    expect(canView('agent', 'audit')).toBe(false);
    expect(canView('agent', 'approvals')).toBe(false);
  });
  it('offers manager validations but not identity administration', () => {
    expect(canView('manager', 'approvals')).toBe(true);
    expect(canView('manager', 'users')).toBe(false);
  });
  it('exposes organization-wide navigation only to the director', () => {
    expect(canView('director', 'audit')).toBe(true);
    expect(canView('director', 'users')).toBe(true);
  });
  it('rejects unknown roles and produces unique navigation items', () => {
    expect(isRole('administrator')).toBe(false);
    expect(roleModules('agent').length).toBe(new Set(roleModules('agent')).size);
  });
});
