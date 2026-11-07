export type Role = 'admin'|'director'|'manager'|'agent';

export const MODULE_IDS = [
  'system','users','permissions','menus','settings','system_audit',
  'dashboard','stocks','transfers','sales','debts','cases','cash',
  'inventory','approvals','reports','supervision','business_settings','audit',
] as const;
export type ModuleId = typeof MODULE_IDS[number];

const PREVIEW_NAV: Record<Role, readonly ModuleId[]> = {
  admin:['system','users','permissions','menus','settings','system_audit'],
  director:['dashboard','stocks','transfers','sales','debts','cases','cash',
    'inventory','approvals','reports','supervision','business_settings','audit'],
  manager:['dashboard','stocks','transfers','sales','debts','cases','cash',
    'inventory','approvals','reports','supervision','business_settings','audit'],
  agent:['dashboard','sales','stocks','transfers','debts','cash','cases','approvals'],
};

export function canView(role:Role,module:ModuleId):boolean {
  return PREVIEW_NAV[role].includes(module);
}
export function roleModules(role:Role):readonly ModuleId[] {
  return PREVIEW_NAV[role];
}
export function isRole(value:unknown):value is Role {
  return value==='admin'||value==='director'||value==='manager'||value==='agent';
}
export function isModule(value:unknown):value is ModuleId {
  return typeof value==='string'&&MODULE_IDS.includes(value as ModuleId);
}
