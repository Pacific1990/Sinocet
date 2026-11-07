import { describe, expect, it } from 'vitest';
import { canView,isRole,isModule,roleModules } from './permissions';

describe('SMTR preview role navigation — server access governs production',()=>{
  it('adds an isolated administrator with system menus only',()=>{
    expect(isRole('admin')).toBe(true);
    expect(canView('admin','permissions')).toBe(true);
    expect(canView('admin','menus')).toBe(true);
    expect(canView('admin','sales')).toBe(false);
    expect(canView('admin','business_settings')).toBe(false);
  });
  it('keeps business data away from technical administration',()=>{
    expect(canView('director','business_settings')).toBe(true);
    expect(canView('director','users')).toBe(false);
    expect(canView('manager','inventory')).toBe(true);
    expect(canView('manager','users')).toBe(false);
  });
  it('shows only field operations to an agent',()=>{
    expect(canView('agent','sales')).toBe(true);
    expect(canView('agent','approvals')).toBe(true);
    expect(canView('agent','permissions')).toBe(false);
    expect(canView('agent','reports')).toBe(false);
  });
  it('rejects unknown roles and modules',()=>{
    expect(isRole('super-admin')).toBe(false);
    expect(isModule('tableau-de-bord')).toBe(false);
    expect(roleModules('admin').length).toBe(new Set(roleModules('admin')).size);
  });
});
